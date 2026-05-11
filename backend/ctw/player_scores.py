"""
Calculate CTW% per category per player and look up expected wins from the curves.

CTW% for counting stats:
    (player_weekly_avg / avg_winning_total) × 100

CTW% for FG%/FT%:
    player's marginal contribution to team rate × (1 / avg_winning_total) × 100
    where marginal contribution = team_fg%_with - team_fg%_without
    calculated against the simulated average team baseline.
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone

import numpy as np

from . import curves as curve_store
from .constants import ALL_CATS, MIN_GAMES, MIN_MIN_PG

log = logging.getLogger(__name__)

_PERIODS = {
    "full_season": None,   # no date filter
    "last_30":     30,
    "last_14":     14,
}


def _player_averages(conn: sqlite3.Connection, season: str, days: int | None) -> list[dict]:
    """Return per-game averages for all qualifying players in the given window."""
    date_filter = ""
    params: tuple = (season,)
    if days:
        date_filter = f"AND game_date >= date('now', '-{days} days')"

    rows = conn.execute(f"""
        SELECT
            player_slug                 AS slug,
            COUNT(*)                    AS n_games,
            AVG(pts)                    AS pts,
            AVG(reb)                    AS reb,
            AVG(ast)                    AS ast,
            AVG(stl)                    AS stl,
            AVG(blk)                    AS blk,
            AVG(tov)                    AS tov,
            AVG(fg3m)                   AS fg3m,
            SUM(fgm) * 1.0 / NULLIF(SUM(fga), 0) AS fg_pct,
            SUM(ftm) * 1.0 / NULLIF(SUM(fta), 0) AS ft_pct,
            AVG(fgm)                    AS fgm_pg,
            AVG(fga)                    AS fga_pg,
            AVG(ftm)                    AS ftm_pg,
            AVG(fta)                    AS fta_pg
        FROM game_logs
        WHERE season = ? AND min >= 5 {date_filter}
        GROUP BY player_slug
        HAVING COUNT(*) >= ? AND AVG(min) >= ?
    """, (*params, MIN_GAMES, MIN_MIN_PG)).fetchall()

    return [dict(r) for r in rows]


def _ctw_pct(player: dict, baselines: dict, league_size: int) -> dict[str, float]:
    """
    Return CTW% for each category for a given player against the simulated baselines.
    """
    bl = baselines.get(league_size, {})
    pcts: dict[str, float] = {}

    # Counting stats: weekly avg ≈ per-game avg × 3.5
    for cat, col in [
        ("pts", "pts"), ("reb", "reb"), ("ast", "ast"),
        ("stl", "stl"), ("blk", "blk"), ("tov", "tov"), ("fg3m", "fg3m"),
    ]:
        avg_winning = bl.get(cat, {}).get("avg_winning_total", 1.0)
        player_weekly = (player.get(col) or 0.0) * 3.5
        pcts[cat] = (player_weekly / avg_winning * 100.0) if avg_winning else 0.0

    # FG% delta: marginal contribution against average team baseline
    for pct_cat, (made_col, att_col, base_made, base_att) in {
        "fg": ("fgm_pg", "fga_pg", "avg_team_fgm", "avg_team_fga"),
        "ft": ("ftm_pg", "fta_pg", "avg_team_ftm", "avg_team_fta"),
    }.items():
        avg_winning_rate = bl.get(pct_cat, {}).get("avg_winning_total", 1.0)
        if not avg_winning_rate:
            pcts[pct_cat] = 0.0
            continue

        # team baseline is already weekly (from simulation); player cols are per-game → ×3.5
        team_made = bl.get("_team_volume", {}).get(base_made, 0.0)
        team_att  = bl.get("_team_volume", {}).get(base_att,  1.0)
        p_made    = (player.get(made_col) or 0.0) * 3.5
        p_att     = (player.get(att_col)  or 0.0) * 3.5

        if team_att + p_att == 0:
            pcts[pct_cat] = 0.0
            continue

        rate_with    = (team_made + p_made) / (team_att + p_att)
        rate_without = team_made / team_att if team_att > 0 else 0.0
        delta        = rate_with - rate_without
        pcts[pct_cat] = (delta / avg_winning_rate) * 100.0

    return pcts


def calculate_and_store(
    conn: sqlite3.Connection,
    season: str,
    league_sizes: list[int] | None = None,
    periods: list[str] | None = None,
) -> None:
    """
    Calculate CTW% and expected wins for every qualifying player,
    for every (league_size, period) combination, and upsert into ctw_player_scores.
    """
    if league_sizes is None:
        league_sizes = list(range(8, 17))
    if periods is None:
        periods = list(_PERIODS.keys())

    if not curve_store.is_cache_populated():
        curve_store.load_curves_into_cache()

    baselines = _load_baselines(conn)

    now = datetime.now(timezone.utc).isoformat()
    rows_to_upsert = []

    for period in periods:
        days = _PERIODS[period]
        players = _player_averages(conn, season, days)
        log.info("Period %s: %d qualifying players", period, len(players))

        for ls in league_sizes:
            for player in players:
                slug = player["slug"]
                pcts = _ctw_pct(player, baselines, ls)

                # Look up expected wins from curves
                ew: dict[str, float] = {}
                cat_map = {
                    "pts": "pts", "reb": "reb", "ast": "ast",
                    "stl": "stl", "blk": "blk", "tov": "tov",
                    "fg3m": "fg3m", "fg": "fg", "ft": "ft",
                }
                for cat_key, cat_name in cat_map.items():
                    try:
                        ew[cat_key] = curve_store.lookup(cat_name, ls, pcts.get(cat_key, 0.0))
                    except KeyError:
                        ew[cat_key] = 0.5  # fallback if curve missing

                total_ew = sum(ew.values())

                rows_to_upsert.append((
                    slug, season, ls, period,
                    pcts.get("pts"),  pcts.get("reb"),  pcts.get("ast"),
                    pcts.get("stl"),  pcts.get("blk"),  pcts.get("tov"),
                    pcts.get("fg3m"), pcts.get("fg"),   pcts.get("ft"),
                    ew.get("pts"),    ew.get("reb"),     ew.get("ast"),
                    ew.get("stl"),    ew.get("blk"),     ew.get("tov"),
                    ew.get("fg3m"),   ew.get("fg"),      ew.get("ft"),
                    total_ew,
                    # scarcity columns filled in by adjustments.py
                    None, None, None, None, None, None, None, None, None, None,
                    now,
                ))

    conn.executemany("""
        INSERT OR REPLACE INTO ctw_player_scores (
            player_slug, season, league_size, period,
            ctw_pct_pts, ctw_pct_reb, ctw_pct_ast, ctw_pct_stl, ctw_pct_blk,
            ctw_pct_tov, ctw_pct_3pm, ctw_pct_fg, ctw_pct_ft,
            expected_wins_pts, expected_wins_reb, expected_wins_ast,
            expected_wins_stl, expected_wins_blk, expected_wins_tov,
            expected_wins_3pm, expected_wins_fg, expected_wins_ft,
            total_expected_wins,
            scarcity_adj_pts, scarcity_adj_reb, scarcity_adj_ast,
            scarcity_adj_stl, scarcity_adj_blk, scarcity_adj_tov,
            scarcity_adj_3pm, scarcity_adj_fg, scarcity_adj_ft,
            total_scarcity_adj_wins,
            calculated_at
        ) VALUES (
            ?,?,?,?,  ?,?,?,?,?,  ?,?,?,?,
            ?,?,?,?,?,?,?,?,?,  ?,
            ?,?,?,?,?,?,?,?,?,?,  ?
        )
    """, rows_to_upsert)
    conn.commit()
    log.info("Upserted %d player score rows", len(rows_to_upsert))


def _load_baselines(conn: sqlite3.Connection) -> dict:
    """Return baselines from npz cache (falls back to DB if cache empty)."""
    if curve_store._BASELINE_CACHE:
        baselines: dict = {}
        for (ls, cat), vals in curve_store._BASELINE_CACHE.items():
            if ls not in baselines:
                baselines[ls] = {"_team_volume": {}}
            baselines[ls][cat] = {
                "avg_winning_total": vals["avg_winning_total"],
                "avg_losing_total":  vals["avg_losing_total"],
            }
            if vals.get("avg_team_fgm"):
                baselines[ls]["_team_volume"]["avg_team_fgm"] = vals["avg_team_fgm"]
                baselines[ls]["_team_volume"]["avg_team_fga"] = vals["avg_team_fga"]
                baselines[ls]["_team_volume"]["avg_team_ftm"] = vals["avg_team_ftm"]
                baselines[ls]["_team_volume"]["avg_team_fta"] = vals["avg_team_fta"]
        return baselines

    rows = conn.execute("SELECT * FROM ctw_league_baselines").fetchall()
    baselines = {}
    for r in rows:
        ls  = r["league_size"]
        cat = r["category"]
        if ls not in baselines:
            baselines[ls] = {"_team_volume": {}}
        baselines[ls][cat] = {
            "avg_winning_total": r["avg_winning_total"],
            "avg_losing_total":  r["avg_losing_total"],
        }
        if r["avg_team_fgm"] is not None:
            baselines[ls]["_team_volume"]["avg_team_fgm"] = r["avg_team_fgm"]
            baselines[ls]["_team_volume"]["avg_team_fga"] = r["avg_team_fga"]
            baselines[ls]["_team_volume"]["avg_team_ftm"] = r["avg_team_ftm"]
            baselines[ls]["_team_volume"]["avg_team_fta"] = r["avg_team_fta"]
    return baselines
