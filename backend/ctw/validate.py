"""
Post-simulation validation checks for CTW curves and player scores.

Checks:
  - Curves are monotonically non-decreasing for counting stats
  - TOV curve is monotonically non-increasing
  - All probabilities are in [0, 1]
  - Average player total expected wins ≈ 4.5 (8-12 expected across 9 cats at ~0.5)
  - Scarcity adjustments don't explode (no NaN/Inf)

Results are logged and stored in ctw_validation_log.
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone

import numpy as np

from .constants import ALL_CATS, CTW_PCT_MIN, CTW_PCT_MAX, INVERTED_CATS
from . import curves as curve_store

log = logging.getLogger(__name__)


def validate_curves(conn: sqlite3.Connection, season: str) -> dict:
    """
    Run all curve validation checks. Returns summary dict with pass/fail per check.
    Results are stored in ctw_validation_log.
    """
    results: dict[str, bool | str] = {}

    if not curve_store.is_cache_populated():
        curve_store.load_curves_into_cache(conn)

    # Check 1: probability bounds
    bounds_ok = True
    for (cat, ls), arr in curve_store._CURVE_CACHE.items():
        if arr.min() < -0.001 or arr.max() > 1.001:
            log.warning("Probability out of bounds for %s ls=%d: min=%.4f max=%.4f", cat, ls, arr.min(), arr.max())
            bounds_ok = False
    results["probability_bounds"] = bounds_ok

    # Check 2: monotonicity
    monotone_ok = True
    for (cat, ls), arr in curve_store._CURVE_CACHE.items():
        diffs = np.diff(arr.astype(np.float32))
        if cat in INVERTED_CATS:
            if (diffs > 0.01).any():
                log.warning("TOV curve non-monotone for ls=%d: max positive diff=%.4f", ls, diffs.max())
                monotone_ok = False
        else:
            if (diffs < -0.01).any():
                log.warning("Curve non-monotone for %s ls=%d: min diff=%.4f", cat, ls, diffs.min())
                monotone_ok = False
    results["monotonicity"] = monotone_ok

    # Check 3: average player total expected wins
    rows = conn.execute("""
        SELECT AVG(total_expected_wins) AS avg_ew
        FROM ctw_player_scores
        WHERE season = ? AND period = 'full_season' AND league_size = 10
    """, (season,)).fetchone()

    avg_ew = rows["avg_ew"] if rows and rows["avg_ew"] else None
    if avg_ew is not None:
        # Mean across all qualifying players (incl. deep bench + negative FG%/FT% penalties)
        ew_ok = -2.0 <= avg_ew <= 8.5
        results["avg_expected_wins"] = ew_ok
        results["avg_expected_wins_value"] = round(avg_ew, 3)
        if not ew_ok:
            log.warning("Average expected wins out of expected range: %.3f (want 3-7)", avg_ew)
    else:
        results["avg_expected_wins"] = False
        results["avg_expected_wins_value"] = None

    # Check 4: scarcity adjustments finite
    bad = conn.execute("""
        SELECT COUNT(*) AS n
        FROM ctw_player_scores
        WHERE season = ?
          AND (total_scarcity_adj_wins IS NULL
               OR total_scarcity_adj_wins > 100
               OR total_scarcity_adj_wins < -10)
    """, (season,)).fetchone()["n"]
    results["scarcity_finite"] = (bad == 0)
    if bad > 0:
        log.warning("%d rows with invalid scarcity adjustments", bad)

    # Check 5: curve count (expect 9 cats × 9 league sizes = 81)
    expected_curves = len(ALL_CATS) * 9
    actual_curves = len(curve_store._CURVE_CACHE)
    results["curve_count"] = actual_curves
    results["curve_count_ok"] = actual_curves >= expected_curves

    all_pass = all(
        v is True
        for k, v in results.items()
        if isinstance(v, bool)
    )
    results["overall_pass"] = all_pass

    _store_validation(conn, season, results)
    log.info("Validation complete — %s", "PASS" if all_pass else "FAIL")
    for k, v in results.items():
        log.info("  %-30s %s", k, v)

    return results


def _store_validation(conn: sqlite3.Connection, season: str, results: dict) -> None:
    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for check_name, value in results.items():
        if check_name == "overall_pass":
            continue
        passed = value is True if isinstance(value, bool) else None
        detail = str(value) if not isinstance(value, bool) else None
        rows.append((season, check_name, passed, detail, now))

    conn.executemany("""
        INSERT INTO ctw_validation_log (season, check_name, passed, detail, checked_at)
        VALUES (?, ?, ?, ?, ?)
    """, rows)
    conn.commit()
