"""
Scarcity and variance adjustments applied on top of base expected wins.

Scarcity:
    Measures how much better a player is than the best available replacement
    (the player just outside the drafted player pool for this league size).
    Applied as: adjusted = base × log(scarcity_multiplier + 1)
    The +1 prevents log(0) and log-compresses the scale.

Variance (togglable, off by default):
    Individual player consistency — a stable contributor is worth more
    than a boom-bust player with the same mean CTW.
    Currently a stub pending empirical investigation.
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone

import numpy as np

from .constants import REPLACEMENT_MULTIPLIER, ROSTER_SIZE

log = logging.getLogger(__name__)

_CAT_COLS = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m", "fg", "ft"]
# fg3m stored as '3pm' in DB column names
_DB_SUFFIX = {cat: cat for cat in _CAT_COLS}
_DB_SUFFIX["fg3m"] = "3pm"


def apply_scarcity(
    conn: sqlite3.Connection,
    season: str,
    league_sizes: list[int] | None = None,
    periods: list[str] | None = None,
) -> None:
    """
    Calculate scarcity adjustments and update ctw_player_scores in-place.

    Replacement level = average expected wins of players ranked just outside
    the top (league_size × roster_size × REPLACEMENT_MULTIPLIER) by total_expected_wins.
    """
    if league_sizes is None:
        league_sizes = list(range(8, 17))
    if periods is None:
        periods = ["full_season", "last_30", "last_14"]

    now = datetime.now(timezone.utc).isoformat()

    for period in periods:
        for ls in league_sizes:
            rows = conn.execute("""
                SELECT player_slug,
                    expected_wins_pts, expected_wins_reb, expected_wins_ast,
                    expected_wins_stl, expected_wins_blk, expected_wins_tov,
                    expected_wins_3pm, expected_wins_fg, expected_wins_ft,
                    total_expected_wins
                FROM ctw_player_scores
                WHERE season = ? AND league_size = ? AND period = ?
                ORDER BY total_expected_wins DESC
            """, (season, ls, period)).fetchall()

            if not rows:
                continue

            pool_size = int(ls * ROSTER_SIZE * REPLACEMENT_MULTIPLIER)
            drafted   = rows[:pool_size]
            undrafted = rows[pool_size:]

            # Replacement level: mean expected wins per category of the fringe players
            # Use the top 10 undrafted as the replacement pool (or all if fewer)
            repl_sample = undrafted[:10] if len(undrafted) >= 10 else undrafted
            if not repl_sample:
                repl_sample = drafted[-5:]  # fallback

            repl_ew: dict[str, float] = {}
            for cat in _CAT_COLS:
                col = f"expected_wins_{_DB_SUFFIX[cat]}"
                vals = [r[col] or 0.0 for r in repl_sample]
                repl_ew[cat] = float(np.mean(vals)) if vals else 0.5

            # Apply to every player
            updates = []
            for row in rows:
                adj: dict[str, float] = {}
                for cat in _CAT_COLS:
                    col     = f"expected_wins_{_DB_SUFFIX[cat]}"
                    base_ew = row[col] or 0.0
                    if base_ew < 0:
                        # Negative contribution passes through — player is hurting you
                        # in this category, scarcity doesn't compress that penalty
                        adj[cat] = base_ew
                    else:
                        repl     = max(repl_ew[cat], 0.01)
                        ratio    = base_ew / repl
                        adj[cat] = base_ew * float(np.log(ratio + 1.0))

                total_adj = sum(adj.values())
                updates.append((
                    adj["pts"], adj["reb"], adj["ast"], adj["stl"], adj["blk"],
                    adj["tov"], adj["fg3m"], adj["fg"], adj["ft"],
                    total_adj, now,
                    row["player_slug"], season, ls, period,
                ))

            conn.executemany("""
                UPDATE ctw_player_scores SET
                    scarcity_adj_pts=?, scarcity_adj_reb=?, scarcity_adj_ast=?,
                    scarcity_adj_stl=?, scarcity_adj_blk=?, scarcity_adj_tov=?,
                    scarcity_adj_3pm=?, scarcity_adj_fg=?, scarcity_adj_ft=?,
                    total_scarcity_adj_wins=?, calculated_at=?
                WHERE player_slug=? AND season=? AND league_size=? AND period=?
            """, updates)

        conn.commit()
        log.info("Scarcity adjustment applied for period=%s, %d league sizes", period, len(league_sizes))


def apply_variance(
    conn: sqlite3.Connection,
    distributions: dict[str, dict[str, "np.ndarray"]],
    season: str,
    enabled: bool = False,
) -> None:
    """
    Variance adjustment: togglable, off by default.

    When enabled, adjusts expected wins by the coefficient of variation (CV)
    of each player's weekly production relative to the population CV.
    A more consistent player gets a small upward adjustment.
    Pending empirical validation — do not enable in production without testing.
    """
    if not enabled:
        return

    log.warning(
        "Variance adjustment is experimental and not yet validated. "
        "Set enabled=True only for testing."
    )
    # Stub: population CV per category
    # cv_player = std(weekly_dist) / mean(weekly_dist)
    # cv_pop    = mean of cv_player across all players
    # adj_factor = cv_pop / cv_player  (consistent player > 1, volatile < 1)
    # Apply small weight: adjusted_ew = base_ew × (1 + 0.1 × (adj_factor - 1))
    pass
