"""Roto Intel API client — all data fetching for the social pipeline."""

import os
import logging
import requests
from datetime import date, timedelta
from functools import lru_cache

log = logging.getLogger(__name__)


def _make_token() -> str:
    """Generate a JWT for the backend API, or fall back to a pre-generated token."""
    secret = os.environ.get("ROTO_INTEL_JWT_SECRET")
    if secret:
        import jwt
        return jwt.encode({"sub": "social-pipeline"}, secret, algorithm="HS256")
    return os.environ.get("ROTO_INTEL_API_KEY", "")


_TEAM_ABBREV = {
    "ATLANTA HAWKS": "ATL", "BOSTON CELTICS": "BOS", "BROOKLYN NETS": "BKN",
    "CHARLOTTE HORNETS": "CHA", "CHICAGO BULLS": "CHI", "CLEVELAND CAVALIERS": "CLE",
    "DALLAS MAVERICKS": "DAL", "DENVER NUGGETS": "DEN", "DETROIT PISTONS": "DET",
    "GOLDEN STATE WARRIORS": "GSW", "HOUSTON ROCKETS": "HOU", "INDIANA PACERS": "IND",
    "LOS ANGELES CLIPPERS": "LAC", "LOS ANGELES LAKERS": "LAL", "MEMPHIS GRIZZLIES": "MEM",
    "MIAMI HEAT": "MIA", "MILWAUKEE BUCKS": "MIL", "MINNESOTA TIMBERWOLVES": "MIN",
    "NEW ORLEANS PELICANS": "NOP", "NEW YORK KNICKS": "NYK", "OKLAHOMA CITY THUNDER": "OKC",
    "ORLANDO MAGIC": "ORL", "PHILADELPHIA 76ERS": "PHI", "PHOENIX SUNS": "PHX",
    "PORTLAND TRAIL BLAZERS": "POR", "SACRAMENTO KINGS": "SAC", "SAN ANTONIO SPURS": "SAS",
    "TORONTO RAPTORS": "TOR", "UTAH JAZZ": "UTA", "WASHINGTON WIZARDS": "WAS",
}

def abbrev_team(full_name: str) -> str:
    return _TEAM_ABBREV.get((full_name or "").upper(), full_name)

BASE_URL = os.environ.get("ROTO_INTEL_API_BASE_URL", "http://localhost:8000")

_SESSION = requests.Session()
_SESSION.headers.update({"Authorization": f"Bearer {_make_token()}"})


def _get(path: str, params: dict = None, timeout: int = 30) -> list | dict:
    url = f"{BASE_URL}/api{path}"
    try:
        r = _SESSION.get(url, params=params, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        log.error("API error %s %s: %s", path, params, exc)
        raise


def season_rankings(period: str = "season") -> list[dict]:
    """All players ranked by composite z-score for the period (season | l14 | l30)."""
    return _get("/rankings", {"period": period})


def refresh_schedule() -> None:
    """Trigger a schedule sync on the backend — call before weekly projection pulls."""
    try:
        url = f"{BASE_URL}/api/admin/refresh-schedule"
        r = _SESSION.post(url, timeout=30)
        r.raise_for_status()
        log.info("Schedule refreshed: %s", r.json())
    except Exception as exc:
        log.warning("Schedule refresh failed (non-fatal): %s", exc)


def schedule_projections(start: str, end: str) -> list[dict]:
    """Players ranked by schedule-adjusted projected value for the date window."""
    return _get("/projections", {"start": start, "end": end})


def player_game_log(slug: str, season: str = None) -> list[dict]:
    params = {"player": slug}
    if season:
        params["season"] = season
    return _get("/player-games", params)


def injuries() -> list[dict]:
    return _get("/injuries")


def is_season_active() -> bool:
    """Return True if any NBA games are scheduled in the next 7 days."""
    today = date.today()
    end   = today + timedelta(days=7)
    try:
        proj = schedule_projections(today.isoformat(), end.isoformat())
        return len(proj) > 0
    except Exception:
        return False


def data_freshness_ok() -> bool:
    """
    Return True if any player data is available.
    Checks l14 first, falls back to season — either is sufficient to generate content.
    """
    try:
        rows = season_rankings("l14")
        if rows:
            return True
        rows = season_rankings("season")
        return len(rows) > 0
    except Exception:
        return False


def week_window() -> tuple[str, str]:
    """Return (monday, sunday) ISO dates for the current week."""
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    return monday.isoformat(), sunday.isoformat()


def tomorrow_date() -> str:
    return (date.today() + timedelta(days=1)).isoformat()


def previous_week_window() -> tuple[str, str]:
    """Monday–Sunday of the previous week."""
    today  = date.today()
    monday = today - timedelta(days=today.weekday() + 7)
    sunday = monday + timedelta(days=6)
    return monday.isoformat(), sunday.isoformat()


def top_week_projections(n: int = 10) -> list[dict]:
    start, end = week_window()
    players = schedule_projections(start, end)
    return sorted(players, key=lambda p: p.get("period_value") or 0, reverse=True)[:n]


def top_tomorrow_projections(n: int = 10, fa_only: bool = False) -> list[dict]:
    tomorrow = tomorrow_date()
    players  = schedule_projections(tomorrow, tomorrow)
    if fa_only:
        players = [p for p in players if p.get("ownership_pct", 100) < 50]
    return sorted(players, key=lambda p: p.get("period_value") or 0, reverse=True)[:n]


def risers_and_fallers(n: int = 3) -> tuple[list[dict], list[dict]]:
    """
    Return top N risers and top N fallers by z_total delta (l14 vs season average).
    """
    season_map  = {p["slug"]: p for p in season_rankings("season")}
    recent_list = season_rankings("l14")

    deltas = []
    for p in recent_list:
        slug    = p["slug"]
        z_now   = p.get("z_total") or 0
        z_base  = (season_map.get(slug) or {}).get("z_total") or 0
        delta   = round(z_now - z_base, 2)
        deltas.append({**p, "z_delta": delta, "z_base": z_base})

    deltas.sort(key=lambda x: x["z_delta"], reverse=True)
    risers  = [d for d in deltas if d["z_delta"] > 0][:n]
    fallers = sorted(
        [d for d in deltas if d["z_delta"] < 0],
        key=lambda x: x["z_delta"]
    )[:n]
    return risers, fallers


def best_game_performances(n: int = 3) -> list[dict]:
    """
    Top N single-game performances from the previous week by z_total.
    Pulls top-30 season players' game logs and finds the standout games.
    """
    prev_start, prev_end = previous_week_window()
    top_players = season_rankings("season")[:30]

    games = []
    for p in top_players:
        try:
            log_rows = player_game_log(p["slug"])
            for g in log_rows:
                if prev_start <= g.get("game_date", "") <= prev_end:
                    if g.get("z_total") is not None:
                        games.append({
                            "slug":      p["slug"],
                            "name":      p["name"],
                            "team":      p.get("team", ""),
                            "game_date": g["game_date"],
                            "opponent":  g.get("opponent", ""),
                            "z_total":   g["z_total"],
                            "pts":       g.get("pts"),
                            "reb":       g.get("reb"),
                            "ast":       g.get("ast"),
                            "stl":       g.get("stl"),
                            "blk":       g.get("blk"),
                            "fg3m":      g.get("fg3m"),
                        })
        except Exception:
            continue

    return sorted(games, key=lambda g: g["z_total"], reverse=True)[:n]


def top_category_leaders(tomorrow: str, categories: list[str] = None) -> dict[str, dict]:
    """Return the top player per category for tomorrow's slate."""
    if categories is None:
        categories = ["pts", "reb", "ast", "stl", "blk", "fg3m"]
    players = schedule_projections(tomorrow, tomorrow)
    leaders = {}
    for cat in categories:
        best = max(
            (p for p in players if p.get(cat) is not None),
            key=lambda p: p.get(cat) or 0,
            default=None,
        )
        if best:
            leaders[cat] = best
    return leaders
