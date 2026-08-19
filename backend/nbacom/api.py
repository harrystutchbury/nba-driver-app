"""
api.py — FastAPI router for NBA.com tracking/hustle stat endpoints.

Mount in main.py:
    from nbacom.api import router as nbacom_router
    app.include_router(nbacom_router, prefix="/api")
"""

from __future__ import annotations

import os
import sys
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from schema import get_conn  # noqa: E402
from nbacom.client import MEASURE_TYPES, MEASURE_COL_MAP, ALL_STAT_DB_COLS  # noqa: E402

router = APIRouter(tags=["nbacom"])

VALID_PERIODS = {"full_season", "last_30", "last_14"}


def _get_player_id_for_slug(conn, slug: str) -> int | None:
    row = conn.execute(
        "SELECT nba_com_player_id FROM nbacom_player_id_mapping WHERE our_player_id = ?",
        (slug,),
    ).fetchone()
    return row["nba_com_player_id"] if row else None


def _rows_to_dicts(rows) -> list[dict]:
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# GET /nbacom-stats/player/{player_id}
# ---------------------------------------------------------------------------

@router.get("/nbacom-stats/player/{player_id}")
def get_player_nbacom_stats(
    player_id: str,
    period: str = Query(default="full_season", description="full_season | last_30 | last_14"),
    season:  str = Query(default="2025-26"),
):
    """
    Return all tracking and hustle stats for a player across all measure types.
    Includes both season averages and the last 20 game log entries per measure type.
    """
    if period not in VALID_PERIODS:
        raise HTTPException(status_code=400, detail=f"period must be one of {sorted(VALID_PERIODS)}")

    conn = get_conn()
    nba_com_id = _get_player_id_for_slug(conn, player_id)

    # ── Season averages ────────────────────────────────────────────────────
    avg_rows = conn.execute(
        """
        SELECT measure_type, gp, min, *
        FROM nbacom_stats_season_avg
        WHERE nba_com_player_id = ? AND season = ? AND period = ?
        """,
        (nba_com_id, season, period),
    ).fetchall() if nba_com_id else []

    averages: dict[str, dict] = {}
    for r in avg_rows:
        d = dict(r)
        mt = d.pop("measure_type")
        averages[mt] = d

    # ── Full-season per-game log across all measure types (nbacom data is
    #    single-season, ~1k rows/player, so no practical limit needed) ────────
    game_log_raw = conn.execute(
        """
        SELECT game_date, measure_type, gp, min, *
        FROM nbacom_stats_game_log
        WHERE nba_com_player_id = ?
        ORDER BY game_date DESC
        LIMIT 3000
        """,
        (nba_com_id,),
    ).fetchall() if nba_com_id else []

    # Group by game_date → measure_type
    game_log: dict[str, dict[str, dict]] = {}
    for r in game_log_raw:
        d = dict(r)
        gd = d.pop("game_date")
        mt = d.pop("measure_type")
        game_log.setdefault(gd, {})[mt] = d

    conn.close()

    if not averages and not game_log:
        raise HTTPException(
            status_code=404,
            detail=f"No NBA.com tracking data found for '{player_id}'. "
                   f"Run the backfill if data hasn't been loaded yet.",
        )

    return {
        "player_id":  player_id,
        "season":     season,
        "period":     period,
        "averages":   averages,   # {measure_type: {stat: value, ...}}
        "game_log":   game_log,   # {game_date: {measure_type: {stat: value}}}
    }


# ---------------------------------------------------------------------------
# GET /nbacom-stats/leaders
# ---------------------------------------------------------------------------

@router.get("/nbacom-stats/leaders")
def get_nbacom_leaders(
    measure_type: str = Query(..., description="One of the 12 pt_measure_type values"),
    stat:         str = Query(..., description="Stat column name, e.g. DEFLECTIONS"),
    period:       str = Query(default="full_season", description="full_season | last_30 | last_14"),
    season:       str = Query(default="2025-26"),
    limit:        int = Query(default=25, ge=1, le=200),
):
    """
    Return top players for a specific tracking/hustle stat.

    Example: GET /nbacom-stats/leaders?measure_type=Defense&stat=DEFLECTIONS&period=last_14
    """
    if measure_type not in MEASURE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"measure_type must be one of: {', '.join(MEASURE_TYPES)}",
        )
    if period not in VALID_PERIODS:
        raise HTTPException(status_code=400, detail=f"period must be one of {sorted(VALID_PERIODS)}")

    # Accept both UPPER_CASE API names and snake_case DB names
    stat_db = stat.lower()
    if stat_db not in ALL_STAT_DB_COLS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown stat '{stat}'. Valid stats for {measure_type}: "
                   + ", ".join(MEASURE_COL_MAP[measure_type].values()),
        )

    conn = get_conn()
    rows = conn.execute(
        f"""
        SELECT
            s.nba_com_player_id,
            s.player_id,
            m.player_name,
            m.team_abbreviation,
            s.gp,
            s.min,
            s.{stat_db}
        FROM nbacom_stats_season_avg s
        LEFT JOIN nbacom_player_id_mapping m ON m.nba_com_player_id = s.nba_com_player_id
        WHERE s.measure_type = ? AND s.season = ? AND s.period = ?
          AND s.{stat_db} IS NOT NULL
        ORDER BY s.{stat_db} DESC
        LIMIT ?
        """,
        (measure_type, season, period, limit),
    ).fetchall()
    conn.close()

    return {
        "measure_type": measure_type,
        "stat":         stat_db,
        "period":       period,
        "season":       season,
        "leaders":      _rows_to_dicts(rows),
    }


# ---------------------------------------------------------------------------
# GET /nbacom-stats/pipeline-status
# ---------------------------------------------------------------------------

@router.get("/nbacom-stats/pipeline-status")
def get_pipeline_status():
    """
    Returns last run time, success/failure per measure type, and unmatched players.
    """
    conn = get_conn()

    # Last run per measure type
    measure_status = conn.execute(
        """
        SELECT
            measure_type,
            MAX(run_date)       AS last_run_date,
            success,
            error_message,
            rows_pulled,
            duration_seconds
        FROM nbacom_pipeline_log
        GROUP BY measure_type
        ORDER BY measure_type
        """
    ).fetchall()

    # Overall last successful full run (all 12 measure types passed)
    last_full_run = conn.execute(
        """
        SELECT run_date, COUNT(*) AS measure_count
        FROM nbacom_pipeline_log
        WHERE success = 1
        GROUP BY run_date
        HAVING COUNT(*) = ?
        ORDER BY run_date DESC
        LIMIT 1
        """,
        (len(MEASURE_TYPES),),
    ).fetchone()

    # Unmatched players (last 30 days)
    cutoff = (date.today() - timedelta(days=30)).isoformat()
    unmatched = conn.execute(
        """
        SELECT nba_com_player_id, player_name, team_abbreviation,
               MAX(game_date) AS last_seen
        FROM nbacom_unmatched_players
        WHERE game_date >= ?
        GROUP BY nba_com_player_id
        ORDER BY last_seen DESC
        """,
        (cutoff,),
    ).fetchall()

    # Coverage summary
    coverage = conn.execute(
        """
        SELECT
            MIN(game_date) AS earliest_date,
            MAX(game_date) AS latest_date,
            COUNT(DISTINCT game_date) AS game_days,
            COUNT(DISTINCT nba_com_player_id) AS players
        FROM nbacom_stats_game_log
        """
    ).fetchone()

    conn.close()

    return {
        "last_full_run":        dict(last_full_run) if last_full_run else None,
        "measure_type_status":  _rows_to_dicts(measure_status),
        "unmatched_players":    _rows_to_dicts(unmatched),
        "coverage":             dict(coverage) if coverage else None,
    }
