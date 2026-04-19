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

from fastapi import FastAPI, APIRouter, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from typing import Optional
import sys
import os
import math
import logging
from datetime import datetime

import numpy as np
from apscheduler.schedulers.background import BackgroundScheduler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from schema import get_conn
from engine.decompose import decompose
from engine.shots import decompose_shots
from engine.training_data import build_dataset
from engine.archetypes import assign_archetypes, ARCHETYPES, _assign_row
from engine.regress import REG_FEATURES, REG_TARGETS, predict as regress_predict, load_model
from engine.aging import build_aging_curves, aging_ratio as _aging_ratio

logger = logging.getLogger(__name__)


def _current_season_end_year():
    now = datetime.utcnow()
    return now.year + 1 if now.month >= 10 else now.year


def _daily_refresh():
    try:
        import refresh
        season_year = _current_season_end_year()
        logger.info(f"Daily refresh starting for season {season_year}")
        refresh.run([season_year])
        logger.info("Daily refresh complete")
    except Exception:
        logger.exception("Daily refresh failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(_daily_refresh, 'cron', hour=8, minute=0)
    scheduler.start()
    logger.info("Scheduler started — daily refresh at 08:00 UTC")
    yield
    scheduler.shutdown()


app = FastAPI(title="NBA Stat Driver API", lifespan=lifespan)
router = APIRouter(prefix="/api")

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
        # Return one row per player — the most recent season
        sql = """
            SELECT slug, full_name, team, MAX(season) AS season
            FROM players
            WHERE 1=1
        """
        params = []
        if q:
            sql += " AND full_name LIKE ?"
            params.append(f"%{q}%")
        sql += " GROUP BY slug ORDER BY full_name"

    rows = conn.execute(sql, params).fetchall()
    conn.close()

    return [
        {
            "slug":   r["slug"],
            "name":   r["full_name"],
            "team":   r["team"],
            "season": r["season"],
        }
        for r in rows
    ]


# -----------------------------------------------------------------------
# GET /player-stats
# -----------------------------------------------------------------------

Z_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fg3m', 'fg_pct', 'ft_pct']


def _avg_row(rows):
    """Aggregate a list of game_log rows into per-game averages."""
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
    return {
        "gp":     gp,
        "min_pg": round(min_pg, 1),
        "pts":    round(pts,  1),
        "reb":    round(reb,  1),
        "ast":    round(ast,  1),
        "stl":    round(stl,  1),
        "blk":    round(blk,  1),
        "tov":    round(tov,  1),
        "fg3m":   round(fg3m, 1),
        "fg_pct": round(fg_pct * 100, 1) if fg_pct is not None else None,
        "ft_pct": round(ft_pct * 100, 1) if ft_pct is not None else None,
        "fga_pg": round(fga_pg, 1),
        "fta_pg": round(fta_pg, 1),
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
        SELECT season, min, pts, reb, ast, stl, blk, tov, fgm, fga, fg3m, ftm, fta, game_date
        FROM game_logs
        WHERE player_slug = ? AND min > 0
        ORDER BY game_date DESC
    """, (player,)).fetchall()
    rows = [dict(r) for r in rows]

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

    conn.close()

    def with_rank(avg, league, player_rows):
        if avg is None:
            return None
        rank, n = _player_rank(player, player_rows, league)
        return {**_with_zscores(avg, league), "rank": rank, "rank_n": n}

    season_avgs = [
        {"period": s, "team": team_by_season.get(s, ""), **with_rank(_avg_row(g), league_by_season.get(s), rows_by_season.get(s, []))}
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
        "player":  {"slug": player, "name": player_row["full_name"], "team": player_row["team"], "age": current_age, "position": player_row["position_group"]},
        "career":  with_rank(_avg_row(rows),                                     league_career, rows_career),
        "seasons": season_avgs,
        "l30":     with_rank(_avg_row([r for r in rows if r["game_date"] >= cutoff_30]), league_l30, rows_l30),
        "l14":     with_rank(_avg_row([r for r in rows if r["game_date"] >= cutoff_14]), league_l14, rows_l14),
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
    conn.close()

    if result is None:
        raise HTTPException(
            status_code=404,
            detail="Insufficient data for the requested player and date ranges."
        )

    return {
        "player": {
            "slug": player,
            "name": player_row["full_name"],
            "team": player_row["team"],
        },
        "stat":     stat,
        "period_a": {"start": pa_start, "end": pa_end, "value": result.stat_a},
        "period_b": {"start": pb_start, "end": pb_end, "value": result.stat_b},
        "delta":    result.delta,
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
    df = df.dropna(subset=['archetype'])
    df['age_int'] = df['age'].apply(lambda a: int(a))

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
    # We avoid Ridge regression-to-mean in the loop — it suppresses young breakout players.
    PROJ_STATS = ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fg3m', 'fg_pct']
    prev_p30 = {
        'pts':    float(current.get('p30_pts',  0) or 0),
        'reb':    float(current.get('p30_reb',  0) or 0),
        'ast':    float(current.get('p30_ast',  0) or 0),
        'stl':    float(current.get('p30_stl',  0) or 0),
        'blk':    float(current.get('p30_blk',  0) or 0),
        'tov':    float(current.get('p30_tov',  0) or 0),
        'fg3m':   float(current.get('p30_fg3m', 0) or 0),
        'fg_pct': float(current.get('fg_pct',   0) or 0),
    }
    projections = []
    current_archetype = archetype
    for yr in range(1, MAX_YEARS + 1):
        current_age = float(current.get('age', 25)) + (yr - 1)
        next_age    = current_age + 1
        p30 = {}
        for stat in PROJ_STATS:
            base  = prev_p30.get(stat, 0)
            ratio = _aging_ratio(aging_curves, current_archetype, stat, current_age, next_age)
            p30[stat] = round(base * ratio, 2)

        p30['ft_pct'] = proj_ft_pct
        pg  = {s: round(p30[s] * scale, 1) for s in counting if s in p30}
        pg['fg_pct'] = round(p30.get('fg_pct', 0), 1)
        pg['ft_pct'] = proj_ft_pct
        projections.append({
            'year':      yr,
            'season':    _season_label(str(current['season']), yr),
            'archetype': current_archetype,
            'projection_p30': p30,
            'projection_pg':  pg,
            'z_sum':     _proj_z_sum(p30, proj_ft_pct),
        })
        prev_p30 = p30
        # Re-derive archetype from projected stats for next iteration
        next_archetype = _assign_row(
            pos=position_group,
            pts=p30['pts'],
            ast=p30['ast'],
            fg3m=p30['fg3m'],
            blk=p30['blk'],
            reb=p30['reb'],
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
            season    = str(_current_season_end_year())
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

        # Build slug → position+name map (latest season per slug)
        bio_rows = conn.execute("""
            SELECT p.slug, p.full_name AS name, p.team, b.position_group AS position
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
def get_schedule_projection(player: str = Query(..., description="Player slug")):
    """
    Return upcoming games for the player's team with per-game projected stats
    scaled by each opponent's defensive strength vs the player's position group.
    """
    from datetime import date

    conn = get_conn()
    try:
        # ── 1. Player baseline (current season per-game avg) ──────────────
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

        season_year     = _current_season_end_year()
        end_yr          = season_year
        season_label    = f"{end_yr - 1}-{str(end_yr)[2:]}"   # e.g. "2025-26"

        game_rows = conn.execute("""
            SELECT min, pts, reb, ast, stl, blk, tov, fgm, fga, fg3m, ftm, fta
            FROM game_logs
            WHERE player_slug = ? AND season = ? AND min > 0
        """, (player, season_label)).fetchall()
        game_rows = [dict(r) for r in game_rows]

        if not game_rows:
            return {"games": [], "baseline": {}, "error": "No current season data"}

        baseline = _avg_row(game_rows)

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

        # ── 3. Forward schedule (from DB, populated by daily refresh) ─────
        today = date.today().isoformat()
        sched_rows = conn.execute("""
            SELECT game_date, home_team, away_team
            FROM nba_schedule
            WHERE season = ?
              AND game_date >= ?
              AND (home_team = ? OR away_team = ?)
            ORDER BY game_date
            LIMIT 10
        """, (season_year, today, team, team)).fetchall()

        upcoming = []
        for row in sched_rows:
            is_home  = row["home_team"] == team
            opponent = row["away_team"] if is_home else row["home_team"]
            upcoming.append({
                "date":      row["game_date"],
                "opponent":  opponent,
                "home_away": "Home" if is_home else "Away",
            })

        # ── 4. Apply opponent factor to baseline ──────────────────────────
        games_out = []
        for g in upcoming:
            opp     = g["opponent"]
            factors = opp_factors.get(opp, {stat: 1.0 for stat in SCHED_STATS})
            projected = {}
            for stat in SCHED_STATS:
                base = baseline.get(stat)
                if base is not None:
                    projected[stat] = round(base * factors.get(stat, 1.0), 1)
                else:
                    projected[stat] = None
            games_out.append({**g, "projected": projected, "factors": {
                stat: round(factors.get(stat, 1.0), 3) for stat in SCHED_STATS
            }})

        return {
            "player":   player,
            "team":     team,
            "position": position,
            "baseline": {stat: baseline.get(stat) for stat in SCHED_STATS},
            "games":    games_out,
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
# Health check
# -----------------------------------------------------------------------

@router.get("/healthz")
def health():
    return {"status": "ok"}


app.include_router(router)


# -----------------------------------------------------------------------
# Serve React frontend (production build)
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
