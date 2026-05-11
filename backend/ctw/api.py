"""
FastAPI router for CTW endpoints.

Mount in main.py:
    from ctw.api import ctw_router
    app.include_router(ctw_router)
"""

from __future__ import annotations

import logging
import os
import sys
import threading

from fastapi import APIRouter, HTTPException, Query, Body, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from schema import get_conn
from ctw import curves as curve_mod, player_scores as ps_mod, adjustments
from ctw.schema import init_ctw_tables

log = logging.getLogger(__name__)

ctw_router = APIRouter(prefix="/api/ctw", tags=["ctw"])

_DEFAULT_SEASON = "2024-25"
_DEFAULT_LS = 10
_DEFAULT_PERIOD = "full_season"

_http_bearer = HTTPBearer()
_run_lock = threading.Lock()
_run_status: dict = {"running": False, "last": None}


def _require_admin(credentials: HTTPAuthorizationCredentials = Depends(_http_bearer)) -> str:
    from jose import JWTError, jwt
    JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-in-production")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
        username: str = payload["sub"]
    except (JWTError, KeyError):
        raise HTTPException(status_code=401, detail="Invalid token")
    conn = get_conn()
    row = conn.execute("SELECT is_admin FROM users WHERE username=?", [username]).fetchone()
    if not (row and row["is_admin"]):
        raise HTTPException(status_code=403, detail="Admin only")
    return username


def _ensure_cache() -> None:
    if not curve_mod.is_cache_populated():
        conn = get_conn()
        curve_mod.load_curves_into_cache(conn)


@ctw_router.get("/rankings")
def get_rankings(
    season:      str = Query(_DEFAULT_SEASON),
    league_size: int = Query(_DEFAULT_LS, ge=8, le=16),
    period:      str = Query(_DEFAULT_PERIOD, pattern="^(full_season|last_30|last_14)$"),
    limit:       int = Query(50, ge=1, le=200),
    use_scarcity: bool = Query(False),
):
    """
    Return CTW rankings for all qualifying players.

    sort_by: total_scarcity_adj_wins if use_scarcity else total_expected_wins
    """
    conn = get_conn()
    sort_col = "total_scarcity_adj_wins" if use_scarcity else "total_expected_wins"

    rows = conn.execute(f"""
        SELECT
            s.player_slug,
            pl.full_name,
            pl.team,
            s.period,
            s.ctw_pct_pts, s.ctw_pct_reb, s.ctw_pct_ast, s.ctw_pct_stl, s.ctw_pct_blk,
            s.ctw_pct_tov, s.ctw_pct_3pm, s.ctw_pct_fg, s.ctw_pct_ft,
            s.expected_wins_pts, s.expected_wins_reb, s.expected_wins_ast,
            s.expected_wins_stl, s.expected_wins_blk, s.expected_wins_tov,
            s.expected_wins_3pm, s.expected_wins_fg, s.expected_wins_ft,
            s.total_expected_wins,
            s.scarcity_adj_pts, s.scarcity_adj_reb, s.scarcity_adj_ast,
            s.scarcity_adj_stl, s.scarcity_adj_blk, s.scarcity_adj_tov,
            s.scarcity_adj_3pm, s.scarcity_adj_fg, s.scarcity_adj_ft,
            s.total_scarcity_adj_wins
        FROM ctw_player_scores s
        LEFT JOIN players pl ON pl.slug = s.player_slug AND pl.season = s.season
        WHERE s.season = ? AND s.league_size = ? AND s.period = ?
        ORDER BY {sort_col} DESC
        LIMIT ?
    """, (season, league_size, period, limit)).fetchall()

    return {"rankings": [dict(r) for r in rows]}


@ctw_router.get("/player/{player_slug}")
def get_player_ctw(
    player_slug: str,
    season:      str = Query(_DEFAULT_SEASON),
    league_size: int = Query(_DEFAULT_LS, ge=8, le=16),
):
    """Return CTW scores across all periods for a single player."""
    conn = get_conn()
    rows = conn.execute("""
        SELECT *
        FROM ctw_player_scores
        WHERE player_slug = ? AND season = ? AND league_size = ?
        ORDER BY CASE period
            WHEN 'full_season' THEN 1
            WHEN 'last_30'     THEN 2
            WHEN 'last_14'     THEN 3
        END
    """, (player_slug, season, league_size)).fetchall()

    if not rows:
        raise HTTPException(status_code=404, detail="No CTW data for this player")

    return {"player_slug": player_slug, "season": season, "league_size": league_size,
            "periods": [dict(r) for r in rows]}


@ctw_router.get("/curves")
def get_curves(
    category:    str = Query(..., description="Category name: pts|reb|ast|stl|blk|tov|fg3m|fg|ft"),
    league_size: int = Query(_DEFAULT_LS, ge=8, le=16),
):
    """Return the full win-probability curve for one (category, league_size) pair."""
    _ensure_cache()
    data = curve_mod.get_curve_for_display(category, league_size)
    if not data:
        raise HTTPException(status_code=404, detail=f"No curve for {category} ls={league_size}")
    return {"category": category, "league_size": league_size, "curve": data}


@ctw_router.post("/personalised")
def personalised_ctw(
    body: dict = Body(...),
):
    """
    Calculate CTW for a custom roster (passed in body).

    Body: {season, league_size, roster: [player_slug, ...]}
    Returns per-player CTW and aggregated roster strength.
    """
    season      = body.get("season", _DEFAULT_SEASON)
    league_size = int(body.get("league_size", _DEFAULT_LS))
    roster      = body.get("roster", [])

    if not roster:
        raise HTTPException(status_code=400, detail="roster must be non-empty")

    conn = get_conn()
    placeholders = ",".join("?" * len(roster))
    rows = conn.execute(f"""
        SELECT *
        FROM ctw_player_scores
        WHERE player_slug IN ({placeholders})
          AND season = ? AND league_size = ? AND period = 'full_season'
    """, (*roster, season, league_size)).fetchall()

    players = [dict(r) for r in rows]
    total_ew = sum(p["total_expected_wins"] or 0 for p in players)

    return {"season": season, "league_size": league_size,
            "players": players, "roster_total_ew": round(total_ew, 3)}


@ctw_router.post("/recalculate")
def recalculate(body: dict = Body(...)):
    """
    Trigger partial recalculation of player scores + scarcity for a given season.
    Does NOT re-run the simulation (curves stay fixed).
    Use the CLI (ctw.run) to re-run the full simulation.
    """
    season      = body.get("season", _DEFAULT_SEASON)
    league_sizes = body.get("league_sizes", list(range(8, 17)))
    periods      = body.get("periods", ["full_season", "last_30", "last_14"])

    conn = get_conn()
    init_ctw_tables(conn)

    if not curve_mod.is_cache_populated():
        curve_mod.load_curves_into_cache(conn)

    ps_mod.calculate_and_store(conn, season, league_sizes=league_sizes, periods=periods)
    adjustments.apply_scarcity(conn, season, league_sizes=league_sizes, periods=periods)

    return {"status": "ok", "season": season,
            "league_sizes": league_sizes, "periods": periods}


@ctw_router.get("/validation")
def get_validation(season: str = Query(_DEFAULT_SEASON)):
    """Return the latest validation results for a season."""
    conn = get_conn()
    rows = conn.execute("""
        SELECT * FROM ctw_validation_log
        WHERE season = ?
        ORDER BY checked_at DESC
        LIMIT 50
    """, (season,)).fetchall()
    return {"season": season, "checks": [dict(r) for r in rows]}


@ctw_router.post("/run")
def run_simulation(
    body: dict = Body(default={}),
    _admin: str = Depends(_require_admin),
):
    """
    Trigger a full CTW simulation run on the server (admin only).
    Runs in a background thread — returns immediately.
    Poll /api/ctw/run/status to check progress.
    """
    season = body.get("season", _DEFAULT_SEASON)

    if _run_status["running"]:
        return {"status": "already_running", "season": _run_status.get("season")}

    def _run():
        if not _run_lock.acquire(blocking=False):
            return
        try:
            _run_status["running"] = True
            _run_status["season"] = season
            _run_status["error"] = None
            log.info("CTW simulation starting for season=%s", season)
            from ctw import run as ctw_run
            ctw_run.run(season)
            _run_status["last"] = season
            log.info("CTW simulation complete for season=%s", season)
        except Exception as e:
            log.exception("CTW simulation failed")
            _run_status["error"] = str(e)
        finally:
            _run_status["running"] = False
            _run_lock.release()

    threading.Thread(target=_run, daemon=True).start()
    return {"status": "started", "season": season}


@ctw_router.get("/run/status")
def run_status(_admin: str = Depends(_require_admin)):
    """Return the current simulation run status."""
    return _run_status
