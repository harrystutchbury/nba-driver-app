from __future__ import annotations

"""
client.py — Thin wrapper around nba_api's LeagueDashPtStats endpoint.

Handles:
- Rate limiting (INTER_CALL_DELAY seconds between every call)
- Exponential backoff retry (up to MAX_RETRIES attempts)
- Column-name normalisation (NBA.com → our DB column names)
"""

import time
import logging
from datetime import date as _date

from nba_api.stats.library.http import NBAStatsHTTP

# Spoof a real browser — stats.nba.com blocks/throttles the default python-requests UA
NBAStatsHTTP.headers = {
    "Host":               "stats.nba.com",
    "User-Agent":         "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept":             "application/json, text/plain, */*",
    "Accept-Language":    "en-AU,en;q=0.9",
    "Accept-Encoding":    "gzip, deflate, br",
    "x-nba-stats-origin": "stats",
    "x-nba-stats-token":  "true",
    "Referer":            "https://www.nba.com/",
    "Origin":             "https://www.nba.com",
    "Connection":         "keep-alive",
    "Sec-Fetch-Dest":     "empty",
    "Sec-Fetch-Mode":     "cors",
    "Sec-Fetch-Site":     "same-site",
}

log = logging.getLogger(__name__)

INTER_CALL_DELAY = 2.0   # seconds between every API call
MAX_RETRIES      = 3
CURRENT_SEASON   = "2025-26"
SEASON_START     = _date(2025, 10, 22)

MEASURE_TYPES = [
    "SpeedDistance",
    "Rebounding",
    "Possessions",
    "CatchShoot",
    "PullUpShot",
    "Defense",
    "Drives",
    "Passing",
    "ElbowTouch",
    "PostTouch",
    "PaintTouch",
    "Efficiency",
    "Hustle",
]

# Maps each NBA.com column name to our snake_case DB column name.
# "AST" from the Passing measure is stored as pass_ast to avoid ambiguity.
MEASURE_COL_MAP: dict[str, dict[str, str]] = {
    "SpeedDistance": {
        "DIST_FEET":      "dist_feet",
        "DIST_MILES":     "dist_miles",
        "DIST_MILES_OFF": "dist_miles_off",
        "DIST_MILES_DEF": "dist_miles_def",
        "AVG_SPEED":      "avg_speed",
        "AVG_SPEED_OFF":  "avg_speed_off",
        "AVG_SPEED_DEF":  "avg_speed_def",
    },
    "Rebounding": {
        "OREB_CHANCE":         "oreb_chance",
        "DREB_CHANCE":         "dreb_chance",
        "REB_CHANCE":          "reb_chance",
        "CONTESTED_OREB":      "contested_oreb",
        "CONTESTED_DREB":      "contested_dreb",
        "CONTESTED_REB":       "contested_reb",
        "DEFERRED_REB_CHANCE": "deferred_reb_chance",
        "REB_CHANCE_PCT":      "reb_chance_pct",
        "OREB_CHANCE_PCT":     "oreb_chance_pct",
        "DREB_CHANCE_PCT":     "dreb_chance_pct",
    },
    "Possessions": {
        "TOUCHES":           "touches",
        "FRONT_CT_TOUCHES":  "front_ct_touches",
        "PAINT_TOUCHES":     "paint_touches",
        "POST_TOUCHES":      "post_touches",
        "ELBOW_TOUCHES":     "elbow_touches",
        "TIME_OF_POSS":      "time_of_poss",
        "AVG_SEC_PER_TOUCH": "avg_sec_per_touch",
        "PTS_PER_TOUCH":     "pts_per_touch",
    },
    "CatchShoot": {
        "CATCH_SHOOT_FGM":     "catch_shoot_fgm",
        "CATCH_SHOOT_FGA":     "catch_shoot_fga",
        "CATCH_SHOOT_FG_PCT":  "catch_shoot_fg_pct",
        "CATCH_SHOOT_PTS":     "catch_shoot_pts",
        "CATCH_SHOOT_EFG_PCT": "catch_shoot_efg_pct",
    },
    "PullUpShot": {
        "PULL_UP_FGM":     "pull_up_fgm",
        "PULL_UP_FGA":     "pull_up_fga",
        "PULL_UP_FG_PCT":  "pull_up_fg_pct",
        "PULL_UP_PTS":     "pull_up_pts",
        "PULL_UP_EFG_PCT": "pull_up_efg_pct",
    },
    "Defense": {
        "CONTESTED_SHOTS":      "contested_shots",
        "CONTESTED_SHOTS_2PT":  "contested_shots_2pt",
        "CONTESTED_SHOTS_3PT":  "contested_shots_3pt",
        "DEFLECTIONS":          "deflections",
        "CHARGES_DRAWN":        "charges_drawn",
        "LOOSE_BALLS_RECOVERED":"loose_balls_recovered",
        "SCREEN_ASSISTS":       "screen_assists",
    },
    "Drives": {
        "DRIVES":      "drives",
        "DRIVE_FGM":   "drive_fgm",
        "DRIVE_FGA":   "drive_fga",
        "DRIVE_FG_PCT":"drive_fg_pct",
        "DRIVE_PTS":   "drive_pts",
        "DRIVE_AST":   "drive_ast",
        "DRIVE_TOV":   "drive_tov",
        "DRIVE_PF":    "drive_pf",
    },
    "Passing": {
        "PASSES_MADE":    "passes_made",
        "PASSES_RECEIVED":"passes_received",
        "POTENTIAL_AST":  "potential_ast",
        "AST":            "pass_ast",   # renamed to avoid keyword collision
        "SECONDARY_AST":  "secondary_ast",
        "AST_TO":         "ast_to",
        "AST_RATIO":      "ast_ratio",
    },
    "ElbowTouch": {
        "ELBOW_TOUCH_FGM":    "elbow_touch_fgm",
        "ELBOW_TOUCH_FGA":    "elbow_touch_fga",
        "ELBOW_TOUCH_FG_PCT": "elbow_touch_fg_pct",
        "ELBOW_TOUCH_PTS":    "elbow_touch_pts",
        "ELBOW_TOUCH_AST":    "elbow_touch_ast",
        "ELBOW_TOUCH_TOV":    "elbow_touch_tov",
    },
    "PostTouch": {
        "POST_TOUCH_FGM":    "post_touch_fgm",
        "POST_TOUCH_FGA":    "post_touch_fga",
        "POST_TOUCH_FG_PCT": "post_touch_fg_pct",
        "POST_TOUCH_PTS":    "post_touch_pts",
        "POST_TOUCH_AST":    "post_touch_ast",
        "POST_TOUCH_TOV":    "post_touch_tov",
    },
    "PaintTouch": {
        "PAINT_TOUCH_FGM":    "paint_touch_fgm",
        "PAINT_TOUCH_FGA":    "paint_touch_fga",
        "PAINT_TOUCH_FG_PCT": "paint_touch_fg_pct",
        "PAINT_TOUCH_PTS":    "paint_touch_pts",
        "PAINT_TOUCH_AST":    "paint_touch_ast",
        "PAINT_TOUCH_TOV":    "paint_touch_tov",
    },
    "Efficiency": {
        "PIE":              "pie",
        "TRUE_SHOOTING_PCT":"true_shooting_pct",
        "USG_PCT":          "usg_pct",
        "AST_PCT":          "ast_pct",
        "OREB_PCT":         "oreb_pct",
        "DREB_PCT":         "dreb_pct",
        "REB_PCT":          "reb_pct",
        "NET_RATING":       "net_rating",
        "OFF_RATING":       "off_rating",
        "DEF_RATING":       "def_rating",
    },
}

# All DB stat column names in a flat set (for schema/insert generation)
ALL_STAT_DB_COLS: set[str] = {
    db_col
    for col_map in MEASURE_COL_MAP.values()
    for db_col in col_map.values()
}


def _fmt_date(d: _date) -> str:
    """Format a date for the nba_api endpoint: M/D/YYYY (no leading zeros)."""
    return f"{d.month}/{d.day}/{d.year}"


_last_call_time: float = 0.0


def _rate_limited_sleep():
    """Block until INTER_CALL_DELAY seconds have elapsed since the last API call."""
    global _last_call_time
    elapsed = time.monotonic() - _last_call_time
    wait = INTER_CALL_DELAY - elapsed
    if wait > 0:
        time.sleep(wait)
    _last_call_time = time.monotonic()


def fetch_measure(
    measure_type: str,
    date_from: _date,
    date_to: _date,
    per_mode: str = "PerGame",
    timeout: int = 60,
) -> list[dict]:
    """
    Fetch LeagueDashPtStats for one measure_type and date range.

    Returns a list of dicts with keys: nba_com_player_id, player_name,
    team_abbreviation, gp, min, plus the DB-renamed stat columns for this
    measure type. All other stat DB columns are absent (callers set them NULL).

    Raises RuntimeError after MAX_RETRIES failures.
    """
    from nba_api.stats.endpoints import leaguedashptstats  # imported lazily so the module loads without nba_api installed

    col_map = MEASURE_COL_MAP[measure_type]
    date_from_str = _fmt_date(date_from)
    date_to_str   = _fmt_date(date_to)

    last_exc: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        _rate_limited_sleep()
        try:
            result = leaguedashptstats.LeagueDashPtStats(
                player_or_team="Player",
                per_mode_simple=per_mode,
                pt_measure_type=measure_type,
                season=CURRENT_SEASON,
                season_type_all_star="Regular Season",
                date_from_nullable=date_from_str,
                date_to_nullable=date_to_str,
                timeout=timeout,
            )
            # Find the player-level result set (has PLAYER_ID column).
            # Some measure types return a team/league summary as frame 0.
            all_frames = result.get_data_frames()
            df = next(
                (f for f in all_frames if "PLAYER_ID" in f.columns),
                all_frames[0],  # fall back to first frame so error is descriptive
            )
            break
        except Exception as exc:
            last_exc = exc
            backoff = 2 ** attempt
            log.warning(
                "fetch_measure %s attempt %d/%d failed: %s — retrying in %ds",
                measure_type, attempt, MAX_RETRIES, exc, backoff,
            )
            if attempt < MAX_RETRIES:
                time.sleep(backoff)
    else:
        raise RuntimeError(
            f"fetch_measure {measure_type} failed after {MAX_RETRIES} attempts: {last_exc}"
        ) from last_exc

    # Normalise to dicts with our DB column names
    if "PLAYER_ID" not in df.columns:
        log.warning("fetch_measure %s: no PLAYER_ID column in response (columns: %s)", measure_type, list(df.columns))
        return []

    rows = []
    for _, api_row in df.iterrows():
        row: dict = {
            "nba_com_player_id": int(api_row["PLAYER_ID"]),
            "player_name":       str(api_row["PLAYER_NAME"]),
            "team_abbreviation": str(api_row.get("TEAM_ABBREVIATION", "")),
            "gp":                int(api_row.get("GP", 0) or 0),
            "min":               float(api_row.get("MIN", 0) or 0),
        }
        for api_col, db_col in col_map.items():
            val = api_row.get(api_col)
            row[db_col] = float(val) if val is not None and str(val) != "nan" else None
        rows.append(row)

    return rows
