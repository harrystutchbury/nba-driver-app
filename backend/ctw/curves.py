"""
Win probability curve builder and in-memory lookup cache.

For each (category, league_size, ctw_pct) triple we store P(winning category).

How the curve is built:
  - From simulation we have an array of winning margins for every matchup.
  - avg_winning_total = mean of all winning team totals for that category.
  - For a given CTW% = k:
      player_contribution = (k / 100) × avg_winning_total
      P(win) = fraction of matchups where winning_margin <= player_contribution
             = CDF of the winning-margin distribution evaluated at player_contribution
  - This answers: "How often is a contribution of this size the deciding factor?"
  - For TOV (inverted): higher contribution = worse, so curve is 1 - above.
"""

from __future__ import annotations

import logging
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any

import numpy as np

from .constants import ALL_CATS, CTW_PCT_MAX, CTW_PCT_MIN, INVERTED_CATS

log = logging.getLogger(__name__)

# In-memory cache: (category, league_size) → np.ndarray indexed by ctw_pct offset
_CURVE_CACHE: dict[tuple[str, int], np.ndarray] = {}
_CTW_OFFSET = -CTW_PCT_MIN   # index 0 = CTW_PCT_MIN


def build_curves(results: dict[int, dict[str, Any]]) -> dict[tuple[str, int], dict]:
    """
    Build win probability curves from simulation results.

    Returns {(category, league_size): {"probabilities": np.ndarray, "sample_size": int,
                                        "avg_winning_total": float, ...}}
    """
    curves: dict[tuple[str, int], dict] = {}
    ctw_range = np.arange(CTW_PCT_MIN, CTW_PCT_MAX + 1)  # -50..200

    for league_size, sim in results.items():
        for cat in ALL_CATS:
            margins       = sim["margins"][cat]
            win_totals    = sim["winning_totals"][cat]
            los_totals    = sim["losing_totals"][cat]

            if len(margins) == 0:
                log.warning("No matchup data for %s ls=%d", cat, league_size)
                continue

            avg_winning = float(win_totals.mean())
            avg_losing  = float(los_totals.mean())

            # Sort margins once for vectorised CDF lookup
            sorted_margins = np.sort(margins)
            n = len(sorted_margins)

            probs = np.empty(len(ctw_range), dtype=np.float32)
            for i, pct in enumerate(ctw_range):
                contribution = (pct / 100.0) * avg_winning
                # CDF: fraction of margins <= contribution
                p = float(np.searchsorted(sorted_margins, contribution, side="right")) / n
                p = float(np.clip(p, 0.0, 1.0))
                # TOV is inverted: higher TOV contribution = lower win probability
                if cat in INVERTED_CATS:
                    p = 1.0 - p
                probs[i] = p

            curves[(cat, league_size)] = {
                "probabilities":    probs,
                "sample_size":      n,
                "avg_winning_total": avg_winning,
                "avg_losing_total":  avg_losing,
                "std_winning_total": float(win_totals.std()),
                "p25":               float(np.percentile(win_totals, 25)),
                "p50":               float(np.percentile(win_totals, 50)),
                "p75":               float(np.percentile(win_totals, 75)),
                "avg_team_fgm":      sim.get("avg_team_fgm"),
                "avg_team_fga":      sim.get("avg_team_fga"),
                "avg_team_ftm":      sim.get("avg_team_ftm"),
                "avg_team_fta":      sim.get("avg_team_fta"),
            }

    log.info("Built %d curves", len(curves))
    return curves


def store_curves(conn: sqlite3.Connection, curves: dict[tuple[str, int], dict]) -> None:
    """Persist curves and baselines to the database."""
    now = datetime.now(timezone.utc).isoformat()
    ctw_range = list(range(CTW_PCT_MIN, CTW_PCT_MAX + 1))

    curve_rows    = []
    baseline_rows = []

    for (cat, ls), data in curves.items():
        probs = data["probabilities"]
        for i, pct in enumerate(ctw_range):
            curve_rows.append((cat, ls, pct, float(probs[i]), data["sample_size"], now))

        baseline_rows.append((
            ls, cat,
            data["avg_winning_total"], data["avg_losing_total"],
            data["std_winning_total"],
            data["p25"], data["p50"], data["p75"],
            data.get("avg_team_fgm"), data.get("avg_team_fga"),
            data.get("avg_team_ftm"), data.get("avg_team_fta"),
            now,
        ))

    conn.executemany("""
        INSERT OR REPLACE INTO ctw_curves
            (category, league_size, ctw_pct, win_probability, sample_size, calculated_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """, curve_rows)

    conn.executemany("""
        INSERT OR REPLACE INTO ctw_league_baselines
            (league_size, category, avg_winning_total, avg_losing_total,
             std_winning_total, percentile_25, percentile_50, percentile_75,
             avg_team_fgm, avg_team_fga, avg_team_ftm, avg_team_fta, calculated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, baseline_rows)

    conn.commit()
    log.info("Stored %d curve rows and %d baseline rows", len(curve_rows), len(baseline_rows))


_NPZ_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "ctw_curves.npz")

# Baselines loaded from npz: (league_size, category) → dict of floats
_BASELINE_CACHE: dict[tuple[int, str], dict] = {}
_BASELINE_KEYS = ["avg_winning_total", "avg_losing_total", "std_winning_total",
                  "percentile_25", "percentile_50", "percentile_75",
                  "avg_team_fgm", "avg_team_fga", "avg_team_ftm", "avg_team_fta"]


def load_curves_into_cache(conn: sqlite3.Connection | None = None) -> None:
    """Load curves from the bundled .npz file into the in-memory cache."""
    global _CURVE_CACHE, _BASELINE_CACHE
    _CURVE_CACHE = {}
    _BASELINE_CACHE = {}

    data = np.load(_NPZ_PATH)
    for key in data.files:
        if key.startswith("bl_"):
            # baseline: bl_<ls>_<cat>
            _, ls_str, cat = key.split("_", 2)
            vals = data[key]
            _BASELINE_CACHE[(int(ls_str), cat)] = dict(zip(_BASELINE_KEYS, vals.tolist()))
        else:
            # curve: <cat>_<ls>
            *cat_parts, ls_str = key.split("_")
            cat = "_".join(cat_parts)
            _CURVE_CACHE[(cat, int(ls_str))] = data[key].astype(np.float32)

    log.info("Loaded %d curves and %d baselines from npz", len(_CURVE_CACHE), len(_BASELINE_CACHE))


def lookup(category: str, league_size: int, ctw_pct: float) -> float:
    """
    Return signed expected win contribution for a given CTW%.

    Positive CTW%: player helps the category → +P(win at contribution).
    Negative CTW%: player hurts the category → -P(win at |contribution|).
    This captures the cost of carrying a bad FG%/FT% shooter, not just the
    benefit of a good one.
    """
    if ctw_pct < 0:
        return -_lookup_positive(category, league_size, abs(ctw_pct))
    return _lookup_positive(category, league_size, ctw_pct)


def _lookup_positive(category: str, league_size: int, ctw_pct: float) -> float:
    key = (category, league_size)
    if key not in _CURVE_CACHE:
        raise KeyError(f"No curve cached for {category} ls={league_size}. Call load_curves_into_cache() first.")

    arr = _CURVE_CACHE[key]
    ctw_pct = float(np.clip(ctw_pct, 0, CTW_PCT_MAX))

    lo = int(np.floor(ctw_pct))
    hi = int(np.ceil(ctw_pct))
    frac = ctw_pct - lo

    lo_idx = lo - CTW_PCT_MIN
    hi_idx = hi - CTW_PCT_MIN

    if lo_idx == hi_idx:
        return float(arr[lo_idx])
    return float(arr[lo_idx] * (1 - frac) + arr[hi_idx] * frac)


def get_curve_for_display(category: str, league_size: int) -> list[dict]:
    """Return full curve as list of {ctw_pct, win_probability} for frontend visualisation."""
    key = (category, league_size)
    if key not in _CURVE_CACHE:
        return []
    arr = _CURVE_CACHE[key]
    return [
        {"ctw_pct": CTW_PCT_MIN + i, "win_probability": float(arr[i])}
        for i in range(len(arr))
    ]


def is_cache_populated() -> bool:
    return len(_CURVE_CACHE) > 0
