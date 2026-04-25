"""
main.py — FastAPI backend for the NBA stat driver app.

Endpoints:
  GET /players              — search players in the database
  GET /player-stats         — season/career/L30/L14 averages for a player
  GET /decompose            — run driver decomposition for a player + stat + two periods

Run locally:
  uvicorn api.main:app --reload
  or from the backend folder:
  uvicorn main:app --reload
"""

from fastapi import FastAPI, APIRouter, HTTPException, Query, Body, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from contextlib import asynccontextmanager
from typing import Optional
import sys
import os
import math
import logging
from datetime import datetime

from jose import JWTError, jwt
import hashlib
import secrets as _secrets

import numpy as np
from apscheduler.schedulers.background import BackgroundScheduler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from schema import get_conn
from engine.decompose import decompose
from engine.shots import decompose_shots
from engine.training_data import build_dataset
from engine.archetypes import assign_archetypes, ARCHETYPES, _assign_row
from engine.regress import REG_FEATURES, REG_TARGETS, predict as regress_predict, load_model
from engine.aging import build_aging_curves, aging_ratio as _aging_ratio, aging_ratio_std as _aging_ratio_std, RATIO_FLOOR, RATIO_CAP

logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------
# Auth
# -----------------------------------------------------------------------

JWT_SECRET    = os.environ.get("JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
_http_bearer  = HTTPBearer()


def _hash_password(password: str, salt: str) -> str:
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return dk.hex()


def _make_password_hash(password: str) -> str:
    salt = _secrets.token_hex(16)
    return f"{salt}${_hash_password(password, salt)}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt, hashed = stored.split("$", 1)
        return _secrets.compare_digest(_hash_password(password, salt), hashed)
    except Exception:
        return False


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(_http_bearer)) -> str:
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload["sub"]
    except (JWTError, KeyError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(_http_bearer)):
    get_current_user(credentials)


def _get_injury_map(conn):
    """Return dict of player_slug -> {designation, description} for all injured players."""
    rows = conn.execute(
        "SELECT player_slug, designation, description FROM injuries"
    ).fetchall()
    return {r["player_slug"]: {"designation": r["designation"], "description": r["description"]} for r in rows}


def _current_season_end_year():
    now = datetime.utcnow()
    return now.year + 1 if now.month >= 10 else now.year


def _daily_refresh():
    """Pull last 2 days of game logs from Tank01 and upsert into DB."""
    try:
        import ingest_tank01
        from datetime import date, timedelta
        season_year = _current_season_end_year()
        since = date.today() - timedelta(days=2)
        logger.info(f"Daily Tank01 refresh starting (season {season_year}, since {since})")
        ingest_tank01.ingest(season_year, since_date=since)
        logger.info("Daily Tank01 refresh complete")
    except Exception:
        logger.exception("Daily Tank01 refresh failed")

    try:
        import sync_injuries
        logger.info("Injury sync starting")
        sync_injuries.sync()
        logger.info("Injury sync complete")
    except Exception:
        logger.exception("Injury sync failed")


def _weekly_schedule_sync():
    """Re-fetch upcoming schedule from Tank01 (playoff brackets update weekly)."""
    try:
        import upload_schedule
        logger.info("Weekly schedule sync starting")
        upload_schedule.run()
        logger.info("Weekly schedule sync complete")
    except Exception:
        logger.exception("Weekly schedule sync failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    from schema import init_db
    init_db()
    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(_daily_refresh, 'cron', hour=8, minute=0)
    scheduler.add_job(_weekly_schedule_sync, 'cron', day_of_week='mon', hour=9, minute=0)
    # Injury sync every 3 hours so status stays fresh throughout the day
    scheduler.add_job(
        lambda: __import__('sync_injuries').sync(),
        'interval', hours=3,
        id='injury_sync',
    )
    scheduler.start()
    logger.info("Scheduler started — daily refresh 08:00 UTC, injury sync every 3h, schedule sync Mondays 09:00 UTC")
    yield
    scheduler.shutdown()


app = FastAPI(title="NBA Stat Driver API", lifespan=lifespan)
router = APIRouter(prefix="/api", dependencies=[Depends(verify_token)])

# Allow the React dev server to talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# -----------------------------------------------------------------------
# GET /players
# -----------------------------------------------------------------------

@router.get("/players")
def get_players(
    q: Optional[str] = Query(None, description="Search by name"),
    season: Optional[str] = Query(None, description="e.g. 2023-24"),
):
    """
    Return list of players in the database.
    Optionally filter by name search and/or season.
    """
    conn = get_conn()

    if season:
        sql = """
            SELECT slug, full_name, team, season
            FROM players
            WHERE season = ?
        """
        params = [season]
        if q:
            sql += " AND full_name LIKE ?"
            params.append(f"%{q}%")
        sql += " ORDER BY full_name"
    else:
        # Return one row per player — current team from most recent game log
        sql = """
            SELECT p.slug, p.full_name,
                   COALESCE(
                       (SELECT g.team FROM game_logs g WHERE g.player_slug = p.slug ORDER BY g.game_date DESC LIMIT 1),
                       p.team
                   ) AS team,
                   MAX(p.season) AS season
            FROM players p
            WHERE 1=1
        """
        params = []
        if q:
            sql += " AND p.full_name LIKE ?"
            params.append(f"%{q}%")
        sql += " GROUP BY p.slug ORDER BY p.full_name"

    rows = conn.execute(sql, params).fetchall()
    injury_map = _get_injury_map(conn)
    conn.close()

    return [
        {
            "slug":   r["slug"],
            "name":   r["full_name"],
            "team":   r["team"],
            "season": r["season"],
            "injury": injury_map.get(r["slug"]),
        }
        for r in rows
    ]


# -----------------------------------------------------------------------
# GET /player-stats
# -----------------------------------------------------------------------

Z_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fg3m', 'fg_pct', 'ft_pct']


def _avg_row(rows, team_game_map=None):
    """
    Aggregate a list of game_log rows into per-game averages.

    team_game_map: optional dict keyed by game_date ->
        {"team_fga": ..., "team_fta": ..., "team_tov": ...}
    When provided, USG% uses the proper BR formula:
        100 × [(FGA + 0.44×FTA + TOV) × (TeamMP/5)] / [MP × (TeamFGA + 0.44×TeamFTA + TeamTOV)]
    where TeamMP = 240 (5 players × 48 min).
    Falls back to simplified formula if team data is missing for a game.
    """
    if not rows:
        return None
    gp        = len(rows)
    pts       = sum(r["pts"]  for r in rows) / gp
    reb       = sum(r["reb"]  for r in rows) / gp
    ast       = sum(r["ast"]  for r in rows) / gp
    stl       = sum(r["stl"]  for r in rows) / gp
    blk       = sum(r["blk"]  for r in rows) / gp
    tov       = sum(r["tov"]  for r in rows) / gp
    fg3m      = sum(r["fg3m"] for r in rows) / gp
    min_pg    = sum(r["min"]  for r in rows) / gp
    fga_pg    = sum(r["fga"]  for r in rows) / gp
    fta_pg    = sum(r["fta"]  for r in rows) / gp
    total_fga = sum(r["fga"]  for r in rows)
    total_fta = sum(r["fta"]  for r in rows)
    fg_pct    = sum(r["fgm"]  for r in rows) / total_fga if total_fga else None
    ft_pct    = sum(r["ftm"]  for r in rows) / total_fta if total_fta else None

    # USG% — proper BR formula when team data available, simplified fallback otherwise
    usg_pct = None
    if min_pg > 0:
        if team_game_map:
            usg_nums, usg_dens = [], []
            for r in rows:
                tg = team_game_map.get(r["game_date"])
                player_poss = r["fga"] + 0.44 * r["fta"] + r["tov"]
                if tg and tg["team_fga"] is not None:
                    team_poss = tg["team_fga"] + 0.44 * tg["team_fta"] + tg["team_tov"]
                    if team_poss > 0 and r["min"] > 0:
                        usg_nums.append(player_poss * (240 / 5))
                        usg_dens.append(r["min"] * team_poss)
                else:
                    # fallback: assume 100 team possessions
                    if r["min"] > 0:
                        usg_nums.append(player_poss * 48)
                        usg_dens.append(r["min"] * 100)
            if usg_dens:
                usg_pct = round(100 * sum(usg_nums) / sum(usg_dens), 1)
        else:
            usg_pct = round((fga_pg + 0.44 * fta_pg + tov) * 48 / min_pg, 1)

    return {
        "gp":      gp,
        "min_pg":  round(min_pg, 1),
        "pts":     round(pts,  1),
        "reb":     round(reb,  1),
        "ast":     round(ast,  1),
        "stl":     round(stl,  1),
        "blk":     round(blk,  1),
        "tov":     round(tov,  1),
        "fg3m":    round(fg3m, 1),
        "fg_pct":  round(fg_pct * 100, 1) if fg_pct is not None else None,
        "ft_pct":  round(ft_pct * 100, 1) if ft_pct is not None else None,
        "fga_pg":  round(fga_pg, 1),
        "fta_pg":  round(fta_pg, 1),
        "usg_pct": usg_pct,
    }


def _league_data(conn, season=None, cutoff=None, min_games=10):
    """
    Fetch per-player averages for all qualifying players in a period.
    Returns (stats_dict, player_rows) where:
      stats_dict  — {stat: (mean, std)} for Z-score computation
      player_rows — list of dicts with player_slug + per-stat averages
    fg_pct and ft_pct are on the 0-100 scale to match _avg_row.
    """
    clauses = ["min > 0"]
    params  = []
    if season:
        clauses.append("season = ?")
        params.append(season)
    if cutoff:
        clauses.append("game_date >= ?")
        params.append(cutoff)
    where = " AND ".join(clauses)

    rows = conn.execute(f"""
        SELECT
            player_slug,
            AVG(min)  AS min_pg,
            AVG(pts)  AS pts,
            AVG(reb)  AS reb,
            AVG(ast)  AS ast,
            AVG(stl)  AS stl,
            AVG(blk)  AS blk,
            AVG(tov)  AS tov,
            AVG(fg3m) AS fg3m,
            SUM(fgm) * 100.0 / NULLIF(SUM(fga), 0) AS fg_pct,
            SUM(ftm) * 100.0 / NULLIF(SUM(fta), 0) AS ft_pct,
            AVG(fga) AS fga_pg,
            AVG(fta) AS fta_pg
        FROM game_logs
        WHERE {where}
        GROUP BY player_slug
        HAVING COUNT(*) >= ?
    """, params + [min_games]).fetchall()
    rows = [dict(r) for r in rows]

    if len(rows) < 2:
        return None, rows

    # League-mean FG%/FT% for volume-weighted impact calculation
    fg_vals = [r['fg_pct'] for r in rows if r['fg_pct'] is not None]
    ft_vals = [r['ft_pct'] for r in rows if r['ft_pct'] is not None]
    league_mean_fg = sum(fg_vals) / len(fg_vals) if fg_vals else None
    league_mean_ft = sum(ft_vals) / len(ft_vals) if ft_vals else None

    for r in rows:
        r['fg_impact'] = (
            (r['fg_pct'] - league_mean_fg) * r['fga_pg']
            if r['fg_pct'] is not None and league_mean_fg is not None else None
        )
        r['ft_impact'] = (
            (r['ft_pct'] - league_mean_ft) * r['fta_pg']
            if r['ft_pct'] is not None and league_mean_ft is not None else None
        )

    stats = {'_fg_mean': league_mean_fg, '_ft_mean': league_mean_ft}
    for key in Z_KEYS:
        if key == 'fg_pct':
            vals = [r['fg_impact'] for r in rows if r['fg_impact'] is not None]
        elif key == 'ft_pct':
            vals = [r['ft_impact'] for r in rows if r['ft_impact'] is not None]
        else:
            vals = [r[key] for r in rows if r[key] is not None]
        if len(vals) < 2:
            stats[key] = (None, None)
            continue
        mean = sum(vals) / len(vals)
        std  = math.sqrt(sum((v - mean) ** 2 for v in vals) / len(vals))
        stats[key] = (mean, std if std > 0 else None)

    return stats, rows


def _composite_z(player_avgs, league):
    """Sum of Z-scores across all stats (TOV inverted). Returns float or None."""
    if not league:
        return None
    total, count = 0.0, 0
    fg_mean = league.get('_fg_mean')
    ft_mean = league.get('_ft_mean')
    for key in Z_KEYS:
        mean, std = league.get(key, (None, None))
        if mean is None or std is None:
            continue
        if key == 'fg_pct':
            if 'fg_impact' in player_avgs:
                val = player_avgs['fg_impact']
            else:
                fg_pct = player_avgs.get('fg_pct')
                fga_pg = player_avgs.get('fga_pg')
                if fg_pct is None or fga_pg is None or fg_mean is None:
                    continue
                val = (fg_pct - fg_mean) * fga_pg
        elif key == 'ft_pct':
            if 'ft_impact' in player_avgs:
                val = player_avgs['ft_impact']
            else:
                ft_pct = player_avgs.get('ft_pct')
                fta_pg = player_avgs.get('fta_pg')
                if ft_pct is None or fta_pg is None or ft_mean is None:
                    continue
                val = (ft_pct - ft_mean) * fta_pg
        else:
            val = player_avgs.get(key)
        if val is None:
            continue
        z = (val - mean) / std
        total += (-z if key == 'tov' else z)
        count += 1
    return total if count > 0 else None


def _player_rank(player_slug, player_rows, league):
    """Return (rank, n_players) based on composite Z-score."""
    if not league or not player_rows:
        return None, None
    scores = []
    for r in player_rows:
        cz = _composite_z(r, league)
        if cz is not None:
            scores.append((r["player_slug"], cz))
    scores.sort(key=lambda x: x[1], reverse=True)
    n = len(scores)
    for i, (slug, _) in enumerate(scores):
        if slug == player_slug:
            return i + 1, n
    return None, n


def _with_zscores(avg, league):
    """Attach z_* keys to an avg_row dict."""
    if not avg or not league:
        return avg
    fg_mean = league.get('_fg_mean')
    ft_mean = league.get('_ft_mean')
    def z(key):
        mean, std = league.get(key, (None, None))
        if mean is None or std is None:
            return None
        if key == 'fg_pct':
            val    = avg.get('fg_pct')
            fga_pg = avg.get('fga_pg')
            if val is None or fga_pg is None or fg_mean is None:
                return None
            impact = (val - fg_mean) * fga_pg
            return round((impact - mean) / std, 2)
        if key == 'ft_pct':
            val    = avg.get('ft_pct')
            fta_pg = avg.get('fta_pg')
            if val is None or fta_pg is None or ft_mean is None:
                return None
            impact = (val - ft_mean) * fta_pg
            return round((impact - mean) / std, 2)
        val = avg.get(key)
        if val is None:
            return None
        return round((val - mean) / std, 2)
    return {**avg, **{f"z_{k}": z(k) for k in Z_KEYS}}


@router.get("/player-stats")
def get_player_stats(player: str = Query(..., description="Player slug")):
    """Return career, per-season, L30 and L14 averages + Z-scores for a player."""
    conn = get_conn()

    player_row = conn.execute(
        """SELECT p.full_name, p.team, b.birthdate, b.position_group
           FROM players p
           LEFT JOIN player_bio b ON b.br_slug = p.slug
           WHERE p.slug = ? ORDER BY p.season DESC LIMIT 1""", (player,)
    ).fetchone()
    if not player_row:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Player '{player}' not found.")

    # Team per season (use last entry for that season in case of trades)
    team_by_season = {
        r["season"]: r["team"]
        for r in conn.execute(
            "SELECT season, team FROM players WHERE slug = ? ORDER BY season, team", (player,)
        ).fetchall()
    }

    rows = conn.execute("""
        SELECT season, min, pts, reb, ast, stl, blk, tov, fgm, fga, fg3m, ftm, fta, game_date, team
        FROM game_logs
        WHERE player_slug = ? AND min > 0
        ORDER BY game_date DESC
    """, (player,)).fetchall()
    rows = [dict(r) for r in rows]

    # Fetch team game totals for USG% calculation (BR formula)
    dates = list({r["game_date"] for r in rows})
    team_game_map = {}
    if dates:
        placeholders = ",".join("?" * len(dates))
        tg_rows = conn.execute(f"""
            SELECT gl.game_date, tg.team_fga, tg.team_fta, tg.team_tov
            FROM game_logs gl
            JOIN team_games tg ON tg.team = gl.team AND tg.game_date = gl.game_date
            WHERE gl.player_slug = ? AND gl.game_date IN ({placeholders})
        """, [player] + dates).fetchall()
        for tg in tg_rows:
            team_game_map[tg["game_date"]] = {
                "team_fga": tg["team_fga"],
                "team_fta": tg["team_fta"],
                "team_tov": tg["team_tov"],
            }

    from datetime import date, timedelta
    today     = date.today()
    cutoff_30 = str(today - timedelta(days=30))
    cutoff_14 = str(today - timedelta(days=14))

    # Group by season
    seasons = {}
    for r in rows:
        seasons.setdefault(r["season"], []).append(r)

    # Precompute league data for each unique season + career + L30 + L14
    unique_seasons = list(seasons.keys())
    league_by_season, rows_by_season = {}, {}
    for s in unique_seasons:
        lg, pr = _league_data(conn, season=s, min_games=10)
        league_by_season[s] = lg
        rows_by_season[s]   = pr

    league_career, rows_career = _league_data(conn, min_games=20)
    league_l30,    rows_l30    = _league_data(conn, cutoff=cutoff_30, min_games=5)
    league_l14,    rows_l14    = _league_data(conn, cutoff=cutoff_14, min_games=3)

    injury_map = _get_injury_map(conn)
    conn.close()

    def with_rank(avg, league, player_rows):
        if avg is None:
            return None
        rank, n = _player_rank(player, player_rows, league)
        return {**_with_zscores(avg, league), "rank": rank, "rank_n": n}

    season_avgs = [
        {"period": s, "team": team_by_season.get(s, ""), **with_rank(_avg_row(g, team_game_map), league_by_season.get(s), rows_by_season.get(s, []))}
        for s, g in sorted(seasons.items(), reverse=True)
    ]

    # Calculate current age from birthdate
    current_age = None
    if player_row["birthdate"]:
        try:
            from datetime import datetime as dt
            bd = dt.strptime(player_row["birthdate"], "%Y-%m-%d").date()
            current_age = int((today - bd).days / 365.25)
        except Exception:
            pass

    return {
        "player":  {
            "slug":     player,
            "name":     player_row["full_name"],
            "team":     player_row["team"],
            "age":      current_age,
            "position": player_row["position_group"],
            "injury":   injury_map.get(player),
        },
        "career":  with_rank(_avg_row(rows,                                      team_game_map), league_career, rows_career),
        "seasons": season_avgs,
        "l30":     with_rank(_avg_row([r for r in rows if r["game_date"] >= cutoff_30], team_game_map), league_l30, rows_l30),
        "l14":     with_rank(_avg_row([r for r in rows if r["game_date"] >= cutoff_14], team_game_map), league_l14, rows_l14),
    }


# -----------------------------------------------------------------------
# GET /decompose
# -----------------------------------------------------------------------

@router.get("/decompose")
def get_decompose(
    player: str   = Query(..., description="Player slug e.g. doncilu01"),
    stat:   str   = Query(..., description="reb | pts | ast | stl | blk | tov"),
    pa_start: str = Query(..., description="Period A start date YYYY-MM-DD"),
    pa_end:   str = Query(..., description="Period A end date YYYY-MM-DD"),
    pb_start: str = Query(..., description="Period B start date YYYY-MM-DD"),
    pb_end:   str = Query(..., description="Period B end date YYYY-MM-DD"),
):
    """
    Decompose a player's stat change between two periods into driver contributions.
    Returns a waterfall-ready payload.
    """
    valid_stats = ["reb", "pts", "ast", "stl", "blk", "tov"]
    if stat not in valid_stats:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid stat '{stat}'. Must be one of {valid_stats}"
        )

    conn = get_conn()

    # Verify player exists
    player_row = conn.execute(
        "SELECT full_name, team FROM players WHERE slug = ? LIMIT 1", (player,)
    ).fetchone()

    if not player_row:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Player '{player}' not found.")

    result = decompose(
        conn        = conn,
        player_slug = player,
        stat        = stat,
        period_a    = (pa_start, pa_end),
        period_b    = (pb_start, pb_end),
    )

    if result is None:
        conn.close()
        raise HTTPException(
            status_code=404,
            detail="Insufficient data for the requested player and date ranges."
        )

    # ── Schedule difficulty for each period ───────────────────────────────
    # Get the player's position group
    pos_row = conn.execute(
        "SELECT position_group FROM player_bio WHERE br_slug = ?", (player,)
    ).fetchone()
    position = (pos_row["position_group"] if pos_row else None) or "Guard"

    # Current season label (opponents stored per-season)
    season_year  = _current_season_end_year()
    season_label = f"{season_year - 1}-{str(season_year)[2:]}"

    # League-average stats allowed to this position group per opponent
    opp_allowed = conn.execute("""
        SELECT g.opponent,
               AVG(CASE WHEN g.stat_col = 'pts'  THEN g.val END) AS pts,
               AVG(CASE WHEN g.stat_col = 'reb'  THEN g.val END) AS reb,
               AVG(CASE WHEN g.stat_col = 'ast'  THEN g.val END) AS ast,
               AVG(CASE WHEN g.stat_col = 'stl'  THEN g.val END) AS stl,
               AVG(CASE WHEN g.stat_col = 'blk'  THEN g.val END) AS blk,
               AVG(CASE WHEN g.stat_col = 'tov'  THEN g.val END) AS tov
        FROM (
            SELECT gl.opponent,
                   'pts' AS stat_col, gl.pts AS val FROM game_logs gl
                   JOIN player_bio b ON b.br_slug = gl.player_slug
                   WHERE gl.season = ? AND b.position_group = ? AND gl.min > 0
            UNION ALL
            SELECT gl.opponent, 'reb', gl.reb FROM game_logs gl
                   JOIN player_bio b ON b.br_slug = gl.player_slug
                   WHERE gl.season = ? AND b.position_group = ? AND gl.min > 0
            UNION ALL
            SELECT gl.opponent, 'ast', gl.ast FROM game_logs gl
                   JOIN player_bio b ON b.br_slug = gl.player_slug
                   WHERE gl.season = ? AND b.position_group = ? AND gl.min > 0
            UNION ALL
            SELECT gl.opponent, 'stl', gl.stl FROM game_logs gl
                   JOIN player_bio b ON b.br_slug = gl.player_slug
                   WHERE gl.season = ? AND b.position_group = ? AND gl.min > 0
            UNION ALL
            SELECT gl.opponent, 'blk', gl.blk FROM game_logs gl
                   JOIN player_bio b ON b.br_slug = gl.player_slug
                   WHERE gl.season = ? AND b.position_group = ? AND gl.min > 0
            UNION ALL
            SELECT gl.opponent, 'tov', gl.tov FROM game_logs gl
                   JOIN player_bio b ON b.br_slug = gl.player_slug
                   WHERE gl.season = ? AND b.position_group = ? AND gl.min > 0
        ) g
        GROUP BY g.opponent
    """, (season_label, position) * 6).fetchall()

    # Simpler approach: one query per stat
    def _opp_factors_for_stat(s):
        rows = conn.execute(f"""
            SELECT gl.opponent, AVG(gl.{s}) AS allowed
            FROM game_logs gl
            JOIN player_bio b ON b.br_slug = gl.player_slug
            WHERE gl.season = ? AND b.position_group = ? AND gl.min > 0
            GROUP BY gl.opponent
            HAVING COUNT(*) >= 5
        """, (season_label, position)).fetchall()
        vals = [r["allowed"] for r in rows if r["allowed"] is not None]
        league_avg = sum(vals) / len(vals) if vals else 1.0
        return {r["opponent"]: (r["allowed"] / league_avg if r["allowed"] and league_avg else 1.0)
                for r in rows}, league_avg

    opp_factors, _ = _opp_factors_for_stat(stat)

    def _period_sched_difficulty(start, end):
        """Avg opponent factor for the stat over games in this period."""
        opps = conn.execute("""
            SELECT opponent FROM game_logs
            WHERE player_slug = ? AND game_date BETWEEN ? AND ? AND min > 0
        """, (player, start, end)).fetchall()
        factors = [opp_factors.get(r["opponent"], 1.0) for r in opps]
        return round(sum(factors) / len(factors), 3) if factors else 1.0

    sched_diff = {
        "period_a": _period_sched_difficulty(pa_start, pa_end),
        "period_b": _period_sched_difficulty(pb_start, pb_end),
        "position": position,
        "stat":     stat,
    }
    conn.close()

    return {
        "player": {
            "slug": player,
            "name": player_row["full_name"],
            "team": player_row["team"],
        },
        "stat":               stat,
        "period_a":           {"start": pa_start, "end": pa_end, "value": result.stat_a},
        "period_b":           {"start": pb_start, "end": pb_end, "value": result.stat_b},
        "delta":              result.delta,
        "schedule_difficulty": sched_diff,
        "drivers": [
            {
                "key":          d.key,
                "label":        d.label,
                "category":     d.category,
                "value_a":      round(d.value_a, 4),
                "value_b":      round(d.value_b, 4),
                "contribution": d.contribution,
            }
            for d in result.drivers
        ],
    }


# -----------------------------------------------------------------------
# GET /seasons
# -----------------------------------------------------------------------

@router.get("/seasons")
def get_seasons():
    """Return all seasons available in the database."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT DISTINCT season FROM players ORDER BY season DESC"
    ).fetchall()
    conn.close()
    return [r["season"] for r in rows]


# -----------------------------------------------------------------------
# GET /shot-diet
# -----------------------------------------------------------------------

@router.get("/shot-diet")
def get_shot_diet(
    player:   str = Query(..., description="Player slug"),
    pa_start: str = Query(..., description="Period A start YYYY-MM-DD"),
    pa_end:   str = Query(..., description="Period A end YYYY-MM-DD"),
    pb_start: str = Query(..., description="Period B start YYYY-MM-DD"),
    pb_end:   str = Query(..., description="Period B end YYYY-MM-DD"),
):
    conn   = get_conn()
    result = decompose_shots(
        conn, player,
        period_a=(pa_start, pa_end),
        period_b=(pb_start, pb_end),
    )
    conn.close()

    if result is None:
        raise HTTPException(
            status_code=404,
            detail="No shot data found for this player and date ranges. "
                   "Run map_players.py then refresh_shots.py first."
        )

    return {
        "fg_pct_a":         result.fg_pct_a,
        "fg_pct_b":         result.fg_pct_b,
        "delta":            result.delta,
        "diet_total":       result.diet_total,
        "efficiency_total": result.efficiency_total,
        "zones": [
            {
                "zone":             z.zone,
                "label":            z.label,
                "fga_a":            z.fga_a,
                "fgm_a":            z.fgm_a,
                "fg_pct_a":         z.fg_pct_a,
                "freq_a":           z.freq_a,
                "fga_b":            z.fga_b,
                "fgm_b":            z.fgm_b,
                "fg_pct_b":         z.fg_pct_b,
                "freq_b":           z.freq_b,
                "diet_effect":      z.diet_effect,
                "efficiency_effect":z.efficiency_effect,
            }
            for z in result.zones
            if z.fga_a > 0 or z.fga_b > 0   # omit zones with no attempts
        ],
    }


# -----------------------------------------------------------------------
# GET /game-log
# -----------------------------------------------------------------------

@router.get("/game-log")
def get_game_log(
    player:   str = Query(..., description="Player slug"),
    pa_start: str = Query(..., description="Period A start YYYY-MM-DD"),
    pb_end:   str = Query(..., description="Period B end YYYY-MM-DD"),
):
    """Return game-by-game log for a player across both periods, newest first."""
    conn = get_conn()
    rows = conn.execute("""
        SELECT
            g.game_date,
            g.opponent,
            g.home_away,
            ROUND(g.min, 0)  AS min,
            g.pts,
            g.reb,
            g.ast,
            g.stl,
            g.blk,
            g.tov,
            g.fgm,
            g.fga,
            g.fg3m,
            g.fg3a,
            g.ftm,
            g.fta
        FROM game_logs g
        WHERE g.player_slug = ?
          AND g.game_date  >= ?
          AND g.game_date  <= ?
          AND g.min         > 0
        ORDER BY g.game_date DESC
    """, (player, pa_start, pb_end)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# -----------------------------------------------------------------------
# GET /player-games
# -----------------------------------------------------------------------

@router.get("/player-games")
def get_player_games(player: str = Query(..., description="Player slug")):
    """Return full game-by-game log for a player, oldest first, with per-game fg_pct."""
    conn = get_conn()
    rows = conn.execute("""
        SELECT
            game_date,
            season,
            opponent,
            home_away,
            ROUND(min, 0)  AS min,
            pts,
            reb,
            ast,
            stl,
            blk,
            tov,
            fgm,
            fga,
            fg3m,
            fg3a,
            ftm,
            fta,
            CASE WHEN fga > 0 THEN ROUND(fgm * 100.0 / fga, 1) ELSE NULL END AS fg_pct,
            CASE WHEN fta > 0 THEN ROUND(ftm * 100.0 / fta, 1) ELSE NULL END AS ft_pct
        FROM game_logs
        WHERE player_slug = ? AND min > 0
        ORDER BY game_date ASC
    """, (player,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# -----------------------------------------------------------------------
# GET /aging-curves
# -----------------------------------------------------------------------

_AGING_STATS = ['p30_pts', 'p30_reb', 'p30_ast', 'p30_stl', 'p30_blk', 'p30_tov', 'p30_fg3m', 'fg_pct']
_AGING_KEYS  = ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fg3m', 'fg_pct']
_MIN_SAMPLES = 5

@router.get("/aging-curves")
def get_aging_curves():
    """Return per-30 stat averages grouped by archetype and integer age."""
    conn = get_conn()
    df   = build_dataset(conn)
    conn.close()

    df = assign_archetypes(df)
    df = df.dropna(subset=['archetype', 'age'])
    df['age_int'] = df['age'].astype(int)

    result = {}
    for archetype in ARCHETYPES:
        sub  = df[df['archetype'] == archetype]
        rows = []
        for age in sorted(sub['age_int'].unique()):
            bucket = sub[sub['age_int'] == age]
            n = len(bucket)
            if n < _MIN_SAMPLES:
                continue
            row = {'age': int(age), 'n': n}
            for col, key in zip(_AGING_STATS, _AGING_KEYS):
                val = bucket[col].dropna()
                row[key] = round(float(val.mean()), 1) if len(val) else None
            rows.append(row)
        result[archetype] = rows

    return result


# -----------------------------------------------------------------------
# GET /data-range
# -----------------------------------------------------------------------

@router.get("/data-range")
def get_data_range():
    """Return the earliest and latest game dates available in the database."""
    conn = get_conn()
    row  = conn.execute(
        "SELECT MIN(game_date) AS min_date, MAX(game_date) AS max_date FROM game_logs"
    ).fetchone()
    conn.close()
    return {"min_date": row["min_date"], "max_date": row["max_date"]}


# -----------------------------------------------------------------------
# GET /project
# -----------------------------------------------------------------------

@router.get("/project")
def get_projection(
    player: str   = Query(..., description="Player slug e.g. curryst01"),
    mpg:    float = Query(..., description="Projected minutes per game"),
):
    """
    Project a player's next-season per-game stat line given projected minutes.

    Steps:
      1. Pull player's most recent qualifying season from training dataset
      2. Assign archetype via position + per-30 thresholds
      3. Run the archetype's Ridge regression model → per-30 projections
      4. Scale per-30 → per-game using the supplied mpg
    """
    if mpg <= 0 or mpg > 48:
        raise HTTPException(status_code=400, detail="mpg must be between 0 and 48.")

    conn = get_conn()
    df   = build_dataset(conn)
    conn.close()

    df = assign_archetypes(df)

    player_df = df[df['player_slug'] == player]
    if player_df.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No qualifying seasons found for '{player}'. "
                   "Player must have >= 20 GP and >= 15 min/game in at least one season."
        )

    # Most recent qualifying season
    current = player_df.sort_values('season').iloc[-1]
    archetype = current.get('archetype')

    if archetype is None:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot assign archetype for '{player}' — no position on record."
        )

    # Current per-30 stats (what went into the model)
    current_p30 = {
        col.replace('p30_', ''): (None if np.isnan(v) else round(float(v), 2))
        for col in [f'p30_{c}' for c in ['pts','reb','ast','stl','blk','tov','fg3m']]
        for v in [current.get(col, float('nan'))]
    }
    current_p30['fg_pct'] = (
        None if np.isnan(current.get('fg_pct', float('nan')))
        else round(float(current['fg_pct']), 1)
    )

    # Weighted FT% projection — exponential decay toward recent seasons (decay=0.6)
    FT_DECAY = 0.6
    player_seasons = player_df.sort_values('season')
    ft_vals = []
    for _, row in player_seasons.iterrows():
        # ft_pct not in training_data directly — pull from game_logs via _avg_row is complex,
        # so use fg_pct as a proxy signal; ft_pct comes from player_bio or game aggregation.
        # We'll fetch it from the raw game_logs aggregate already on df if available.
        v = row.get('ft_pct', None)
        if v is not None and not (isinstance(v, float) and np.isnan(v)):
            ft_vals.append(float(v))
    if not ft_vals:
        # Fall back: query game_logs directly for this player
        conn2 = get_conn()
        ft_row = conn2.execute("""
            SELECT SUM(ftm) * 100.0 / NULLIF(SUM(fta), 0) AS ft_pct
            FROM game_logs WHERE player_slug = ? AND min > 0
        """, (player,)).fetchone()
        conn2.close()
        ft_vals = [float(ft_row['ft_pct'])] if ft_row and ft_row['ft_pct'] else [75.0]

    # Compute exponentially weighted average (oldest → least weight)
    weights   = [FT_DECAY ** (len(ft_vals) - 1 - i) for i in range(len(ft_vals))]
    proj_ft_pct = round(sum(v * w for v, w in zip(ft_vals, weights)) / sum(weights), 1)

    # League means/stds for z_sum — computed from training dataset (all archetypes)
    Z_PROJ_KEYS   = ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fg3m', 'fg_pct']
    Z_PROJ_INVERT = {'tov'}
    league_stats = {}
    for key in Z_PROJ_KEYS:
        col = f'p30_{key}' if key != 'fg_pct' else 'fg_pct'
        vals = df[col].dropna()
        league_stats[key] = {'mean': float(vals.mean()), 'std': float(vals.std()) or 1.0}
    # ft_pct league stats from training data if available, else sensible defaults
    if 'ft_pct' in df.columns:
        ft_league = df['ft_pct'].dropna()
        league_stats['ft_pct'] = {'mean': float(ft_league.mean()), 'std': float(ft_league.std()) or 1.0}
    else:
        league_stats['ft_pct'] = {'mean': 75.0, 'std': 8.0}

    def _proj_z_sum(p30_dict, ft_pct_val):
        total = 0.0
        for key in Z_PROJ_KEYS:
            val = p30_dict.get(key)
            if val is None:
                continue
            z = (val - league_stats[key]['mean']) / league_stats[key]['std']
            total += -z if key in Z_PROJ_INVERT else z
        # ft_pct z-score
        z_ft = (ft_pct_val - league_stats['ft_pct']['mean']) / league_stats['ft_pct']['std']
        total += z_ft
        return round(total, 2)

    # Build smooth aging curves for ratio-based year-over-year adjustments
    aging_curves = build_aging_curves(df)

    # Build iterated multi-year projections.
    # Year N's per-30 output becomes year N+1's input, age increments each year.
    MAX_YEARS   = 4
    scale       = mpg / 30.0
    counting    = ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fg3m']

    def _season_label(base_season: str, offset: int) -> str:
        yr = int(base_season.split('-')[0]) + offset
        return f"{yr}-{str(yr + 1)[2:]}"

    position_group = str(current.get('position_group', ''))

    # Anchor to current season's actual per-30 stats, then compound aging ratios each year.
    # Three scenarios compound independently: each year's ratio shifts by ±1 SD of
    # historical year-over-year variance at that age, so uncertainty widens over time.
    PROJ_STATS  = ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fg3m', 'fg_pct']
    SCENARIO_K  = 1.0   # number of SDs for optimistic/pessimistic bands
    base_p30 = {
        'pts':    float(current.get('p30_pts',  0) or 0),
        'reb':    float(current.get('p30_reb',  0) or 0),
        'ast':    float(current.get('p30_ast',  0) or 0),
        'stl':    float(current.get('p30_stl',  0) or 0),
        'blk':    float(current.get('p30_blk',  0) or 0),
        'tov':    float(current.get('p30_tov',  0) or 0),
        'fg3m':   float(current.get('p30_fg3m', 0) or 0),
        'fg_pct': float(current.get('fg_pct',   0) or 0),
    }
    prev_by_scenario = {'baseline': dict(base_p30), 'optimistic': dict(base_p30), 'pessimistic': dict(base_p30)}

    def _apply_ratios(prev_p30, scenario_k):
        p30 = {}
        for stat in PROJ_STATS:
            base  = prev_p30.get(stat, 0)
            ratio = _aging_ratio(aging_curves, current_archetype, stat, current_age, next_age)
            if scenario_k != 0:
                std = _aging_ratio_std(aging_curves, stat, current_age)
                ratio = float(np.clip(ratio + scenario_k * std, RATIO_FLOOR - 0.05, RATIO_CAP + 0.05))
            p30[stat] = round(base * ratio, 2)
        p30['ft_pct'] = proj_ft_pct
        return p30

    def _to_pg(p30):
        pg = {s: round(p30[s] * scale, 1) for s in counting if s in p30}
        pg['fg_pct'] = round(p30.get('fg_pct', 0), 1)
        pg['ft_pct'] = proj_ft_pct
        return pg

    projections = []
    current_archetype = archetype
    for yr in range(1, MAX_YEARS + 1):
        current_age = float(current.get('age', 25)) + (yr - 1)
        next_age    = current_age + 1

        p30_base = _apply_ratios(prev_by_scenario['baseline'],    0)
        p30_opt  = _apply_ratios(prev_by_scenario['optimistic'],  SCENARIO_K)
        p30_pes  = _apply_ratios(prev_by_scenario['pessimistic'], -SCENARIO_K)

        projections.append({
            'year':      yr,
            'season':    _season_label(str(current['season']), yr),
            'archetype': current_archetype,
            'projection_p30': p30_base,
            'projection_pg':  _to_pg(p30_base),
            'z_sum':     _proj_z_sum(p30_base, proj_ft_pct),
            'optimistic': {
                'projection_p30': p30_opt,
                'projection_pg':  _to_pg(p30_opt),
                'z_sum':          _proj_z_sum(p30_opt, proj_ft_pct),
            },
            'pessimistic': {
                'projection_p30': p30_pes,
                'projection_pg':  _to_pg(p30_pes),
                'z_sum':          _proj_z_sum(p30_pes, proj_ft_pct),
            },
        })
        prev_by_scenario = {'baseline': p30_base, 'optimistic': p30_opt, 'pessimistic': p30_pes}
        # Re-derive archetype from baseline projected stats for next iteration
        next_archetype = _assign_row(
            pos=position_group,
            pts=p30_base['pts'],
            ast=p30_base['ast'],
            fg3m=p30_base['fg3m'],
            blk=p30_base['blk'],
            reb=p30_base['reb'],
        )
        if next_archetype:
            current_archetype = next_archetype

    # Include model quality (R²) for the archetype
    model_obj = load_model(archetype)
    r2 = {k.replace('next_', ''): v for k, v in model_obj['r2'].items()}

    return {
        "player":      player,
        "season_used": str(current['season']),
        "archetype":   archetype,
        "current_mpg": round(float(current.get('min_pg', 32.0)), 1),
        "current_p30": current_p30,
        "projections": projections,
        "model": {
            "n_train": model_obj['n_train'],
            "r2":      r2,
        },
    }


# -----------------------------------------------------------------------
# GET /rankings
# -----------------------------------------------------------------------

@router.get("/rankings")
def get_rankings(
    period:   str = Query("season", description="season | l14 | l30"),
    position: str = Query("all",    description="all | Guard | Forward | Center | Guard-Forward | Forward-Center"),
):
    """
    Return all qualifying players ranked by composite Z-score for the given period.
    """
    from datetime import date, timedelta

    conn = get_conn()
    try:
        if period == "season":
            cutoff    = None
            min_games = 10
            _yr       = _current_season_end_year()
            season    = f"{_yr - 1}-{str(_yr)[2:]}"   # e.g. "2025-26"
        elif period == "l14":
            cutoff    = (date.today() - timedelta(days=14)).isoformat()
            min_games = 3
            season    = None
        else:  # l30
            cutoff    = (date.today() - timedelta(days=30)).isoformat()
            min_games = 5
            season    = None

        league, player_rows = _league_data(conn, season=season, cutoff=cutoff, min_games=min_games)

        if not player_rows:
            return []

        # Build slug → position+name map; use most recent game_log for current team
        bio_rows = conn.execute("""
            SELECT p.slug, p.full_name AS name,
                   COALESCE(
                       (SELECT g.team FROM game_logs g WHERE g.player_slug = p.slug ORDER BY g.game_date DESC LIMIT 1),
                       p.team
                   ) AS team,
                   b.position_group AS position
            FROM players p
            LEFT JOIN player_bio b ON b.br_slug = p.slug
            WHERE (p.slug, p.season) IN (
                SELECT slug, MAX(season) FROM players GROUP BY slug
            )
        """).fetchall()
        bio = {r["slug"]: dict(r) for r in bio_rows}

        results = []
        for r in player_rows:
            slug = r["player_slug"]
            info = bio.get(slug, {})
            pos  = info.get("position") or ""

            if position != "all" and pos != position:
                continue

            avg = {
                "gp":     None,  # not available in league aggregate
                "min_pg": round(r.get("min_pg") or 0, 1) if "min_pg" in r else None,
                "pts":    round(r["pts"],  1) if r.get("pts")  is not None else None,
                "reb":    round(r["reb"],  1) if r.get("reb")  is not None else None,
                "ast":    round(r["ast"],  1) if r.get("ast")  is not None else None,
                "stl":    round(r["stl"],  1) if r.get("stl")  is not None else None,
                "blk":    round(r["blk"],  1) if r.get("blk")  is not None else None,
                "tov":    round(r["tov"],  1) if r.get("tov")  is not None else None,
                "fg3m":   round(r["fg3m"], 1) if r.get("fg3m") is not None else None,
                "fg_pct": round(r["fg_pct"], 1) if r.get("fg_pct") is not None else None,
                "ft_pct": round(r["ft_pct"], 1) if r.get("ft_pct") is not None else None,
                "fga_pg": round(r.get("fga_pg") or 0, 1),
                "fta_pg": round(r.get("fta_pg") or 0, 1),
                "fg_impact": r.get("fg_impact"),
                "ft_impact": r.get("ft_impact"),
            }
            z_total = _composite_z(r, league)
            avg_z   = _with_zscores(avg, league)

            results.append({
                "slug":     slug,
                "name":     info.get("name", slug),
                "team":     info.get("team", ""),
                "position": pos,
                "z_total":  round(z_total, 2) if z_total is not None else None,
                **{k: v for k, v in avg_z.items() if k != "gp"},
            })

        # Fetch GP counts separately (game_logs has individual rows)
        clauses = ["min > 0"]
        params  = []
        if season:
            clauses.append("season = ?")
            params.append(season)
        if cutoff:
            clauses.append("game_date >= ?")
            params.append(cutoff)
        where = " AND ".join(clauses)
        gp_rows = conn.execute(
            f"SELECT player_slug, COUNT(*) AS gp FROM game_logs WHERE {where} GROUP BY player_slug",
            params
        ).fetchall()
        gp_map = {r["player_slug"]: r["gp"] for r in gp_rows}

        for p in results:
            p["gp"] = gp_map.get(p["slug"])

        injury_map = _get_injury_map(conn)
        for p in results:
            p["injury"] = injury_map.get(p["slug"])

        results.sort(key=lambda x: (x["z_total"] or -999), reverse=True)
        for i, p in enumerate(results):
            p["rank"] = i + 1

        return results
    finally:
        conn.close()


# -----------------------------------------------------------------------
# GET /schedule-projection
# -----------------------------------------------------------------------

SCHED_STATS = ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fg3m']

@router.get("/schedule-projection")
def get_schedule_projection(
    player:     str = Query(...,    description="Player slug"),
    period:     str = Query("season", description="Baseline window: season | l30 | l14"),
    start_date: str = Query(None,   description="Show games from this date onward (YYYY-MM-DD, defaults to today, cannot be in past)"),
):
    """
    Return upcoming games for the player's team with per-game projected stats
    scaled by each opponent's defensive strength vs the player's position group.
    """
    from datetime import date, timedelta, datetime

    conn = get_conn()
    try:
        # ── 1. Player baseline ────────────────────────────────────────────
        player_row = conn.execute("""
            SELECT p.full_name, p.team, b.position_group
            FROM players p
            LEFT JOIN player_bio b ON b.br_slug = p.slug
            WHERE p.slug = ?
            ORDER BY p.season DESC LIMIT 1
        """, (player,)).fetchone()
        if not player_row:
            raise HTTPException(status_code=404, detail="Player not found")

        team     = player_row["team"]
        position = player_row["position_group"] or "Guard"

        season_year  = _current_season_end_year()
        end_yr       = season_year
        season_label = f"{end_yr - 1}-{str(end_yr)[2:]}"   # e.g. "2025-26"

        # Date cutoff for L30/L14
        today = date.today()
        if period == "l14":
            cutoff = (today - timedelta(days=14)).isoformat()
        elif period == "l30":
            cutoff = (today - timedelta(days=30)).isoformat()
        else:
            cutoff = None

        if cutoff:
            game_rows = conn.execute("""
                SELECT min, pts, reb, ast, stl, blk, tov, fgm, fga, fg3m, ftm, fta, home_away
                FROM game_logs
                WHERE player_slug = ? AND season = ? AND min > 0 AND game_date >= ?
            """, (player, season_label, cutoff)).fetchall()
        else:
            game_rows = conn.execute("""
                SELECT min, pts, reb, ast, stl, blk, tov, fgm, fga, fg3m, ftm, fta, home_away
                FROM game_logs
                WHERE player_slug = ? AND season = ? AND min > 0
            """, (player, season_label)).fetchall()
        game_rows = [dict(r) for r in game_rows]

        # Fall back to full season if window too small
        if len(game_rows) < 3 and cutoff:
            game_rows = conn.execute("""
                SELECT min, pts, reb, ast, stl, blk, tov, fgm, fga, fg3m, ftm, fta, home_away
                FROM game_logs
                WHERE player_slug = ? AND season = ? AND min > 0
            """, (player, season_label)).fetchall()
            game_rows = [dict(r) for r in game_rows]

        if not game_rows:
            return {"games": [], "baseline": {}, "error": "No current season data"}

        baseline      = _avg_row(game_rows)
        home_rows     = [r for r in game_rows if r.get("home_away") == "H"]
        away_rows     = [r for r in game_rows if r.get("home_away") == "A"]
        home_baseline = _avg_row(home_rows) if len(home_rows) >= 3 else baseline
        away_baseline = _avg_row(away_rows) if len(away_rows) >= 3 else baseline

        # ── 2. Opponent defensive factors vs this position group ──────────
        # For each team (as defender), avg stats allowed to players of this position
        allowed_rows = conn.execute("""
            SELECT g.opponent AS defending_team,
                   AVG(g.pts)  AS pts,
                   AVG(g.reb)  AS reb,
                   AVG(g.ast)  AS ast,
                   AVG(g.stl)  AS stl,
                   AVG(g.blk)  AS blk,
                   AVG(g.tov)  AS tov,
                   AVG(g.fg3m) AS fg3m,
                   COUNT(*)    AS gp
            FROM game_logs g
            JOIN player_bio b ON b.br_slug = g.player_slug
            WHERE g.season = ?
              AND b.position_group = ?
              AND g.min > 0
            GROUP BY g.opponent
            HAVING COUNT(*) >= 5
        """, (season_label, position)).fetchall()
        allowed_rows = [dict(r) for r in allowed_rows]

        # League average allowed to this position
        league_avgs = {}
        for stat in SCHED_STATS:
            vals = [r[stat] for r in allowed_rows if r[stat] is not None]
            league_avgs[stat] = sum(vals) / len(vals) if vals else 1.0

        # Factor per team: how much more/less they allow vs league avg
        opp_factors = {}
        for r in allowed_rows:
            opp_factors[r["defending_team"]] = {
                stat: (r[stat] / league_avgs[stat]) if (r[stat] and league_avgs[stat]) else 1.0
                for stat in SCHED_STATS
            }

        # ── 3. B2B factor from historical game_logs ───────────────────────
        # Tag each game as B2B if the player also played the previous calendar day
        all_season_rows = conn.execute("""
            SELECT game_date, min, pts, reb, ast, stl, blk, tov, fgm, fga, fg3m, ftm, fta
            FROM game_logs
            WHERE player_slug = ? AND season = ? AND min > 0
            ORDER BY game_date
        """, (player, season_label)).fetchall()
        all_season_rows = [dict(r) for r in all_season_rows]

        dates_played = {r["game_date"] for r in all_season_rows}
        b2b_hist, normal_hist = [], []
        for r in all_season_rows:
            prev = (datetime.strptime(r["game_date"], "%Y-%m-%d").date() - timedelta(days=1)).isoformat()
            if prev in dates_played:
                b2b_hist.append(r)
            else:
                normal_hist.append(r)

        b2b_factor: dict = {}
        if len(b2b_hist) >= 3 and len(normal_hist) >= 3:
            b2b_avg    = _avg_row(b2b_hist)
            normal_avg = _avg_row(normal_hist)
            for stat in SCHED_STATS:
                b = b2b_avg.get(stat)
                n = normal_avg.get(stat)
                b2b_factor[stat] = round(b / n, 3) if (b and n and n != 0) else 1.0
        else:
            b2b_factor = {stat: 1.0 for stat in SCHED_STATS}

        b2b_games_count = len(b2b_hist)

        # ── 3b. Per-stat SD (blended current + prev season) ──────────────
        import math as _math

        def _pop_sd(vals):
            n = len(vals)
            if n < 2: return 0.0
            mean = sum(vals) / n
            return _math.sqrt(sum((x - mean) ** 2 for x in vals) / n)

        current_sd = {}
        for stat in SCHED_STATS:
            vals = [r[stat] for r in game_rows if r.get(stat) is not None]
            current_sd[stat] = _pop_sd(vals)

        # Prev-season SD for early-season blending
        prev_season_year  = season_year - 1
        prev_season_label = f"{prev_season_year - 1}-{str(prev_season_year)[2:]}"
        prev_rows = conn.execute("""
            SELECT pts, reb, ast, stl, blk, tov, fg3m
            FROM game_logs
            WHERE player_slug = ? AND season = ? AND min > 0
        """, (player, prev_season_label)).fetchall()
        prev_sd = {}
        for stat in SCHED_STATS:
            vals = [r[stat] for r in prev_rows if r[stat] is not None]
            prev_sd[stat] = _pop_sd(vals) if len(vals) >= 5 else current_sd[stat]

        # Blend: weight toward current as GP grows (fully current at 50 games)
        gp_current = len(game_rows)
        w_current  = min(gp_current, 50) / 50.0
        blended_sd = {
            stat: w_current * current_sd[stat] + (1 - w_current) * prev_sd[stat]
            for stat in SCHED_STATS
        }

        # ── 4. Forward schedule + B2B detection ───────────────────────────
        today_str      = date.today().isoformat()
        sched_from     = max(start_date, today_str) if start_date else today_str
        sched_rows = conn.execute("""
            SELECT s.game_date, s.home_team, s.away_team,
                   CASE WHEN EXISTS (
                       SELECT 1 FROM nba_schedule s2
                       WHERE (s2.home_team = ? OR s2.away_team = ?)
                         AND s2.game_date = date(s.game_date, '-1 day')
                         AND s2.season = s.season
                   ) THEN 1 ELSE 0 END AS is_b2b
            FROM nba_schedule s
            WHERE s.season = ?
              AND s.game_date >= ?
              AND (s.home_team = ? OR s.away_team = ?)
            ORDER BY s.game_date
            LIMIT 10
        """, (team, team, season_year, sched_from, team, team)).fetchall()

        upcoming = []
        for row in sched_rows:
            is_home  = row["home_team"] == team
            opponent = row["away_team"] if is_home else row["home_team"]
            upcoming.append({
                "date":      row["game_date"],
                "opponent":  opponent,
                "home_away": "Home" if is_home else "Away",
                "is_b2b":    bool(row["is_b2b"]),
            })

        # ── 5. Apply opponent + B2B factors to home/away-split baseline ───
        games_out = []
        for g in upcoming:
            opp      = g["opponent"]
            is_home  = g["home_away"] == "Home"
            base_row = home_baseline if is_home else away_baseline
            opp_f    = opp_factors.get(opp, {stat: 1.0 for stat in SCHED_STATS})
            b2b_f    = b2b_factor if g["is_b2b"] else {stat: 1.0 for stat in SCHED_STATS}
            projected = {}
            projected_low = {}
            projected_high = {}
            combined_factors = {}
            for stat in SCHED_STATS:
                base = base_row.get(stat)
                of   = opp_f.get(stat, 1.0)
                bf   = b2b_f.get(stat, 1.0)
                combined_factors[stat] = round(of * bf, 3)
                mid = round(base * of * bf, 1) if base is not None else None
                projected[stat] = mid
                if mid is not None:
                    adj_sd = blended_sd[stat] * of * bf
                    projected_low[stat]  = round(max(0.0, mid - adj_sd), 1)
                    projected_high[stat] = round(mid + adj_sd, 1)
                else:
                    projected_low[stat] = projected_high[stat] = None
            games_out.append({**g, "projected": projected,
                               "projected_low": projected_low, "projected_high": projected_high,
                               "factors": combined_factors,
                               "opp_factors": {s: round(opp_f.get(s, 1.0), 3) for s in SCHED_STATS},
                               "b2b_factors": {s: round(b2b_f.get(s, 1.0), 3) for s in SCHED_STATS}})

        return {
            "player":          player,
            "team":            team,
            "position":        position,
            "period":          period,
            "games_in_window": len(game_rows),
            "b2b_games":       b2b_games_count,
            "b2b_factor":      b2b_factor,
            "baseline":        {stat: baseline.get(stat)      for stat in SCHED_STATS},
            "home_baseline":   {stat: home_baseline.get(stat) for stat in SCHED_STATS},
            "away_baseline":   {stat: away_baseline.get(stat) for stat in SCHED_STATS},
            "games":           games_out,
        }
    finally:
        conn.close()


# -----------------------------------------------------------------------
# POST /admin/refresh-schedule  (one-shot, no auth needed — low risk)
# -----------------------------------------------------------------------

@router.post("/admin/refresh-schedule")
def admin_refresh_schedule():
    """Fetch upcoming schedule from basketball-reference and store in DB."""
    try:
        import refresh as refresh_mod
        from schema import init_db
        init_db()
        season_year = _current_season_end_year()
        conn = get_conn()
        refresh_mod.refresh_schedule(conn, season_year)
        count = conn.execute("SELECT COUNT(*) FROM nba_schedule WHERE season=?", (season_year,)).fetchone()[0]
        conn.close()
        return {"status": "ok", "games_stored": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin/upload-schedule")
def admin_upload_schedule(games: list = Body(...)):
    """Accept schedule JSON pushed from local machine and store in DB."""
    try:
        from schema import init_db
        init_db()
        conn = get_conn()
        conn.execute("DELETE FROM nba_schedule")
        conn.executemany(
            "INSERT OR IGNORE INTO nba_schedule (game_date, home_team, away_team, season) VALUES (?,?,?,?)",
            [(g["game_date"], g["home_team"], g["away_team"], g["season"]) for g in games]
        )
        conn.commit()
        count = conn.execute("SELECT COUNT(*) FROM nba_schedule").fetchone()[0]
        conn.close()
        return {"status": "ok", "games_stored": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# -----------------------------------------------------------------------
# GET /projections
# -----------------------------------------------------------------------

_proj_cache: dict = {}   # (start, end) -> (ts, payload)
_PROJ_CACHE_TTL = 600    # 10 minutes

@router.get("/projections")
def get_projections(
    start: str = Query(..., description="Window start date YYYY-MM-DD"),
    end:   str = Query(..., description="Window end date YYYY-MM-DD"),
):
    """
    Return all qualified players ranked by projected fantasy value for the given date window.
    Per-game stats are opponent-adjusted using defensive factors vs each player's position group.
    period_value = composite_z_per_game × games_in_window (the ranking metric).
    """
    import time as _t

    cache_key = (start, end)
    cached = _proj_cache.get(cache_key)
    if cached and (_t.time() - cached[0]) < _PROJ_CACHE_TTL:
        return cached[1]

    conn = get_conn()
    try:
        season_year = _current_season_end_year()
        season = f"{season_year - 1}-{str(season_year)[2:]}"

        # ── 1. Upcoming schedule: opponents per team in window ──────────────
        sched_rows = conn.execute("""
            SELECT home_team, away_team FROM nba_schedule
            WHERE game_date >= ? AND game_date <= ?
        """, (start, end)).fetchall()

        team_opponents = {}  # team -> [opponent, ...]
        for r in sched_rows:
            team_opponents.setdefault(r["home_team"], []).append(r["away_team"])
            team_opponents.setdefault(r["away_team"], []).append(r["home_team"])

        if not team_opponents:
            return []

        # ── 2. Opponent defensive factors per position ──────────────────────
        opp_factors = {}   # (defending_team, position) -> {stat: factor}
        for pos in ["Guard", "Forward", "Center", "Guard-Forward", "Forward-Center"]:
            allowed = conn.execute("""
                SELECT g.opponent AS defending_team,
                       AVG(g.pts) AS pts, AVG(g.reb) AS reb, AVG(g.ast) AS ast,
                       AVG(g.stl) AS stl, AVG(g.blk) AS blk, AVG(g.tov) AS tov,
                       AVG(g.fg3m) AS fg3m
                FROM game_logs g
                JOIN player_bio b ON b.br_slug = g.player_slug
                WHERE g.season = ? AND b.position_group = ? AND g.min > 0
                GROUP BY g.opponent
                HAVING COUNT(*) >= 5
            """, (season, pos)).fetchall()

            league_avgs = {}
            for stat in SCHED_STATS:
                vals = [r[stat] for r in allowed if r[stat] is not None]
                league_avgs[stat] = sum(vals) / len(vals) if vals else 1.0

            for r in allowed:
                opp_factors[(r["defending_team"], pos)] = {
                    stat: (r[stat] / league_avgs[stat]) if (r[stat] and league_avgs[stat]) else 1.0
                    for stat in SCHED_STATS
                }

        # ── 3. Player baselines (current season, ≥10 GP, ≥15 min) ──────────
        player_rows = conn.execute("""
            SELECT g.player_slug, p.full_name, p.team, b.position_group,
                   COUNT(*) AS gp_current,
                   AVG(g.min) AS min_pg,
                   AVG(g.pts) AS pts, AVG(g.reb) AS reb, AVG(g.ast) AS ast,
                   AVG(g.stl) AS stl, AVG(g.blk) AS blk, AVG(g.tov) AS tov,
                   AVG(g.fg3m) AS fg3m,
                   SUM(g.fgm) * 100.0 / NULLIF(SUM(g.fga), 0) AS fg_pct,
                   SUM(g.ftm) * 100.0 / NULLIF(SUM(g.fta), 0) AS ft_pct,
                   AVG(g.fga) AS fga_pg, AVG(g.fta) AS fta_pg,
                   SQRT(MAX(0, AVG(g.pts*g.pts)  - AVG(g.pts)*AVG(g.pts)))  AS pts_sd,
                   SQRT(MAX(0, AVG(g.reb*g.reb)  - AVG(g.reb)*AVG(g.reb)))  AS reb_sd,
                   SQRT(MAX(0, AVG(g.ast*g.ast)  - AVG(g.ast)*AVG(g.ast)))  AS ast_sd,
                   SQRT(MAX(0, AVG(g.stl*g.stl)  - AVG(g.stl)*AVG(g.stl)))  AS stl_sd,
                   SQRT(MAX(0, AVG(g.blk*g.blk)  - AVG(g.blk)*AVG(g.blk)))  AS blk_sd,
                   SQRT(MAX(0, AVG(g.tov*g.tov)  - AVG(g.tov)*AVG(g.tov)))  AS tov_sd,
                   SQRT(MAX(0, AVG(g.fg3m*g.fg3m) - AVG(g.fg3m)*AVG(g.fg3m))) AS fg3m_sd
            FROM game_logs g
            JOIN players p ON p.slug = g.player_slug
            LEFT JOIN player_bio b ON b.br_slug = g.player_slug
            WHERE g.season = ? AND g.min >= 15
            GROUP BY g.player_slug
            HAVING COUNT(*) >= 10
        """, (season,)).fetchall()

        # ── 3b. Last season SDs (for early-season blending) ─────────────────
        prev_season_year = season_year - 1
        prev_season = f"{prev_season_year - 1}-{str(prev_season_year)[2:]}"
        prev_sd_rows = conn.execute("""
            SELECT player_slug,
                   SQRT(MAX(0, AVG(pts*pts)  - AVG(pts)*AVG(pts)))  AS pts_sd,
                   SQRT(MAX(0, AVG(reb*reb)  - AVG(reb)*AVG(reb)))  AS reb_sd,
                   SQRT(MAX(0, AVG(ast*ast)  - AVG(ast)*AVG(ast)))  AS ast_sd,
                   SQRT(MAX(0, AVG(stl*stl)  - AVG(stl)*AVG(stl)))  AS stl_sd,
                   SQRT(MAX(0, AVG(blk*blk)  - AVG(blk)*AVG(blk)))  AS blk_sd,
                   SQRT(MAX(0, AVG(tov*tov)  - AVG(tov)*AVG(tov)))  AS tov_sd,
                   SQRT(MAX(0, AVG(fg3m*fg3m) - AVG(fg3m)*AVG(fg3m))) AS fg3m_sd
            FROM game_logs
            WHERE season = ? AND min >= 15
            GROUP BY player_slug
            HAVING COUNT(*) >= 10
        """, (prev_season,)).fetchall()
        prev_sd_map = {r["player_slug"]: dict(r) for r in prev_sd_rows}

        # ── 4. League data + injury map ─────────────────────────────────────
        league, _ = _league_data(conn, season=season, min_games=10)
        if not league:
            return []
        injury_map = _get_injury_map(conn)

        # ── 5. Compute projections ──────────────────────────────────────────
        results = []
        for r in player_rows:
            slug     = r["player_slug"]
            team     = r["team"]
            position = r["position_group"] or "Guard"

            opponents = team_opponents.get(team, [])
            if not opponents:
                continue

            # Average opponent factor across all games in window
            avg_factor = {stat: 0.0 for stat in SCHED_STATS}
            matched = 0
            for opp in opponents:
                f = opp_factors.get((opp, position))
                if f:
                    for stat in SCHED_STATS:
                        avg_factor[stat] += f[stat]
                    matched += 1
            if matched > 0:
                for stat in SCHED_STATS:
                    avg_factor[stat] /= matched
            else:
                avg_factor = {stat: 1.0 for stat in SCHED_STATS}

            # Apply factor to baseline (counting stats only; pcts unadjusted)
            proj = {
                stat: round((r[stat] or 0.0) * avg_factor[stat], 1)
                for stat in SCHED_STATS
            }
            proj["fg_pct"] = round(r["fg_pct"], 1) if r["fg_pct"] is not None else None
            proj["ft_pct"] = round(r["ft_pct"], 1) if r["ft_pct"] is not None else None
            proj["fga_pg"] = r["fga_pg"] or 0.0
            proj["fta_pg"] = r["fta_pg"] or 0.0
            proj["min_pg"] = round(r["min_pg"], 1) if r["min_pg"] is not None else None

            # Per-player opponent-adjusted SD → outcome ranges (blended with last season)
            gp_current = r["gp_current"]
            w_current  = min(gp_current, 50) / 50.0
            prev_sd    = prev_sd_map.get(slug, {})
            for stat in SCHED_STATS:
                sd_current  = r[f"{stat}_sd"] or 0.0
                sd_prev     = prev_sd.get(f"{stat}_sd") or sd_current
                blended_sd  = w_current * sd_current + (1 - w_current) * sd_prev
                adj_sd      = blended_sd * avg_factor[stat]
                proj[f"{stat}_low"]  = round(max(0.0, proj[stat] - adj_sd), 1)
                proj[f"{stat}_high"] = round(proj[stat] + adj_sd, 1)

            gp      = len(opponents)
            z_total = _composite_z(proj, league)
            proj_z  = _with_zscores(proj, league)

            results.append({
                "slug":         slug,
                "name":         r["full_name"],
                "team":         team,
                "position":     position,
                "gp":           gp,
                "injury":       injury_map.get(slug),
                "z_total":      round(z_total, 2) if z_total is not None else None,
                "period_value": round(z_total * gp, 2) if z_total is not None else None,
                **{k: v for k, v in proj_z.items()},
                **{f"{stat}_low":  proj[f"{stat}_low"]  for stat in SCHED_STATS},
                **{f"{stat}_high": proj[f"{stat}_high"] for stat in SCHED_STATS},
            })

        results.sort(key=lambda x: (x["period_value"] or -999), reverse=True)
        for i, p in enumerate(results):
            p["rank"] = i + 1

        _proj_cache[cache_key] = (_t.time(), results)
        return results

    finally:
        conn.close()


# -----------------------------------------------------------------------
# GET /injuries
# -----------------------------------------------------------------------

@router.post("/admin/sync-injuries")
def admin_sync_injuries():
    """Trigger an immediate injury sync from Tank01. Requires RAPIDAPI_KEY on server."""
    if not os.environ.get("RAPIDAPI_KEY"):
        raise HTTPException(503, "RAPIDAPI_KEY not configured on server")
    try:
        import sync_injuries
        sync_injuries.sync()
        conn = get_conn()
        count = conn.execute("SELECT COUNT(*) FROM injuries").fetchone()[0]
        conn.close()
        return {"status": "ok", "injured_players": count}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/injuries")
def get_injuries():
    """
    Return all current injury designations, grouped by team.
    Each entry: player_slug, name, team, designation, description, inj_date, return_date.
    """
    conn = get_conn()
    rows = conn.execute("""
        SELECT player_slug, name, team, designation, description, inj_date, return_date, updated_at
        FROM injuries
        ORDER BY team, designation, name
    """).fetchall()
    conn.close()

    # Group by team
    grouped = {}
    for r in rows:
        team = r["team"] or "Unknown"
        if team not in grouped:
            grouped[team] = []
        grouped[team].append({
            "slug":        r["player_slug"],
            "name":        r["name"],
            "designation": r["designation"],
            "description": r["description"],
            "inj_date":    r["inj_date"],
            "return_date": r["return_date"],
        })

    updated_at = rows[0]["updated_at"] if rows else None
    return {
        "updated_at": updated_at,
        "total":      len(rows),
        "teams":      grouped,
    }


# -----------------------------------------------------------------------
# Health check
# -----------------------------------------------------------------------

@router.get("/healthz")
def health():
    return {"status": "ok"}


# -----------------------------------------------------------------------
# News
# -----------------------------------------------------------------------

import time as _time
import json as _json_mod

_NEWS_TTL = 600          # 10 minutes — only re-fetch if cache is this old

@router.get("/news")
def get_news():
    """
    Fetch top NBA news from Tank01. Cached in SQLite for 10 minutes so it
    survives server restarts. Returns stale cache on Tank01 errors.
    """
    now = int(_time.time())
    conn = get_conn()

    # Ensure table exists (may not on first deploy)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS news_cache (
            id         INTEGER PRIMARY KEY CHECK (id = 1),
            payload    TEXT,
            fetched_at INTEGER
        )
    """)
    conn.commit()

    # Check DB cache first
    row = conn.execute("SELECT payload, fetched_at FROM news_cache WHERE id = 1").fetchone()
    if row and (now - row["fetched_at"]) < _NEWS_TTL:
        conn.close()
        return _json_mod.loads(row["payload"])

    stale_payload = _json_mod.loads(row["payload"]) if row else None

    if not os.environ.get("RAPIDAPI_KEY"):
        conn.close()
        if stale_payload:
            return stale_payload
        raise HTTPException(503, "RAPIDAPI_KEY not configured on server")

    try:
        data = _tank01_get("getNBANews", {"recentNews": "true", "maxItems": "50"})
    except Exception as e:
        conn.close()
        if stale_payload:
            return stale_payload   # serve stale rather than error
        raise HTTPException(502, f"Tank01 news fetch failed: {e}")

    body = data.get("body", [])
    if isinstance(body, dict):
        body = list(body.values())

    articles = []
    for item in body:
        title = item.get("title") or ""
        if not title:
            continue
        articles.append({
            "title":     title,
            "link":      item.get("link") or "",
            "image":     item.get("image") or "",
            "playerIDs": item.get("playerIDs") or [],
        })

    payload = {"articles": articles, "fetched_at": now}
    blob = _json_mod.dumps(payload)
    conn.execute(
        "INSERT INTO news_cache (id, payload, fetched_at) VALUES (1, ?, ?)"
        " ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at",
        (blob, now)
    )
    conn.commit()
    conn.close()
    return payload


# -----------------------------------------------------------------------
# Box Score
# -----------------------------------------------------------------------

# In-memory cache for box scores.
# Past completed dates: cached indefinitely (scores never change).
# Today: cached for 30s so auto-polling clients share one Tank01 fetch.
_box_score_cache: dict = {}        # date_str -> payload  (past dates)
_today_cache: dict     = {}        # {"payload": ..., "ts": float}  (today only)
_TODAY_TTL = 30                    # seconds

def _tank01_get(endpoint: str, params: dict):
    import urllib.request, urllib.parse, json as _json
    key  = os.environ.get("RAPIDAPI_KEY", "")
    host = "tank01-fantasy-stats.p.rapidapi.com"
    qs   = urllib.parse.urlencode(params)
    url  = f"https://{host}/{endpoint}?{qs}"
    req  = urllib.request.Request(url, headers={
        "X-RapidAPI-Key":  key,
        "X-RapidAPI-Host": host,
    })
    with urllib.request.urlopen(req, timeout=20) as resp:
        return _json.loads(resp.read())

_TEAM_ABBREV = {
    "ATL":"ATLANTA HAWKS","BOS":"BOSTON CELTICS","BKN":"BROOKLYN NETS",
    "CHA":"CHARLOTTE HORNETS","CHI":"CHICAGO BULLS","CLE":"CLEVELAND CAVALIERS",
    "DAL":"DALLAS MAVERICKS","DEN":"DENVER NUGGETS","DET":"DETROIT PISTONS",
    "GS":"GOLDEN STATE WARRIORS","GSW":"GOLDEN STATE WARRIORS",
    "HOU":"HOUSTON ROCKETS","IND":"INDIANA PACERS","LAC":"LOS ANGELES CLIPPERS",
    "LAL":"LOS ANGELES LAKERS","MEM":"MEMPHIS GRIZZLIES","MIA":"MIAMI HEAT",
    "MIL":"MILWAUKEE BUCKS","MIN":"MINNESOTA TIMBERWOLVES",
    "NO":"NEW ORLEANS PELICANS","NOP":"NEW ORLEANS PELICANS",
    "NY":"NEW YORK KNICKS","NYK":"NEW YORK KNICKS","OKC":"OKLAHOMA CITY THUNDER",
    "ORL":"ORLANDO MAGIC","PHI":"PHILADELPHIA 76ERS","PHO":"PHOENIX SUNS",
    "POR":"PORTLAND TRAIL BLAZERS","SA":"SAN ANTONIO SPURS","SAS":"SAN ANTONIO SPURS",
    "SAC":"SACRAMENTO KINGS","TOR":"TORONTO RAPTORS","UTA":"UTAH JAZZ",
    "WAS":"WASHINGTON WIZARDS",
}

def _league_z_params(conn, season: str):
    """Compute league-wide mean + std for each stat from game_logs this season."""
    params = {}
    # Standard counting stats
    for s in ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m"]:
        r = conn.execute(
            f"SELECT AVG({s}), AVG({s}*{s}) - AVG({s})*AVG({s}) FROM game_logs WHERE season=? AND min>=15",
            (season,)
        ).fetchone()
        mean = r[0] or 0.0
        var  = max(r[1] or 0.0, 0.0)
        params[s] = {"mean": mean, "std": math.sqrt(var) or 1.0}
    # FG weighted impact = (fg_pct - league_avg_fg_pct) * fga
    # Captures both efficiency and volume — high volume poor shooting hurts, high volume good shooting helps
    fg_avg = conn.execute(
        "SELECT AVG(CAST(fgm AS REAL)/fga) FROM game_logs WHERE season=? AND min>=15 AND fga>0",
        (season,)
    ).fetchone()[0] or 0.0
    r = conn.execute(
        "SELECT AVG((CAST(fgm AS REAL)/fga - ?) * fga), "
        "AVG(((CAST(fgm AS REAL)/fga - ?) * fga) * ((CAST(fgm AS REAL)/fga - ?) * fga)) "
        "- AVG((CAST(fgm AS REAL)/fga - ?) * fga) * AVG((CAST(fgm AS REAL)/fga - ?) * fga) "
        "FROM game_logs WHERE season=? AND min>=15 AND fga>0",
        (fg_avg, fg_avg, fg_avg, fg_avg, fg_avg, season)
    ).fetchone()
    params["fg_pct"] = {"mean": r[0] or 0.0, "std": math.sqrt(max(r[1] or 0.0, 0.0)) or 1.0, "league_avg": fg_avg}
    # FT weighted impact = (ft_pct - league_avg_ft_pct) * fta
    ft_avg = conn.execute(
        "SELECT AVG(CAST(ftm AS REAL)/fta) FROM game_logs WHERE season=? AND min>=15 AND fta>0",
        (season,)
    ).fetchone()[0] or 0.0
    r = conn.execute(
        "SELECT AVG((CAST(ftm AS REAL)/fta - ?) * fta), "
        "AVG(((CAST(ftm AS REAL)/fta - ?) * fta) * ((CAST(ftm AS REAL)/fta - ?) * fta)) "
        "- AVG((CAST(ftm AS REAL)/fta - ?) * fta) * AVG((CAST(ftm AS REAL)/fta - ?) * fta) "
        "FROM game_logs WHERE season=? AND min>=15 AND fta>0",
        (ft_avg, ft_avg, ft_avg, ft_avg, ft_avg, season)
    ).fetchone()
    params["ft_pct"] = {"mean": r[0] or 0.0, "std": math.sqrt(max(r[1] or 0.0, 0.0)) or 1.0, "league_avg": ft_avg}
    return params


@router.get("/box-score")
def get_box_score(date: str = Query(..., description="Date in YYYY-MM-DD format")):
    import time as _time

    if not os.environ.get("RAPIDAPI_KEY"):
        raise HTTPException(503, "RAPIDAPI_KEY not configured on server")

    # Normalise date
    try:
        d = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")

    date_str  = d.strftime("%Y%m%d")
    today     = datetime.utcnow().date()
    from datetime import timedelta
    is_recent = (d >= today - timedelta(days=1))  # TTL cache for today + yesterday (covers AEST/UTC offset)

    # Return cache: TTL for recent dates, indefinite for older completed games
    import time as _time_mod
    if not is_recent and date_str in _box_score_cache:
        return _box_score_cache[date_str]
    if is_recent and _today_cache.get(date_str) and (_time_mod.time() - _today_cache[date_str].get("ts", 0)) < _TODAY_TTL:
        return _today_cache[date_str]["payload"]

    # Determine season
    season_end = d.year + 1 if d.month >= 10 else d.year
    season = f"{season_end - 1}-{str(season_end)[2:]}"

    conn = get_conn()
    z_params   = _league_z_params(conn, season)
    # Injury lookup by Tank01 playerID
    inj_rows = conn.execute(
        "SELECT tank01_id, designation, description FROM injuries WHERE tank01_id IS NOT NULL AND tank01_id != ''"
    ).fetchall()
    inj_by_t01 = {r["tank01_id"]: {"designation": r["designation"], "description": r["description"]} for r in inj_rows}
    # Slug lookup by Tank01 playerID (for clickable player names)
    try:
        slug_rows = conn.execute(
            "SELECT tank01_id, br_slug FROM tank01_player_map WHERE tank01_id IS NOT NULL"
        ).fetchall()
        slug_by_t01 = {r["tank01_id"]: r["br_slug"] for r in slug_rows}
    except Exception:
        slug_by_t01 = {}
    # Fallback: name → slug from players table (covers when tank01_player_map is empty)
    name_rows = conn.execute(
        "SELECT slug, full_name FROM players WHERE season = (SELECT MAX(season) FROM players)"
    ).fetchall()
    slug_by_name = {}
    for r in name_rows:
        slug_by_name[r["full_name"].lower()] = r["slug"]
    conn.close()

    def zs(stat, val):
        p = z_params.get(stat, {"mean": 0, "std": 1})
        return round((val - p["mean"]) / p["std"], 2)

    # Fetch games for date
    try:
        games_resp = _tank01_get("getNBAGamesForDate", {"gameDate": date_str})
        games_list = games_resp.get("body", [])
    except Exception as e:
        raise HTTPException(502, f"Tank01 schedule fetch failed: {e}")

    if not games_list:
        return {"date": date, "games": []}

    results = []
    for g in games_list:
        game_id    = g.get("gameID", "")
        home_abbr  = g.get("home", "")
        away_abbr  = g.get("away", "")

        try:
            bs = _tank01_get("getNBABoxScore", {"gameID": game_id})
            body = bs.get("body", {})
            _time.sleep(0.3)
        except Exception as e:
            logger.warning(f"Box score fetch failed for {game_id}: {e}")
            continue

        home_pts    = body.get("homePts")
        away_pts    = body.get("awayPts")
        status      = body.get("gameStatus", "")
        game_clock  = body.get("gameClock", "")
        margin      = abs(int(home_pts or 0) - int(away_pts or 0)) if home_pts and away_pts else 0
        blowout     = status == "Completed" and margin > 20

        players_raw = body.get("playerStats", {})
        players = []
        for pid, p in players_raw.items():
            def f(k):
                v = p.get(k, 0)
                try: return float(v) if v not in (None, "", "null") else 0.0
                except: return 0.0

            pts  = f("pts");  reb  = f("reb");  ast = f("ast")
            stl  = f("stl");  blk  = f("blk");  tov = f("TOV")
            mins = f("mins"); fgm  = f("fgm");   fga = f("fga")
            fg3m = f("tptfgm"); fg3a = f("tptfga")
            ftm  = f("ftm");  fta  = f("fta")
            pm   = p.get("plusMinus", "0")
            pf   = int(f("PF"))

            players.append({
                "name":       p.get("longName", ""),
                "slug":       slug_by_t01.get(pid) or slug_by_name.get(p.get("longName", "").lower()),
                "team":       p.get("teamAbv", ""),
                "min":        int(mins),
                "plus_minus": pm,
                "pf":         pf,
                "injury":     inj_by_t01.get(pid),
                "pts":        int(pts),  "z_pts": zs("pts", pts),
                "fg3m":       int(fg3m),  "z_fg3m": zs("fg3m", fg3m),
                "reb":        int(reb),  "z_reb": zs("reb", reb),
                "ast":        int(ast),  "z_ast": zs("ast", ast),
                "stl":        int(stl),  "z_stl": zs("stl", stl),
                "blk":        int(blk),  "z_blk": zs("blk", blk),
                "tov":        int(tov),  "z_tov": zs("tov", tov),
                "z_total":    round(zs("pts",pts) + zs("reb",reb) + zs("ast",ast) + zs("stl",stl) + zs("blk",blk) - zs("tov",tov) + zs("fg3m",fg3m) + (round(((fgm/fga - z_params["fg_pct"]["league_avg"]) * fga - z_params["fg_pct"]["mean"]) / z_params["fg_pct"]["std"], 2) if fga > 0 else 0.0) + (round(((ftm/fta - z_params["ft_pct"]["league_avg"]) * fta - z_params["ft_pct"]["mean"]) / z_params["ft_pct"]["std"], 2) if fta > 0 else 0.0), 2),
                "fg":         f"{int(fgm)}/{int(fga)}",
                "fg_pct":     round(fgm/fga, 3) if fga > 0 else None,
                "z_fg_pct":   round(((fgm/fga - z_params["fg_pct"]["league_avg"]) * fga - z_params["fg_pct"]["mean"]) / z_params["fg_pct"]["std"], 2) if fga > 0 else 0.0,
                "ft":         f"{int(ftm)}/{int(fta)}",
                "ft_pct":     round(ftm/fta, 3) if fta > 0 else None,
                "z_ft_pct":   round(((ftm/fta - z_params["ft_pct"]["league_avg"]) * fta - z_params["ft_pct"]["mean"]) / z_params["ft_pct"]["std"], 2) if fta > 0 else 0.0,
            })

        # Sort: home players first (by mins desc), then away (by mins desc)
        home_players = sorted([p for p in players if p["team"] == home_abbr], key=lambda x: -x["min"])
        away_players = sorted([p for p in players if p["team"] == away_abbr], key=lambda x: -x["min"])

        results.append({
            "game_id":    game_id,
            "home":       _TEAM_ABBREV.get(home_abbr, home_abbr),
            "home_abbr":  home_abbr,
            "home_pts":   home_pts,
            "away":       _TEAM_ABBREV.get(away_abbr, away_abbr),
            "away_abbr":  away_abbr,
            "away_pts":   away_pts,
            "status":     status,
            "game_clock": game_clock,
            "blowout":    blowout,
            "margin":     margin,
            "home_players": home_players,
            "away_players": away_players,
        })

    payload = {"date": date, "games": results}

    if is_recent:
        _today_cache[date_str] = {"payload": payload, "ts": _time_mod.time()}
    else:
        _box_score_cache[date_str] = payload

    return payload


# -----------------------------------------------------------------------
# GET /depth-charts
# -----------------------------------------------------------------------

_depth_cache: dict = {}
_DEPTH_CACHE_TTL = 10800   # 3 hours

_POSITION_ORDER = ["PG", "SG", "SF", "PF", "C"]

@router.get("/depth-charts")
def get_depth_charts():
    import time as _t

    cached = _depth_cache.get("all")
    if cached and (_t.time() - cached[0]) < _DEPTH_CACHE_TTL:
        return cached[1]

    try:
        # 1. Depth chart data — ordered positions per team
        dc_data  = _tank01_get("getNBADepthCharts", {})
        dc_teams = dc_data.get("body", [])
        if not dc_teams:
            raise HTTPException(status_code=502, detail="Empty depth chart response from Tank01")

        # 2. Roster data — playerID → bRefID + injury + team conference
        roster_data  = _tank01_get("getNBATeams", {"rosters": "true"})
        roster_body  = roster_data.get("body", {})
        roster_teams = list(roster_body.values()) if isinstance(roster_body, dict) else (roster_body or [])

        player_map: dict = {}   # playerID → {slug, injury}
        team_meta:  dict = {}   # teamAbv  → {conference, name}
        for team in roster_teams:
            tabv = team.get("teamAbv", "")
            team_meta[tabv] = {
                "conference": team.get("conferenceAbv", ""),
                "name":       f"{team.get('teamCity','')} {team.get('teamName','')}".strip(),
            }
            roster  = team.get("Roster", {})
            players = list(roster.values()) if isinstance(roster, dict) else (roster or [])
            for p in players:
                pid = (p.get("playerID") or "").strip()
                if not pid:
                    continue
                inj         = p.get("injury") or {}
                designation = (inj.get("designation") or "").strip() or None
                player_map[pid] = {
                    "slug":   (p.get("bRefID") or "").strip() or None,
                    "injury": designation,
                }

        # 3. Build result
        result = []
        for team in dc_teams:
            tabv = team.get("teamAbv", "")
            dc   = team.get("depthChart", {})
            meta = team_meta.get(tabv, {"conference": "", "name": tabv})
            positions = {}
            for pos in _POSITION_ORDER:
                enriched = []
                for p in dc.get(pos, []):
                    pid = (p.get("playerID") or "").strip()
                    pm  = player_map.get(pid, {})
                    enriched.append({
                        "name":   p.get("longName", ""),
                        "depth":  p.get("depthPosition", ""),
                        "slug":   pm.get("slug"),
                        "injury": pm.get("injury"),
                    })
                positions[pos] = enriched
            result.append({
                "team":       tabv,
                "team_name":  meta["name"],
                "conference": meta["conference"],
                "positions":  positions,
            })

        result.sort(key=lambda t: t["team"])
        _depth_cache["all"] = (_t.time(), result)
        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Depth chart fetch failed: {e}")


# -----------------------------------------------------------------------
# Auth routes (no token required)
# -----------------------------------------------------------------------

auth_router = APIRouter(prefix="/api/auth")


@auth_router.post("/register")
def register(body: dict = Body(...)):
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password required")
    conn = get_conn()
    existing = conn.execute("SELECT id FROM users WHERE username = ?", [username]).fetchone()
    if existing:
        conn.close()
        raise HTTPException(status_code=409, detail="An account with that email already exists")
    hashed = _make_password_hash(password)
    conn.execute(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)", [username, hashed]
    )
    conn.commit()
    conn.close()
    token = jwt.encode({"sub": username}, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return {"token": token}


@auth_router.get("/me")
def get_me(current_user: str = Depends(get_current_user)):
    conn = get_conn()
    row = conn.execute(
        "SELECT username, display_name FROM users WHERE username = ?", [current_user]
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"email": row["username"], "display_name": row["display_name"] or ""}


@auth_router.patch("/me")
def update_me(body: dict = Body(...), current_user: str = Depends(get_current_user)):
    new_email       = (body.get("email") or "").strip() or None
    new_display     = body.get("display_name")  # None means "don't change"
    current_password = body.get("current_password") or ""
    new_password    = (body.get("new_password") or "").strip() or None

    conn = get_conn()
    row = conn.execute(
        "SELECT username, password_hash FROM users WHERE username = ?", [current_user]
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")

    # Any sensitive change requires current password
    if (new_email or new_password) and not _verify_password(current_password, row["password_hash"]):
        conn.close()
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    if new_email and new_email != current_user:
        conflict = conn.execute(
            "SELECT id FROM users WHERE username = ? AND username != ?", [new_email, current_user]
        ).fetchone()
        if conflict:
            conn.close()
            raise HTTPException(status_code=409, detail="An account with that email already exists")
        conn.execute("UPDATE users SET username = ? WHERE username = ?", [new_email, current_user])

    if new_password:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE username = ?",
            [_make_password_hash(new_password), new_email or current_user],
        )

    if new_display is not None:
        conn.execute(
            "UPDATE users SET display_name = ? WHERE username = ?",
            [new_display.strip() or None, new_email or current_user],
        )

    conn.commit()
    conn.close()

    # Issue a fresh token (email may have changed)
    updated_email = new_email or current_user
    token = jwt.encode({"sub": updated_email}, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return {"token": token}


@auth_router.post("/login")
def login(body: dict = Body(...)):
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password required")
    conn = get_conn()
    row = conn.execute(
        "SELECT password_hash FROM users WHERE username = ?", [username]
    ).fetchone()
    conn.close()
    if not row or not _verify_password(password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = jwt.encode({"sub": username}, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return {"token": token}


app.include_router(auth_router)
app.include_router(router)


# Must come AFTER all API routes so /api/* is never caught here.
# -----------------------------------------------------------------------

_FRONTEND_DIST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "..", "frontend", "dist",
)

if os.path.isdir(_FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(_FRONTEND_DIST, "assets")), name="assets")

    @app.get("/")
    def serve_root():
        return FileResponse(os.path.join(_FRONTEND_DIST, "index.html"))

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        # Serve static files that exist; fall back to index.html for SPA routing
        file_path = os.path.join(_FRONTEND_DIST, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(_FRONTEND_DIST, "index.html"))
else:
    @app.get("/")
    def root():
        return {"status": "ok", "message": "NBA stat driver API is running."}
