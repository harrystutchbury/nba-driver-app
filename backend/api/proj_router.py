"""
proj_router.py — Admin endpoints for projection calibration system.

Prefix: /api/admin/projections
All endpoints require admin authentication.
"""

from __future__ import annotations

import os
import sqlite3
import statistics
import sys
from datetime import date, datetime, timedelta
from typing import Any, Optional

import jwt as _jwt
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import InvalidTokenError as JWTError

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from schema import get_conn

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

JWT_SECRET    = os.environ.get("JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
_bearer       = HTTPBearer()


def _get_user(cred: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
    try:
        payload = _jwt.decode(cred.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload["sub"]
    except (JWTError, KeyError):
        raise HTTPException(401, "Invalid token")


def _require_admin(username: str, conn) -> None:
    row = conn.execute("SELECT is_admin FROM users WHERE username=?", [username]).fetchone()
    if not (row and row["is_admin"]):
        raise HTTPException(403, "Admin only")


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

proj_router = APIRouter(prefix="/api/admin/projections")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CURRENT_SEASON   = "2025-26"
PREV_SEASON      = "2025-26"

_UPDATABLE_FIELDS = {
    "projected_gp", "minutes_per_game", "usage_rate", "steal_rate", "block_rate",
    "ast_rate", "oreb_rate", "dreb_rate", "three_pa_rate", "three_p_pct", "two_pa_rate",
    "two_p_pct", "fta_rate", "ft_pct", "tov_rate", "base_year", "scenario",
}

# Age curve: which rate fields each display stat affects
_AGE_CURVE_STAT = {
    "PTS": "PTS", "REB": "REB", "AST": "AST", "STL": "STL", "BLK": "BLK",
    "TOV": "TOV", "3PM": "3PM", "FG%": "FG_PCT", "FT%": "FT_PCT",
}
_AGE_CURVE_FIELDS = {
    "PTS":  ["two_pa_rate", "two_p_pct", "three_pa_rate", "three_p_pct", "fta_rate", "ft_pct"],
    "REB":  ["oreb_rate", "dreb_rate"],
    "AST":  ["ast_rate"],
    "STL":  ["steal_rate"],
    "BLK":  ["block_rate"],
    "TOV":  ["tov_rate"],
    "3PM":  ["three_pa_rate"],
    "FG%":  ["two_p_pct", "three_p_pct"],
    "FT%":  ["ft_pct"],
}

# PTS is the one view whose fields don't all age on the same curve: the
# shooting percentages follow the FG%/FT% efficiency curves, while the
# attempt-rate (volume) fields follow the overall PTS curve.
_PTS_FIELD_CURVE = {
    "two_pa_rate":   "PTS",
    "three_pa_rate": "PTS",
    "fta_rate":      "PTS",
    "two_p_pct":     "FG_PCT",
    "three_p_pct":   "FG_PCT",
    "ft_pct":        "FT_PCT",
}


def _field_curve_map(stat: str) -> dict:
    """Map each of a view's rate fields to the age_curve_lookup stat it ages on."""
    if stat == "PTS":
        return dict(_PTS_FIELD_CURVE)
    curve = _AGE_CURVE_STAT.get(stat)
    return {f: curve for f in _AGE_CURVE_FIELDS.get(stat, [])} if curve else {}


# Age-adjustment action -> the age_curve_lookup column it reads. "no_change"
# just resets to base-year rates (no multiplier).
_ACTION_MULT_COL = {
    "base_change": "base_case_multiplier",
    "optimistic":  "optimistic_multiplier",
    "pessimistic": "pessimistic_multiplier",
}

# Per-row reset: which fields a reset in each view is allowed to touch.
# Deliberately scoped to the current view so resetting a row in, say, the PTS
# view can't clobber hand-tuned AST/REB/STL rates the user set in other views.
_RESET_FIELDS = {
    **_AGE_CURVE_FIELDS,
    "MIN": ["minutes_per_game"],
    "GP":  ["projected_gp"],
}

# Map API stat name → game_logs column (for counting stats)
_STAT_COL = {
    "PTS": "pts", "REB": "reb", "AST": "ast", "STL": "stl",
    "BLK": "blk", "TOV": "tov", "3PM": "fg3m",
}

# ---------------------------------------------------------------------------
# Core computation helpers
# ---------------------------------------------------------------------------

def _current_season(conn) -> str:
    row = conn.execute("SELECT season FROM players ORDER BY season DESC LIMIT 1").fetchone()
    return row["season"] if row else CURRENT_SEASON


def get_team_pace(conn, team: str, season: str) -> float:
    row = conn.execute(
        "SELECT AVG(pace) pace FROM team_games WHERE team=? AND season=?", [team, season]
    ).fetchone()
    if row and row["pace"]:
        return float(row["pace"])
    # Fallback: the requested season has no games yet (e.g. projecting 2026-27
    # pre-season). Use the team's most recent season with pace data rather than a
    # flat 98.0, so projected rates and projected output share the same pace.
    row = conn.execute(
        "SELECT AVG(pace) pace FROM team_games WHERE team=? AND pace IS NOT NULL "
        "GROUP BY season ORDER BY season DESC LIMIT 1", [team]
    ).fetchone()
    return float(row["pace"]) if row and row["pace"] else 98.0


def get_player_season_avgs(conn, player_id: str, season: str) -> dict:
    row = conn.execute("""
        SELECT AVG(min) min, AVG(pts) pts, AVG(reb) reb, AVG(oreb) oreb, AVG(dreb) dreb,
               AVG(ast) ast, AVG(stl) stl, AVG(blk) blk, AVG(tov) tov,
               AVG(fgm) fgm, AVG(fga) fga, AVG(fg3m) fg3m, AVG(fg3a) fg3a,
               AVG(ftm) ftm, AVG(fta) fta, COUNT(*) gp
        FROM game_logs WHERE player_slug=? AND season=? AND min>0
    """, [player_id, season]).fetchone()
    if row and row["gp"]:
        return dict(row)
    return {}


def derive_rates(avgs: dict, pace: float) -> dict:
    """Convert per-game averages + team pace into projection_inputs rate fields."""
    mpg = avgs.get("min") or 0
    if mpg <= 0 or not pace:
        return {}

    poss    = pace * (mpg / 48)
    fg3a    = avgs.get("fg3a") or 0
    fga     = avgs.get("fga") or 0
    two_fga = max(fga - fg3a, 0)
    fg3m    = avgs.get("fg3m") or 0
    fgm     = avgs.get("fgm") or 0
    two_fgm = max(fgm - fg3m, 0)
    tov     = avgs.get("tov") or 0
    fta     = avgs.get("fta") or 0

    # Standard usage formula: (FGA + 0.44*FTA + TOV) / team_possessions
    usage      = (fga + 0.44 * fta + tov) / poss if poss > 0 else 0.2
    usage_used = max(usage, 0.01)

    return {
        "usage_rate":    round(usage, 4),
        "three_pa_rate": round(fg3a / mpg, 4),
        "three_p_pct":   round(fg3m / fg3a, 4) if fg3a > 0 else 0.35,
        "two_pa_rate":   round(two_fga / mpg, 4),
        "two_p_pct":     round(two_fgm / two_fga, 4) if two_fga > 0 else 0.50,
        "fta_rate":      round(fta / mpg, 4),
        "ft_pct":        round((avgs.get("ftm") or 0) / fta, 4) if fta > 0 else 0.75,
        # Possession-based counting rates
        "ast_rate":   round((avgs.get("ast")  or 0) / poss, 4) if poss > 0 else 0,
        "oreb_rate":  round((avgs.get("oreb") or 0) / poss, 4) if poss > 0 else 0,
        "dreb_rate":  round((avgs.get("dreb") or 0) / poss, 4) if poss > 0 else 0,
        "steal_rate": round((avgs.get("stl")  or 0) / poss, 4) if poss > 0 else 0,
        "block_rate": round((avgs.get("blk") or 0) / poss, 4) if poss > 0 else 0,
        # TOV per possession (plain rate, like the other counting stats — not
        # usage-normalised, so it stays editable for players with no usage_rate)
        "tov_rate":   round(tov / poss, 4) if poss > 0 else 0,
    }


def compute_projected(inp: dict, pace: float) -> dict:
    """
    Convert projection_inputs + team pace → projected per-game stat line.

    pace = team possessions per 48-min game (league avg ~98).
    Player possessions ≈ pace * (mpg / 48).
    """
    mpg = inp.get("minutes_per_game") or 0
    if mpg <= 0 or not pace:
        return {}

    poss    = pace * (mpg / 48)
    three_pa = (inp.get("three_pa_rate") or 0) * mpg
    three_pm = three_pa * (inp.get("three_p_pct") or 0)
    two_pa   = (inp.get("two_pa_rate") or 0) * mpg
    two_pm   = two_pa * (inp.get("two_p_pct") or 0)
    fta      = (inp.get("fta_rate") or 0) * mpg
    ftm      = fta * (inp.get("ft_pct") or 0)
    fga      = three_pa + two_pa
    fgm      = three_pm + two_pm

    return {
        "pts":    round(two_pm * 2 + three_pm * 3 + ftm, 1),
        "oreb":   round((inp.get("oreb_rate") or 0) * poss, 1),
        "dreb":   round((inp.get("dreb_rate") or 0) * poss, 1),
        "ast":    round((inp.get("ast_rate") or 0) * poss, 1),
        "stl":    round((inp.get("steal_rate") or 0) * poss, 2),
        "blk":    round((inp.get("block_rate") or 0) * poss, 2),
        "tov":    round((inp.get("tov_rate") or 0) * poss, 1),
        "fg3m":   round(three_pm, 1),
        "fg_pct": round(fgm / fga, 3) if fga > 0 else None,
        "ft_pct": round(inp.get("ft_pct") or 0, 3),
        "fga":    round(fga, 1),
        "fg3a":   round(three_pa, 1),
        "fta":    round(fta, 1),
        "fgm":    round(fgm, 1),
        "ftm":    round(ftm, 1),
    }


def get_min_references(conn, player_id: str, current_season: str) -> dict:
    """Return historical MPG reference values for a player (last 2 seasons)."""
    rows = conn.execute(
        """
        SELECT season, AVG(min) mpg
        FROM game_logs
        WHERE player_slug=? AND min>0 AND season<?
        GROUP BY season ORDER BY season DESC
        LIMIT 2
        """,
        [player_id, current_season],
    ).fetchall()
    seasons = [(r["season"], round(r["mpg"], 1)) for r in rows]
    return {
        "last_yr":  seasons[0][1] if len(seasons) >= 1 else None,
        "prev_yr":  seasons[1][1] if len(seasons) >= 2 else None,
    }


def get_gp_references(conn, player_id: str, current_season: str) -> dict:
    """Return historical GP reference values for a player."""
    rows = conn.execute(
        """
        SELECT season, COUNT(*) gp
        FROM game_logs
        WHERE player_slug=? AND min>0 AND season<?
        GROUP BY season ORDER BY season DESC
        """,
        [player_id, current_season],
    ).fetchall()
    seasons = [(r["season"], r["gp"]) for r in rows]
    last_yr   = seasons[0][1] if len(seasons) >= 1 else None
    prev_yr   = seasons[1][1] if len(seasons) >= 2 else None
    three_avg = round(sum(g for _, g in seasons[:3]) / len(seasons[:3]), 1) if seasons else None
    career    = round(sum(g for _, g in seasons) / len(seasons), 1) if seasons else None
    return {
        "last_yr":   last_yr,
        "prev_yr":   prev_yr,
        "three_avg": three_avg,
        "career":    career,
    }


def get_or_init_inputs(conn, player_id: str, season: str, team: str,
                       base_year: str = PREV_SEASON) -> dict:
    """Return existing projection_inputs row, or auto-init from base_year actuals."""
    row = conn.execute(
        "SELECT * FROM projection_inputs WHERE player_id=? AND season=?",
        [player_id, season],
    ).fetchone()
    if row:
        return dict(row)

    avgs  = get_player_season_avgs(conn, player_id, base_year)
    pace  = get_team_pace(conn, team, base_year)
    mpg   = avgs.get("min") or 0
    rates = derive_rates(avgs, pace) if avgs else {}

    # Default projected_gp to the player's 3-year average GP (steadier than a
    # single season); fall back to last year for players with < 3 seasons.
    gp_refs = get_gp_references(conn, player_id, season)
    default_gp = gp_refs.get("three_avg")
    if default_gp is None:
        default_gp = gp_refs.get("last_yr")
    if default_gp is not None:
        default_gp = round(default_gp)

    return {
        "player_id": player_id, "season": season,
        "base_year": base_year, "scenario": "base_case",
        "projected_gp": default_gp,
        "minutes_per_game": round(mpg, 1),
        **rates,
        "last_updated": None, "updated_by": None,
    }


def _player_age(birthdate_str: Optional[str]) -> Optional[int]:
    if not birthdate_str:
        return None
    try:
        bd  = datetime.strptime(birthdate_str[:10], "%Y-%m-%d").date()
        return int((date.today() - bd).days / 365.25)
    except Exception:
        return None


def _period_dates(conn, period: str) -> tuple[str, str]:
    if period == "full_season":
        season = _current_season(conn)
        row    = conn.execute(
            "SELECT MIN(game_date) d FROM game_logs WHERE season=?", [season]
        ).fetchone()
        return (row["d"] or "2025-10-01"), date.today().isoformat()
    days  = {"last_7": 7, "last_14": 14, "last_30": 30}.get(period, 14)
    end   = date.today()
    start = end - timedelta(days=days)
    return start.isoformat(), end.isoformat()


# ---------------------------------------------------------------------------
# Implied-stat helpers
# ---------------------------------------------------------------------------

def _league_per_min(conn, stat_col: str, season: str) -> Optional[float]:
    """Median per-minute rate across all players with ≥10 games — used for league-avg normalisation."""
    rows = conn.execute(f"""
        SELECT SUM({stat_col}) / SUM(min) rate
        FROM game_logs
        WHERE season=? AND min>0
        GROUP BY player_slug
        HAVING COUNT(*)>=10
    """, [season]).fetchall()
    vals = [r["rate"] for r in rows if r["rate"] is not None]
    return statistics.median(vals) if vals else None


def _implied_stat(full_avgs: dict, period_avgs: dict, stat_col: str,
                  league_rate: Optional[float]) -> dict:
    """
    Return both normalisation variants for the implied-stat column.

    player_historical: project what player would have scored in the period
        if they'd maintained their full-season per-minute rate.
    league_average: same but using the league median per-minute rate.
    """
    period_min = period_avgs.get("min") or 0
    hist_rate  = None
    if full_avgs.get("min") and full_avgs.get(stat_col) is not None:
        hist_rate = full_avgs[stat_col] / full_avgs["min"]

    return {
        "implied_stat_player_historical": round(hist_rate * period_min, 1) if hist_rate else None,
        "implied_stat_league_average":    round(league_rate * period_min, 1) if league_rate and period_min else None,
    }


# ---------------------------------------------------------------------------
# Diagnostic builders (one per stat)
# ---------------------------------------------------------------------------

def _build_pts_diagnostic(inp, period_avgs, full_avgs, nbacom, opp_def_rating, pace, implied):
    fg3a_p  = period_avgs.get("fg3a") or 0
    fga_p   = period_avgs.get("fga") or 0
    fg3m_p  = period_avgs.get("fg3m") or 0
    fgm_p   = period_avgs.get("fgm") or 0
    ftm_p   = period_avgs.get("ftm") or 0
    fta_p   = period_avgs.get("fta") or 0
    tov_p   = period_avgs.get("tov") or 0
    min_p   = period_avgs.get("min") or 0
    poss    = pace * (min_p / 48) if pace and min_p else 0
    two_pa  = fga_p - fg3a_p

    actual_usage = (fga_p + 0.44 * fta_p + tov_p) / poss if poss > 0 else None

    return {
        "projected_min":    inp.get("minutes_per_game"),
        "actual_min":       period_avgs.get("min"),
        "projected_usage":  inp.get("usage_rate"),
        "actual_usage":     round(actual_usage, 3) if actual_usage else None,
        "two_pa_proj":      round((inp.get("two_pa_rate") or 0) * (inp.get("minutes_per_game") or 0), 1),
        "two_pa_actual":    round(two_pa, 1),
        "two_pct_proj":     inp.get("two_p_pct"),
        "two_pct_actual":   round((fgm_p - fg3m_p) / two_pa, 3) if two_pa > 0 else None,
        "three_pa_proj":    round((inp.get("three_pa_rate") or 0) * (inp.get("minutes_per_game") or 0), 1),
        "three_pa_actual":  round(fg3a_p, 1),
        "three_pct_proj":   inp.get("three_p_pct"),
        "three_pct_actual": round(fg3m_p / fg3a_p, 3) if fg3a_p > 0 else None,
        "fta_proj":         round((inp.get("fta_rate") or 0) * (inp.get("minutes_per_game") or 0), 1),
        "fta_actual":       round(fta_p, 1),
        "ft_pct_proj":      inp.get("ft_pct"),
        "ft_pct_actual":    round(ftm_p / fta_p, 3) if fta_p > 0 else None,
        # NBA.com tracking: drives and paint touches are proxies for shot creation
        "drive_frequency":  nbacom.get("drives"),
        "paint_touches_pg": nbacom.get("paint_touches"),
        "opp_def_rating":   opp_def_rating,
        "pace":             round(pace, 1) if pace else None,
        **implied,
    }


def _build_reb_diagnostic(inp, period_avgs, full_avgs, nbacom, opp_reb_rate, pace, implied):
    oreb_p  = period_avgs.get("oreb") or 0
    dreb_p  = period_avgs.get("dreb") or 0
    reb_p   = period_avgs.get("reb") or 0
    min_p   = period_avgs.get("min") or 0
    poss    = pace * (min_p / 48) if pace and min_p else 0

    return {
        "projected_min":    inp.get("minutes_per_game"),
        "actual_min":       min_p,
        "projected_oreb_pct": inp.get("reb_rate"),          # reb_rate proxies combined; split unavailable
        "actual_oreb_pct":  round(oreb_p / reb_p, 3) if reb_p > 0 else None,
        "actual_dreb_pct":  round(dreb_p / reb_p, 3) if reb_p > 0 else None,
        # nbacom: reb_chance is total rebound opportunities the player was present for
        "reb_chance_rate":  round(nbacom.get("reb_chance") / nbacom.get("min"), 3)
                            if nbacom.get("reb_chance") and nbacom.get("min") else None,
        # nbacom: contested_reb = rebounds the player contested (regardless of outcome)
        "contested_reb_rate": round(nbacom.get("contested_reb") / nbacom.get("min"), 3)
                              if nbacom.get("contested_reb") and nbacom.get("min") else None,
        "opp_reb_rate":     opp_reb_rate,
        "pace":             round(pace, 1) if pace else None,
        **implied,
    }


def _build_ast_diagnostic(inp, period_avgs, full_avgs, nbacom, teammate_fg_pct, opp_def_rating, pace, implied):
    return {
        "projected_min":      inp.get("minutes_per_game"),
        "actual_min":         period_avgs.get("min"),
        # nbacom potential_ast = passes that directly led to a shot attempt by teammate
        "potential_ast":      nbacom.get("potential_ast"),
        # ast_conversion = how often the player converts a potential assist into an actual assist
        "ast_conversion_rate": round(nbacom.get("pass_ast") / nbacom.get("potential_ast"), 3)
                               if nbacom.get("potential_ast") else None,
        "passes_made":        nbacom.get("passes_made"),
        "teammate_fg_pct":    teammate_fg_pct,
        "opp_def_rating":     opp_def_rating,
        "pace":               round(pace, 1) if pace else None,
        **implied,
    }


def _build_stl_diagnostic(inp, period_avgs, full_avgs, nbacom, opp_pace, implied):
    stl_p = period_avgs.get("stl") or 0
    defl  = nbacom.get("deflections")
    return {
        "projected_min":          inp.get("minutes_per_game"),
        "actual_min":             period_avgs.get("min"),
        "projected_steal_rate":   inp.get("steal_rate"),
        # deflections = passes the player touched/disrupted — leading indicator for steals
        "deflections_pg":         defl,
        # deflection_to_steal = what fraction of deflections become steals (luck / timing metric)
        "deflection_to_steal_rate": round(stl_p / defl, 3) if defl and defl > 0 else None,
        "opp_pace":               round(opp_pace, 1) if opp_pace else None,
        **implied,
    }


def _build_blk_diagnostic(inp, period_avgs, full_avgs, nbacom, opp_pace, implied):
    blk_p         = period_avgs.get("blk") or 0
    cont_shots    = nbacom.get("contested_shots")
    cont_shots_2pt = nbacom.get("contested_shots_2pt")
    return {
        "projected_min":         inp.get("minutes_per_game"),
        "actual_min":            period_avgs.get("min"),
        "projected_block_rate":  inp.get("block_rate"),
        # contested_shots = all shots the player contests at the rim + perimeter
        "contested_shots_pg":    cont_shots,
        # contested_shots_2pt = inside/rim contests only — most directly linked to blocks
        "contested_shots_2pt_pg": cont_shots_2pt,
        # rim_to_blk_rate = what fraction of rim contests become blocks (skill + positioning)
        "rim_to_blk_rate": round(blk_p / cont_shots_2pt, 3)
                           if cont_shots_2pt and cont_shots_2pt > 0 else None,
        "opp_pace":              round(opp_pace, 1) if opp_pace else None,
        **implied,
    }


def _build_tov_diagnostic(inp, period_avgs, full_avgs, nbacom, opp_stl_rate, pace, implied):
    min_p = period_avgs.get("min") or 0
    return {
        "projected_min":      inp.get("minutes_per_game"),
        "actual_min":         min_p,
        "projected_tov_rate": inp.get("tov_rate"),
        "actual_usage_rate":  inp.get("usage_rate"),           # projecting from saved input
        "passes_made":        nbacom.get("passes_made"),
        # time_of_poss / min = seconds per minute the player has the ball — ball-handler risk proxy
        "ball_in_hand_rate":  round(nbacom.get("time_of_poss") / nbacom.get("min"), 3)
                              if nbacom.get("time_of_poss") and nbacom.get("min") else None,
        # opp_stl_rate = opponent's steal rate per possession — pressure they generate
        "opp_stl_rate":       opp_stl_rate,
        "pace":               round(pace, 1) if pace else None,
        **implied,
    }


def _build_3pm_diagnostic(inp, period_avgs, full_avgs, nbacom, opp_3pt_def, pace, implied):
    fg3a_p  = period_avgs.get("fg3a") or 0
    fg3m_p  = period_avgs.get("fg3m") or 0
    return {
        "projected_min":       inp.get("minutes_per_game"),
        "actual_min":          period_avgs.get("min"),
        "projected_3pa_rate":  inp.get("three_pa_rate"),
        "actual_3pa":          round(fg3a_p, 1),
        "projected_3p_pct":    inp.get("three_p_pct"),
        "actual_3p_pct":       round(fg3m_p / fg3a_p, 3) if fg3a_p > 0 else None,
        # nbacom catch_shoot_fga is a proxy for catch-and-shoot 3PA (includes some 2s)
        "catch_shoot_fga":     nbacom.get("catch_shoot_fga"),
        # nbacom pull_up_fga is a proxy for pull-up 3PA (includes some 2s)
        "pull_up_fga":         nbacom.get("pull_up_fga"),
        # opponent 3PT defence: how many 3PM they allow per possession (lower = tougher defence)
        "opp_3pt_def_rating":  opp_3pt_def,
        "pace":                round(pace, 1) if pace else None,
        **implied,
    }


def _build_fgpct_diagnostic(inp, period_avgs, full_avgs, nbacom, opp_fg_pct_allowed, implied):
    fg3a_p  = period_avgs.get("fg3a") or 0
    fga_p   = period_avgs.get("fga") or 0
    fg3m_p  = period_avgs.get("fg3m") or 0
    fgm_p   = period_avgs.get("fgm") or 0
    two_fga = max(fga_p - fg3a_p, 0)
    two_fgm = max(fgm_p - fg3m_p, 0)

    # Full-season fg_pct for the implied column
    full_fg  = full_avgs.get("fga") or 0
    implied_fg = round((full_avgs.get("fgm") or 0) / full_fg, 3) if full_fg > 0 else None

    return {
        "projected_fga":       round((inp.get("two_pa_rate") or 0 + inp.get("three_pa_rate") or 0)
                                     * (inp.get("minutes_per_game") or 0), 1),
        "actual_fga":          round(fga_p, 1),
        "projected_fg_pct":    inp.get("two_p_pct"),           # simplified: primary rate
        "actual_fg_pct":       round(fgm_p / fga_p, 3) if fga_p > 0 else None,
        # Shot zone distribution (2PT vs 3PT split as proxy for zones — shot_logs not used here)
        "pct_3pt_actual":      round(fg3a_p / fga_p, 3) if fga_p > 0 else None,
        "pct_2pt_actual":      round(two_fga / fga_p, 3) if fga_p > 0 else None,
        "fg_pct_2pt_actual":   round(two_fgm / two_fga, 3) if two_fga > 0 else None,
        "fg_pct_3pt_actual":   round(fg3m_p / fg3a_p, 3) if fg3a_p > 0 else None,
        # nbacom shot-quality indicators
        "drive_fg_pct":        nbacom.get("drive_fg_pct"),
        "catch_shoot_fg_pct":  nbacom.get("catch_shoot_fg_pct"),
        "pull_up_fg_pct":      nbacom.get("pull_up_fg_pct"),
        "opp_fg_pct_allowed":  opp_fg_pct_allowed,
        # implied_fg_pct: what FG% the player would post if shot distribution reverted to full season
        "implied_fg_pct_full_season": implied_fg,
        **implied,
    }


def _build_ftpct_diagnostic(conn, inp, period_avgs, full_avgs, opp_foul_rate, implied, player_id, season):
    fta_p = period_avgs.get("fta") or 0
    ftm_p = period_avgs.get("ftm") or 0
    min_p = period_avgs.get("min") or 0

    # Career FT% across all seasons
    career = conn.execute("""
        SELECT SUM(ftm) / NULLIF(SUM(fta),0) ft_pct FROM game_logs WHERE player_slug=? AND fta>0
    """, [player_id]).fetchone()
    career_ft = round(career["ft_pct"], 3) if career and career["ft_pct"] else None

    # FT% by recent seasons (last 3 seasons before current)
    seasons_rows = conn.execute("""
        SELECT season, SUM(ftm)/NULLIF(SUM(fta),0) ft_pct
        FROM game_logs WHERE player_slug=? AND season<? AND fta>0
        GROUP BY season ORDER BY season DESC LIMIT 3
    """, [player_id, season]).fetchall()
    ft_by_season = {r["season"]: round(r["ft_pct"], 3) for r in seasons_rows if r["ft_pct"]}

    return {
        "projected_min":     inp.get("minutes_per_game"),
        "actual_min":        min_p,
        "projected_fta":     round((inp.get("fta_rate") or 0) * (inp.get("minutes_per_game") or 0), 1),
        "actual_fta":        round(fta_p, 1),
        "projected_ft_pct":  inp.get("ft_pct"),
        "actual_ft_pct":     round(ftm_p / fta_p, 3) if fta_p > 0 else None,
        "fta_rate_period":   round(fta_p / min_p, 4) if min_p > 0 else None,
        "career_ft_pct":     career_ft,
        "ft_pct_by_season":  ft_by_season,
        # opp_foul_rate: how frequently opponents draw fouls — indicates defensive aggressiveness
        "opp_foul_rate":     opp_foul_rate,
        # implied_ft_pct: if FT% reverted to career average
        "implied_ft_pct_career": career_ft,
        **implied,
    }


# ---------------------------------------------------------------------------
# GET /teams
# ---------------------------------------------------------------------------

@proj_router.get("/teams")
def get_teams(current_user: str = Depends(_get_user)):
    conn = get_conn()
    _require_admin(current_user, conn)
    season = _current_season(conn)
    rows   = conn.execute(
        "SELECT DISTINCT team FROM players WHERE season=? AND team IS NOT NULL ORDER BY team",
        [season],
    ).fetchall()
    conn.close()
    return [r["team"] for r in rows if r["team"]]


# ---------------------------------------------------------------------------
# Team-total helpers (shared by /team and /audit-all-teams)
# ---------------------------------------------------------------------------

def _team_proj_total(pdata, stat_key):
    """Projected season total of one stat across a list of a team's players
    ([{inputs, projected}, ...]). GP-weighted; FG%/FT% return a rate."""
    if stat_key == "FG%":
        fgm = sum((pd["inputs"].get("projected_gp") or 0) * (pd["projected"].get("fgm") or 0) for pd in pdata)
        fga = sum((pd["inputs"].get("projected_gp") or 0) * (pd["projected"].get("fga") or 0) for pd in pdata)
        return round(fgm / fga, 3) if fga > 0 else None
    if stat_key == "FT%":
        ftm = sum((pd["inputs"].get("projected_gp") or 0) * (pd["projected"].get("ftm") or 0) for pd in pdata)
        fta = sum((pd["inputs"].get("projected_gp") or 0) * (pd["projected"].get("fta") or 0) for pd in pdata)
        return round(ftm / fta, 3) if fta > 0 else None
    if stat_key == "MIN":
        return round(sum((pd["inputs"].get("projected_gp") or 0) * (pd["inputs"].get("minutes_per_game") or 0)
                         for pd in pdata), 1)
    if stat_key == "GP":
        return round(sum((pd["inputs"].get("projected_gp") or 0) for pd in pdata), 1)
    if stat_key == "REB":
        return round(sum((pd["inputs"].get("projected_gp") or 0) *
                         ((pd["projected"].get("oreb") or 0) + (pd["projected"].get("dreb") or 0))
                         for pd in pdata), 1)
    if stat_key == "FGA":
        return round(sum((pd["inputs"].get("projected_gp") or 0) * (pd["projected"].get("fga") or 0)
                         for pd in pdata), 1)
    col = _STAT_COL.get(stat_key)
    if not col:
        return None
    return round(sum((pd["inputs"].get("projected_gp") or 0) * (pd["projected"].get(col) or 0)
                     for pd in pdata), 1)


def _all_team_totals(conn, season, stat):
    """Projected total of `stat` for every real team in the season -> {team: total}."""
    teams = conn.execute(
        "SELECT DISTINCT team FROM players WHERE season=? AND team IS NOT NULL AND team != 'FA'",
        [season],
    ).fetchall()
    out = {}
    for tr in teams:
        t   = tr["team"]
        tps = conn.execute("SELECT slug FROM players WHERE team=? AND season=?", [t, season]).fetchall()
        pace = get_team_pace(conn, t, season)
        pdata = []
        for tp in tps:
            inp = get_or_init_inputs(conn, tp["slug"], season, t)
            pdata.append({"inputs": inp, "projected": compute_projected(inp, pace)})
        out[t] = _team_proj_total(pdata, stat)
    return out


def _all_team_last_season(conn, stat):
    """Last-season (PREV_SEASON) actual team total of `stat` -> {team: total}, one query."""
    col = _STAT_COL.get(stat)
    if col:
        q = f"SELECT team, SUM({col}) tot FROM game_logs WHERE season=? GROUP BY team"
    elif stat == "MIN":
        q = "SELECT team, SUM(min) tot FROM game_logs WHERE season=? GROUP BY team"
    elif stat == "GP":
        q = "SELECT team, COUNT(*) tot FROM game_logs WHERE season=? AND min>0 GROUP BY team"
    elif stat == "FGA":
        q = "SELECT team, SUM(fga) tot FROM game_logs WHERE season=? GROUP BY team"
    else:
        return {}
    out = {}
    for r in conn.execute(q, [PREV_SEASON]).fetchall():
        out[r["team"]] = round(r["tot"], 1) if r["tot"] else None
    return out


# ---------------------------------------------------------------------------
# GET /team/{team}?stat=PTS
# ---------------------------------------------------------------------------

@proj_router.get("/team/{team}")
def get_team_calibration(
    team: str,
    stat: str = Query("PTS"),
    current_user: str = Depends(_get_user),
):
    conn   = get_conn()
    _require_admin(current_user, conn)
    season = _current_season(conn)
    stat   = stat.upper()

    # Roster — the "FA" pseudo-team lists free agents: players in the system
    # (last season's pool, or explicitly dropped to FA) who are NOT on a real
    # team for the projection season, so they can be re-allocated.
    if team == "FA":
        # Free agents = anyone in the system UNDER 35 (or explicitly dropped to
        # FA) who isn't on a real team for the projection season. The age cap
        # keeps returning vets of any recency while excluding the long-retired.
        cutoff = datetime.now().date()
        try:
            cutoff = cutoff.replace(year=cutoff.year - 35)
        except ValueError:          # Feb 29 → Feb 28
            cutoff = cutoff.replace(year=cutoff.year - 35, day=28)
        players = conn.execute(
            """
            SELECT p.slug, MAX(p.full_name) AS full_name
            FROM players p
            LEFT JOIN player_bio b ON b.br_slug = p.slug
            WHERE p.slug NOT IN (
                    SELECT slug FROM players
                    WHERE season = ? AND team IS NOT NULL AND team != 'FA'
                  )
              AND (
                    (b.birthdate IS NOT NULL AND b.birthdate > ?)
                    OR p.slug IN (SELECT slug FROM players WHERE season = ? AND team = 'FA')
                  )
            GROUP BY p.slug ORDER BY full_name
            """,
            [season, cutoff.isoformat(), season],
        ).fetchall()
    else:
        players = conn.execute(
            "SELECT slug, full_name FROM players WHERE team=? AND season=? ORDER BY full_name",
            [team, season],
        ).fetchall()

    # Bio: age + position
    slugs  = [p["slug"] for p in players]
    if not slugs:
        conn.close()
        return {"team": team, "stat": stat, "season": season, "minutes_total": 0,
                "players": [], "team_projected_total": 0,
                "last_season_team_total": None, "league_avg": None, "league_median": None,
                "league_min": None, "league_max": None, "league_p25": None, "league_p75": None}

    placeholders = ",".join("?" * len(slugs))
    bio_rows = conn.execute(
        f"SELECT br_slug, birthdate, position FROM player_bio WHERE br_slug IN ({placeholders})",
        slugs,
    ).fetchall()
    bio_map = {r["br_slug"]: dict(r) for r in bio_rows}

    pace = get_team_pace(conn, team, season)

    player_data = []
    for p in players:
        pid  = p["slug"]
        bio  = bio_map.get(pid, {})
        age  = _player_age(bio.get("birthdate") if bio else None)
        pos  = bio.get("position") if bio else None

        inp      = get_or_init_inputs(conn, pid, season, team)
        proj     = compute_projected(inp, pace)
        # The "25/26" reference columns compare against the base (last completed)
        # season, not the projection season — which post-roll has no games yet.
        actual   = get_player_season_avgs(conn, pid, PREV_SEASON)

        # Available seasons this player has data for
        avail_rows = conn.execute(
            "SELECT DISTINCT season FROM game_logs WHERE player_slug=? ORDER BY season DESC",
            [pid],
        ).fetchall()
        available_seasons = [r["season"] for r in avail_rows]

        if actual:
            _fgm   = actual.get("fgm")  or 0
            _fga   = actual.get("fga")  or 0
            _fg3m  = actual.get("fg3m") or 0
            _fg3a  = actual.get("fg3a") or 0
            _fg2m  = max(_fgm - _fg3m, 0)
            _fg2a  = max(_fga - _fg3a, 0)
            _ftm   = actual.get("ftm") or 0
            _fta   = actual.get("fta") or 0
            actual_out = {
                "pts":      round(actual.get("pts")  or 0, 1),
                "oreb":     round(actual.get("oreb") or 0, 1),
                "dreb":     round(actual.get("dreb") or 0, 1),
                "ast":      round(actual.get("ast")  or 0, 1),
                "stl":      round(actual.get("stl")  or 0, 2),
                "blk":      round(actual.get("blk")  or 0, 2),
                "tov":      round(actual.get("tov")  or 0, 1),
                "fg3m":     round(_fg3m, 1),
                "fg3a":     round(_fg3a, 1),
                "fg3_pct":  round(_fg3m / _fg3a, 3) if _fg3a > 0 else None,
                "fg2m":     round(_fg2m, 1),
                "fg2a":     round(_fg2a, 1),
                "fg2_pct":  round(_fg2m / _fg2a, 3) if _fg2a > 0 else None,
                "fta":      round(_fta, 1),
                "ftm":      round(_ftm, 1),
                "fg_pct":   round(_fgm / _fga, 3) if _fga > 0 else None,
                "ft_pct":   round(_ftm / _fta, 3) if _fta > 0 else None,
                "min":      round(actual.get("min") or 0, 1),
                "gp":       actual.get("gp") or 0,
            }
            # Last-season rates, derived the same way inputs are, so the
            # "2025/26 Rate" reference columns are comparable to the editable rates.
            actual_rates = derive_rates(actual, pace)
        else:
            actual_out   = {}
            actual_rates = {}

        gp_refs  = get_gp_references(conn, pid, season)
        min_refs = get_min_references(conn, pid, season)

        player_data.append({
            "player_id": pid,
            "full_name": p["full_name"],
            "age":       age,
            "position":  pos,
            "inputs":    inp,
            "projected": proj,
            "actual":    actual_out,
            "actual_rates": actual_rates,
            "available_seasons": available_seasons,
            "gp_references":  gp_refs,
            "min_references": min_refs,
        })

    # Team season minutes total: Σ(projected_gp × mpg)
    minutes_total = round(sum(
        (pd["inputs"].get("projected_gp") or 0) * (pd["inputs"].get("minutes_per_game") or 0)
        for pd in player_data
    ), 1)

    # Team projected total for selected stat — all counting stats are GP-weighted
    # season totals (see module-level _team_proj_total).

    team_proj_total = _team_proj_total(player_data, stat)

    # Last season team actual total — season totals for counting stats, rate for FG%/FT%
    col_name = _STAT_COL.get(stat)
    last_season_team_total = None
    if col_name:
        row = conn.execute(
            f"SELECT SUM({col_name}) FROM game_logs WHERE team=? AND season=?",
            [team, PREV_SEASON],
        ).fetchone()
        if row and row[0]:
            last_season_team_total = round(row[0], 1)
    elif stat == "MIN":
        row = conn.execute(
            "SELECT SUM(min) FROM game_logs WHERE team=? AND season=?",
            [team, PREV_SEASON],
        ).fetchone()
        if row and row[0]:
            last_season_team_total = round(row[0], 1)
    elif stat == "GP":
        row = conn.execute(
            "SELECT COUNT(*) FROM game_logs WHERE team=? AND season=? AND min>0",
            [team, PREV_SEASON],
        ).fetchone()
        if row and row[0]:
            last_season_team_total = row[0]
    elif stat == "FG%":
        row = conn.execute("""
            SELECT SUM(fgm)/NULLIF(SUM(fga),0) FROM game_logs WHERE team=? AND season=?
        """, [team, PREV_SEASON]).fetchone()
        if row and row[0]:
            last_season_team_total = round(row[0], 3)
    elif stat == "FT%":
        row = conn.execute("""
            SELECT SUM(ftm)/NULLIF(SUM(fta),0) FROM game_logs WHERE team=? AND season=?
        """, [team, PREV_SEASON]).fetchone()
        if row and row[0]:
            last_season_team_total = round(row[0], 3)

    # League IQR: projected totals for all 30 teams (shared helper, excludes FA)
    all_team_totals   = _all_team_totals(conn, season, stat)
    league_totals     = [v for v in all_team_totals.values() if v is not None]
    # Other teams' totals (excl. this team) so the frontend can recompute this
    # team's rank live as its projection changes, without a refetch.
    other_team_totals = [v for t, v in all_team_totals.items() if t != team and v is not None]
    league_totals_sorted = sorted(league_totals)
    n = len(league_totals_sorted)
    league_avg    = round(statistics.mean(league_totals_sorted), 1) if league_totals_sorted else None
    league_median = round(statistics.median(league_totals_sorted), 1) if league_totals_sorted else None
    league_min    = round(league_totals_sorted[0], 1) if league_totals_sorted else None
    league_max    = round(league_totals_sorted[-1], 1) if league_totals_sorted else None
    league_p25    = round(league_totals_sorted[n // 4], 1) if n >= 4 else None
    league_p75    = round(league_totals_sorted[3 * n // 4], 1) if n >= 4 else None

    # Rank: 1 = highest projected total (best for counting stats; user can interpret for TOV)
    team_rank = None
    if team_proj_total is not None and league_totals:
        team_rank = sum(1 for t in league_totals if t > team_proj_total) + 1

    # Secondary FGA bar (PTS view only): team's projected FGA total vs last
    # season and the rest of the league.
    fga_block = None
    if stat == "PTS":
        fga_totals = _all_team_totals(conn, season, "FGA")
        fga_vals   = sorted(v for v in fga_totals.values() if v is not None)
        m = len(fga_vals)
        fga_block = {
            "total":  fga_totals.get(team),
            "min":    round(fga_vals[0], 1)        if fga_vals   else None,
            "p25":    round(fga_vals[m // 4], 1)    if m >= 4     else None,
            "median": round(statistics.median(fga_vals), 1) if fga_vals else None,
            "p75":    round(fga_vals[3 * m // 4], 1) if m >= 4    else None,
            "max":    round(fga_vals[-1], 1)        if fga_vals   else None,
            "last":   _all_team_last_season(conn, "FGA").get(team),
        }

    conn.close()
    return {
        "team":                 team,
        "stat":                 stat,
        "season":               season,
        "minutes_total":        minutes_total,
        "players":              player_data,
        "team_projected_total": team_proj_total,
        "last_season_team_total": last_season_team_total,
        "league_avg":           league_avg,
        "league_median":        league_median,
        "league_min":           league_min,
        "league_max":           league_max,
        "league_p25":           league_p25,
        "league_p75":           league_p75,
        "team_rank":            team_rank,
        "team_count":           len(league_totals),
        "other_team_totals":    other_team_totals,
        "fga":                  fga_block,
    }


# ---------------------------------------------------------------------------
# GET /audit-all-teams?stat=  — every team as a row on the league bar
# ---------------------------------------------------------------------------

@proj_router.get("/audit-all-teams")
def audit_all_teams(
    stat:         str = Query("MIN"),
    current_user: str = Depends(_get_user),
):
    """
    One stat across every team: each team's GP-weighted projected total, its
    rank, and the league distribution (min / p25 / median / p75 / max) — powers
    the single-view audit where every team is a row on the same league bar.
    """
    conn = get_conn()
    _require_admin(current_user, conn)
    season = _current_season(conn)
    stat   = stat.upper()

    totals = _all_team_totals(conn, season, stat)
    last   = _all_team_last_season(conn, stat)
    conn.close()

    vals = sorted(v for v in totals.values() if v is not None)
    n    = len(vals)
    league = {
        "league_min":    round(vals[0], 1)        if vals    else None,
        "league_p25":    round(vals[n // 4], 1)    if n >= 4  else None,
        "league_median": round(statistics.median(vals), 1) if vals else None,
        "league_p75":    round(vals[3 * n // 4], 1) if n >= 4 else None,
        "league_max":    round(vals[-1], 1)        if vals    else None,
        "league_avg":    round(statistics.mean(vals), 1) if vals else None,
    }
    rows = []
    for t, total in totals.items():
        rank = (sum(1 for v in totals.values() if v is not None and v > total) + 1) \
            if total is not None else None
        lst = last.get(t)
        last_rank = (sum(1 for v in last.values() if v is not None and v > lst) + 1) \
            if lst is not None else None
        rows.append({"team": t, "total": total, "rank": rank,
                     "last_season_total": lst, "last_season_rank": last_rank})
    rows.sort(key=lambda r: r["total"] if r["total"] is not None else -1e9, reverse=True)

    return {"stat": stat, "season": season, "count": n, **league, "teams": rows}


# ---------------------------------------------------------------------------
# GET /audit
# ---------------------------------------------------------------------------

@proj_router.get("/audit")
def get_audit(
    stat:          str = Query("PTS"),
    period:        str = Query("last_14"),
    threshold:     float = Query(20.0),
    normalisation: str = Query("player_historical"),
    current_user:  str = Depends(_get_user),
):
    conn   = get_conn()
    _require_admin(current_user, conn)
    season = _current_season(conn)
    stat   = stat.upper()
    date_from, date_to = _period_dates(conn, period)

    # League-wide per-min rate for normalisation (computed once)
    col_name      = _STAT_COL.get(stat)
    league_rate   = _league_per_min(conn, col_name, season) if col_name else None

    # All players with projection_inputs for this season
    inp_rows = conn.execute(
        "SELECT * FROM projection_inputs WHERE season=?", [season]
    ).fetchall()

    # Player name + team lookup
    player_meta = {
        r["slug"]: dict(r) for r in conn.execute(
            "SELECT slug, full_name, team FROM players WHERE season=?", [season]
        ).fetchall()
    }

    results = []
    for inp_row in inp_rows:
        pid  = inp_row["player_id"]
        meta = player_meta.get(pid)
        if not meta:
            continue

        team = meta["team"]
        inp  = dict(inp_row)

        # Period actuals
        period_row = conn.execute("""
            SELECT AVG(min) min, AVG(pts) pts, AVG(reb) reb, AVG(oreb) oreb, AVG(dreb) dreb,
                   AVG(ast) ast, AVG(stl) stl, AVG(blk) blk, AVG(tov) tov,
                   AVG(fgm) fgm, AVG(fga) fga, AVG(fg3m) fg3m, AVG(fg3a) fg3a,
                   AVG(ftm) ftm, AVG(fta) fta, COUNT(*) gp
            FROM game_logs
            WHERE player_slug=? AND game_date>=? AND game_date<=? AND min>0
        """, [pid, date_from, date_to]).fetchone()

        if not period_row or not period_row["gp"]:
            continue

        period_avgs = dict(period_row)

        # Full-season actuals for implied-stat normalisation baseline
        full_avgs = get_player_season_avgs(conn, pid, season)

        # Team pace
        pace = get_team_pace(conn, team, season)

        # Projected + actual for the selected stat
        proj    = compute_projected(inp, pace)
        proj_stat, actual_stat = None, None

        if stat in _STAT_COL:
            col        = _STAT_COL[stat]
            proj_stat  = proj.get(col)
            actual_stat = period_avgs.get(col)
        elif stat == "FG%":
            proj_stat   = proj.get("fg_pct")
            fgm_p       = period_avgs.get("fgm") or 0
            fga_p       = period_avgs.get("fga") or 0
            actual_stat = round(fgm_p / fga_p, 3) if fga_p > 0 else None
        elif stat == "FT%":
            proj_stat   = inp.get("ft_pct")
            ftm_p       = period_avgs.get("ftm") or 0
            fta_p       = period_avgs.get("fta") or 0
            actual_stat = round(ftm_p / fta_p, 3) if fta_p > 0 else None

        if proj_stat is None or actual_stat is None or proj_stat == 0:
            continue

        delta_abs = round(actual_stat - proj_stat, 2)
        delta_pct = round(delta_abs / proj_stat * 100, 1)

        if abs(delta_pct) < threshold:
            continue

        # nbacom season avg (full_season proxy — no period nbacom data)
        nbacom_rows = conn.execute("""
            SELECT * FROM nbacom_stats_season_avg
            WHERE player_id=? AND season=? AND period='full_season'
        """, [pid, season]).fetchall()
        # Merge all nbacom measure rows into one flat dict (columns unique per measure_type)
        nbacom: dict[str, Any] = {}
        for nr in nbacom_rows:
            for k, v in dict(nr).items():
                if v is not None and k not in ("player_id", "nba_com_player_id", "season", "period", "measure_type"):
                    nbacom[k] = v

        # Opponent aggregate (avg across games in period)
        opp_row = conn.execute("""
            SELECT AVG(tg.pace) pace,
                   SUM(tg.opp_fgm)*1.0/NULLIF(SUM(tg.opp_fga),0) opp_fg_pct,
                   SUM(tg.opp_fta)*1.0/NULLIF(SUM(tg.opp_fga),0) opp_foul_rate,
                   SUM(tg.opp_fg3m)*1.0/NULLIF(SUM(tg.opp_fga),0) opp_3pt_def,
                   (SUM(tg.opp_oreb)+SUM(tg.opp_dreb))*1.0/NULLIF(AVG(tg.pace),0) opp_reb_rate,
                   (SUM(gl.stl))/NULLIF(AVG(tg.pace)*COUNT(DISTINCT gl.game_date),0) opp_stl_rate
            FROM game_logs gl
            JOIN team_games tg ON tg.game_date=gl.game_date AND tg.team=gl.opponent
            WHERE gl.player_slug=? AND gl.game_date>=? AND gl.game_date<=? AND gl.min>0
        """, [pid, date_from, date_to]).fetchone()
        opp = dict(opp_row) if opp_row else {}

        # Opponent defensive rating: pts allowed per 100 possessions
        opp_def_rating = None
        if opp.get("pace"):
            opp_gl = conn.execute("""
                SELECT AVG(pts) avg_pts FROM (
                    SELECT game_date, SUM(pts) pts FROM game_logs
                    WHERE opponent=? AND game_date>=? AND game_date<=?
                    GROUP BY game_date
                )
            """, [team, date_from, date_to]).fetchone()
            if opp_gl and opp_gl["avg_pts"] and opp.get("pace"):
                opp_def_rating = round(opp_gl["avg_pts"] / opp.get("pace") * 100, 1)

        # Teammate FG% (for AST diagnostic)
        teammate_fg_row = conn.execute("""
            SELECT SUM(fgm)*1.0/NULLIF(SUM(fga),0) fg_pct FROM game_logs
            WHERE team=? AND season=? AND player_slug!=?
        """, [team, season, pid]).fetchone()
        teammate_fg_pct = round(teammate_fg_row["fg_pct"], 3) if teammate_fg_row and teammate_fg_row["fg_pct"] else None

        # Implied stat (both normalisations)
        implied = _implied_stat(full_avgs, period_avgs, col_name or "pts", league_rate) \
                  if col_name else {"implied_stat_player_historical": None, "implied_stat_league_average": None}

        # Build stat-specific diagnostic
        if stat == "PTS":
            diag = _build_pts_diagnostic(inp, period_avgs, full_avgs, nbacom,
                                         opp_def_rating, pace, implied)
        elif stat == "REB":
            diag = _build_reb_diagnostic(inp, period_avgs, full_avgs, nbacom,
                                         opp.get("opp_reb_rate"), pace, implied)
        elif stat == "AST":
            diag = _build_ast_diagnostic(inp, period_avgs, full_avgs, nbacom,
                                         teammate_fg_pct, opp_def_rating, pace, implied)
        elif stat == "STL":
            diag = _build_stl_diagnostic(inp, period_avgs, full_avgs, nbacom,
                                         opp.get("pace"), implied)
        elif stat == "BLK":
            diag = _build_blk_diagnostic(inp, period_avgs, full_avgs, nbacom,
                                         opp.get("pace"), implied)
        elif stat == "TOV":
            diag = _build_tov_diagnostic(inp, period_avgs, full_avgs, nbacom,
                                         opp.get("opp_stl_rate"), pace, implied)
        elif stat == "3PM":
            diag = _build_3pm_diagnostic(inp, period_avgs, full_avgs, nbacom,
                                         opp.get("opp_3pt_def"), pace, implied)
        elif stat == "FG%":
            diag = _build_fgpct_diagnostic(inp, period_avgs, full_avgs, nbacom,
                                           opp.get("opp_fg_pct"), implied)
        elif stat == "FT%":
            diag = _build_ftpct_diagnostic(conn, inp, period_avgs, full_avgs,
                                           opp.get("opp_foul_rate"), implied, pid, season)
        else:
            diag = {"implied_stat_player_historical": None, "implied_stat_league_average": None}

        results.append({
            "player_id":    pid,
            "full_name":    meta["full_name"],
            "team":         team,
            "projected_stat": proj_stat,
            "actual_stat":    actual_stat,
            "delta_pct":      delta_pct,
            "delta_abs":      delta_abs,
            "inputs":         inp,
            "diagnostic":     diag,
        })

    # Sort by absolute delta descending
    results.sort(key=lambda r: abs(r["delta_pct"]), reverse=True)

    conn.close()
    return {
        "stat":      stat,
        "period":    period,
        "threshold": threshold,
        "players":   results,
    }


# ---------------------------------------------------------------------------
# PATCH /player/{player_id}
# ---------------------------------------------------------------------------

@proj_router.patch("/player/{player_id}")
def update_player_projection(
    player_id:    str,
    body:         dict,
    current_user: str = Depends(_get_user),
):
    conn = get_conn()
    _require_admin(current_user, conn)
    season      = body.pop("season", _current_season(conn))
    source_view = body.pop("source_view", "unknown")

    # Identify team for init
    meta = conn.execute(
        "SELECT team FROM players WHERE slug=? AND season=?", [player_id, season]
    ).fetchone()
    team = meta["team"] if meta else "UNK"

    existing = get_or_init_inputs(conn, player_id, season, team)
    now      = datetime.utcnow().isoformat()

    # Only allow whitelisted fields
    updates = {k: v for k, v in body.items() if k in _UPDATABLE_FIELDS}
    if not updates:
        conn.close()
        raise HTTPException(400, "No updatable fields provided")

    # When base_year changes, re-derive all rates from that season's actuals
    if "base_year" in updates:
        new_base = updates["base_year"]
        avgs  = get_player_season_avgs(conn, player_id, new_base)
        pace  = get_team_pace(conn, team, new_base)
        if avgs:
            derived = derive_rates(avgs, pace)
            # Merge derived rates in; base_year and projected_gp are preserved
            updates = {**derived, **updates}

    # Log each changed field
    for field, new_val in updates.items():
        old_val = existing.get(field)
        conn.execute("""
            INSERT INTO projection_edit_log
                (player_id, field_edited, old_value, new_value, edited_at, edited_by, source_view)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, [player_id, field, old_val, new_val, now, current_user, source_view])

    # Merge updates
    merged = {**existing, **updates, "last_updated": now, "updated_by": current_user}

    # Upsert
    cols   = [c for c in merged if c not in ("last_updated", "updated_by")]
    all_cols = list(merged.keys())
    placeholders = ", ".join("?" * len(all_cols))
    set_clause   = ", ".join(f"{c}=excluded.{c}" for c in all_cols)

    conn.execute(f"""
        INSERT INTO projection_inputs ({", ".join(all_cols)})
        VALUES ({placeholders})
        ON CONFLICT(player_id, season) DO UPDATE SET {set_clause}
    """, [merged[c] for c in all_cols])
    conn.commit()

    # Return the updated row
    updated = conn.execute(
        "SELECT * FROM projection_inputs WHERE player_id=? AND season=?",
        [player_id, season],
    ).fetchone()
    conn.close()
    return {"ok": True, "player_id": player_id, "updated": dict(updated) if updated else merged}


# ---------------------------------------------------------------------------
# GET /edit-log
# ---------------------------------------------------------------------------

@proj_router.get("/edit-log")
def get_edit_log(
    limit:        int = Query(100, ge=1, le=500),
    current_user: str = Depends(_get_user),
):
    conn = get_conn()
    _require_admin(current_user, conn)
    rows = conn.execute("""
        SELECT el.*,
               (SELECT full_name FROM players WHERE slug = el.player_id
                ORDER BY season DESC LIMIT 1) AS full_name
        FROM projection_edit_log el
        ORDER BY el.edited_at DESC
        LIMIT ?
    """, [limit]).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# GET /age-curves
# ---------------------------------------------------------------------------

@proj_router.get("/age-curves")
def get_age_curves(current_user: str = Depends(_get_user)):
    conn = get_conn()
    _require_admin(current_user, conn)
    rows = conn.execute(
        "SELECT age, stat, base_case_multiplier, optimistic_multiplier, pessimistic_multiplier "
        "FROM age_curve_lookup ORDER BY stat, age"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# POST /player/{player_id}/apply-curve
# ---------------------------------------------------------------------------

def _apply_curve_to_player(conn, player_id, season, team, stat, action, user):
    """
    Apply an age curve to one player's inputs for one stat view, writing to
    projection_inputs (caller commits). Returns None on success, or an
    (status_code, detail) tuple explaining why it couldn't be applied — the
    single-player endpoint raises it; the bulk endpoint uses it to skip.
    """
    existing  = get_or_init_inputs(conn, player_id, season, team)
    base_year = existing.get("base_year") or PREV_SEASON

    # Fields this stat view owns — the write is scoped to these so an age curve
    # applied in one view can't disturb rates tuned in another.
    scope = _AGE_CURVE_FIELDS.get(stat)
    if not scope:
        return (400, f"No age curve fields for stat {stat}")

    # Always re-derive rates from base_year actuals first.
    avgs = get_player_season_avgs(conn, player_id, base_year)
    pace = get_team_pace(conn, team, base_year)
    if not avgs:
        return (404, f"No game log data for {player_id} in {base_year}")

    derived = derive_rates(avgs, pace)

    mult_col = _ACTION_MULT_COL.get(action)
    if mult_col:   # base_change / optimistic / pessimistic — apply the aging curve
        bio = conn.execute(
            "SELECT birthdate FROM player_bio WHERE br_slug=?", [player_id]
        ).fetchone()
        age = _player_age(bio["birthdate"] if bio else None)
        if age is None:
            return (404, f"No birthdate for {player_id}")

        # Each field ages on its own curve (see _field_curve_map), reading the
        # column for the chosen scenario (base / optimistic / pessimistic).
        field_curves = _field_curve_map(stat)
        if not field_curves:
            return (400, f"No age curve for stat {stat}")
        needed = sorted(set(field_curves.values()))
        rows = conn.execute(
            f"SELECT stat, {mult_col} AS mult FROM age_curve_lookup "
            f"WHERE age=? AND stat IN ({','.join('?' * len(needed))})",
            [age, *needed],
        ).fetchall()
        mult_by_curve = {r["stat"]: r["mult"] for r in rows if r["mult"] is not None}
        if not mult_by_curve:
            return (404, f"No {action} multipliers for age={age}, stat={stat}")
        for field, curve in field_curves.items():
            mult = mult_by_curve.get(curve)
            if mult is not None and field in derived and derived[field] is not None:
                derived[field] = round(derived[field] * mult, 6)

    scoped = {f: derived[f] for f in scope if f in derived}
    if not scoped:
        return (404, f"Could not derive {stat} rates for {player_id}")

    now    = datetime.utcnow().isoformat()
    merged = {**existing, **scoped, "scenario": action, "last_updated": now, "updated_by": user}
    all_cols     = list(merged.keys())
    placeholders = ", ".join("?" * len(all_cols))
    set_clause   = ", ".join(f"{c}=excluded.{c}" for c in all_cols)
    conn.execute(
        f"INSERT INTO projection_inputs ({', '.join(all_cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(player_id, season) DO UPDATE SET {set_clause}",
        [merged[c] for c in all_cols],
    )
    return None


@proj_router.post("/player/{player_id}/apply-curve")
def apply_age_curve(
    player_id:    str,
    body:         dict,
    current_user: str = Depends(_get_user),
):
    """
    Apply (or reset) an age curve to one player's projection inputs.
    Body: { season, stat, action }
      action: "no_change"   = reset rates to base_year actuals (no multiplier)
              "base_change"  = reset, then apply the base age curve
              "optimistic"   = reset, then apply the optimistic age curve
              "pessimistic"  = reset, then apply the pessimistic age curve
    """
    conn   = get_conn()
    _require_admin(current_user, conn)
    season = body.get("season", _current_season(conn))
    stat   = (body.get("stat") or "PTS").upper()
    action = body.get("action", "no_change")

    meta = conn.execute(
        "SELECT team FROM players WHERE slug=? AND season=?", [player_id, season]
    ).fetchone()
    team = meta["team"] if meta else "UNK"

    err = _apply_curve_to_player(conn, player_id, season, team, stat, action, current_user)
    if err:
        conn.close()
        raise HTTPException(err[0], err[1])
    conn.commit()
    updated = conn.execute(
        "SELECT * FROM projection_inputs WHERE player_id=? AND season=?",
        [player_id, season],
    ).fetchone()
    conn.close()
    return {"ok": True, "player_id": player_id, "updated": dict(updated) if updated else None}


@proj_router.post("/team/{team}/apply-curve")
def apply_age_curve_bulk(
    team:         str,
    body:         dict,
    current_user: str = Depends(_get_user),
):
    """
    Apply an age curve to EVERY player on a team for one stat view at once.
    Body: { season, stat, action } (same actions as the single-player route).
    Players that can't be aged (no base-year data / no birthdate) are skipped,
    not failed, so one missing rookie doesn't abort the whole team.
    """
    conn   = get_conn()
    _require_admin(current_user, conn)
    season = body.get("season", _current_season(conn))
    stat   = (body.get("stat") or "PTS").upper()
    action = body.get("action", "no_change")

    players = conn.execute(
        "SELECT slug FROM players WHERE team=? AND season=?", [team, season]
    ).fetchall()
    applied, skipped = [], []
    try:
        for p in players:
            err = _apply_curve_to_player(conn, p["slug"], season, team, stat, action, current_user)
            (skipped if err else applied).append(p["slug"])
        conn.commit()
        return {"ok": True, "team": team, "stat": stat, "action": action,
                "applied": len(applied), "skipped": len(skipped),
                "skipped_players": skipped[:50]}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# POST /player/{player_id}/set-team  — manual roster override
# ---------------------------------------------------------------------------

@proj_router.post("/player/{player_id}/set-team")
def set_player_team(
    player_id:    str,
    body:         dict,
    current_user: str = Depends(_get_user),
):
    """
    Move a player to another team for the projection season (manual roster
    override). Body: { season, team }. Tags the row roster_source='manual' so a
    later ingest won't revert the change. Editing only the projection season's
    players row — no historical game logs are touched.
    """
    conn   = get_conn()
    _require_admin(current_user, conn)
    season   = body.get("season") or _current_season(conn)
    new_team = (body.get("team") or "").strip()
    if not new_team:
        conn.close()
        raise HTTPException(400, "team is required")

    cur = conn.execute(
        "SELECT team FROM players WHERE slug=? AND season=?", [player_id, season]
    ).fetchone()
    if cur:
        conn.execute(
            "UPDATE players SET team=?, roster_source='manual' WHERE slug=? AND season=?",
            [new_team, player_id, season],
        )
        from_team = cur["team"]
    else:
        # Free agent with no row for the projection season — create one so they
        # join the target team's roster. Name comes from their most recent row.
        nm = conn.execute(
            "SELECT full_name FROM players WHERE slug=? ORDER BY season DESC LIMIT 1",
            [player_id],
        ).fetchone()
        if not nm:
            conn.close()
            raise HTTPException(404, f"{player_id} is not in the system")
        conn.execute(
            "INSERT INTO players (slug, full_name, team, season, roster_source) "
            "VALUES (?, ?, ?, ?, 'manual')",
            [player_id, nm["full_name"], new_team, season],
        )
        from_team = "FA"

    conn.commit()
    conn.close()
    return {"ok": True, "player_id": player_id, "season": season,
            "from_team": from_team, "team": new_team}


# ---------------------------------------------------------------------------
# POST /player/{player_id}/reset-row
# ---------------------------------------------------------------------------

@proj_router.post("/player/{player_id}/reset-row")
def reset_row(
    player_id:    str,
    body:         dict,
    current_user: str = Depends(_get_user),
):
    """
    Reset one player's inputs for ONE stat view back to base_year actuals.
    Body: { season, stat }

    Only the fields editable in that view are touched (see _RESET_FIELDS) —
    edits made in other stat views are preserved.
    """
    conn   = get_conn()
    _require_admin(current_user, conn)
    season = body.get("season", _current_season(conn))
    stat   = (body.get("stat") or "PTS").upper()

    fields = _RESET_FIELDS.get(stat)
    if not fields:
        conn.close()
        raise HTTPException(400, f"No reset defined for stat {stat}")

    meta = conn.execute(
        "SELECT team FROM players WHERE slug=? AND season=?", [player_id, season]
    ).fetchone()
    team = meta["team"] if meta else "UNK"

    existing  = get_or_init_inputs(conn, player_id, season, team)
    base_year = existing.get("base_year") or PREV_SEASON

    avgs = get_player_season_avgs(conn, player_id, base_year)
    pace = get_team_pace(conn, team, base_year)
    if not avgs:
        conn.close()
        raise HTTPException(404, f"No game log data for {player_id} in {base_year}")

    # Baseline values for every resettable field, from base_year actuals
    baseline = derive_rates(avgs, pace)
    baseline["minutes_per_game"] = round(avgs.get("min") or 0, 1)
    baseline["projected_gp"]     = int(round(avgs.get("gp") or 0))

    reset_vals = {f: baseline[f] for f in fields if f in baseline}
    if not reset_vals:
        conn.close()
        raise HTTPException(404, f"Could not derive baseline values for {player_id}")

    # Rates now equal the clean base-year values, so any applied age curve is gone.
    # MIN/GP views don't show the scenario dropdown, so leave it alone there.
    if stat not in ("MIN", "GP"):
        reset_vals["scenario"] = "no_change"

    now    = datetime.utcnow().isoformat()
    merged = {**existing, **reset_vals, "last_updated": now, "updated_by": current_user}

    all_cols     = list(merged.keys())
    placeholders = ", ".join("?" * len(all_cols))
    set_clause   = ", ".join(f"{c}=excluded.{c}" for c in all_cols)

    conn.execute(f"""
        INSERT INTO projection_inputs ({", ".join(all_cols)})
        VALUES ({placeholders})
        ON CONFLICT(player_id, season) DO UPDATE SET {set_clause}
    """, [merged[c] for c in all_cols])
    conn.commit()

    updated = conn.execute(
        "SELECT * FROM projection_inputs WHERE player_id=? AND season=?",
        [player_id, season],
    ).fetchone()
    conn.close()
    return {"ok": True, "player_id": player_id, "reset": list(reset_vals.keys()),
            "updated": dict(updated) if updated else merged}


# ---------------------------------------------------------------------------
# PATCH /age-curves
# ---------------------------------------------------------------------------

@proj_router.patch("/age-curves")
def update_age_curves(
    body:         list,
    current_user: str = Depends(_get_user),
):
    conn = get_conn()
    _require_admin(current_user, conn)

    updated = 0
    for item in body:
        age      = item.get("age")
        stat     = item.get("stat")
        opt_mult = item.get("optimistic_multiplier")
        pes_mult = item.get("pessimistic_multiplier")
        if age is None or not stat:
            continue
        conn.execute("""
            UPDATE age_curve_lookup
            SET optimistic_multiplier=?, pessimistic_multiplier=?
            WHERE age=? AND stat=?
        """, [opt_mult, pes_mult, age, stat])
        updated += 1

    conn.commit()
    conn.close()
    return {"ok": True, "updated": updated}
