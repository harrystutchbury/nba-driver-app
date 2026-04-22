"""
sync_injuries.py — Fetch current NBA injury report from Tank01 and upsert into DB.

Fetches all 30 teams via getNBATeams?rosters=true, extracts players with an
injury designation, and upserts the injuries table.  Players who no longer
appear in the injury report are removed (recovered / back to active).

Usage:
    export RAPIDAPI_KEY=your_key_here
    python sync_injuries.py
"""

import json
import logging
import os
import time
import urllib.request
import urllib.parse
from datetime import datetime, date

from schema import get_conn, init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

RAPIDAPI_KEY  = os.environ.get("RAPIDAPI_KEY", "")
RAPIDAPI_HOST = "tank01-fantasy-stats.p.rapidapi.com"
REQUEST_DELAY = 0.5   # seconds between API calls

# All 30 NBA team abbreviations (Tank01 standard)
ALL_TEAMS = [
    "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GS",
    "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NO", "NY",
    "OKC", "ORL", "PHI", "PHO", "POR", "SA", "SAC", "TOR", "UTA", "WAS",
]

TEAM_ABBREV = {
    "ATL": "ATLANTA HAWKS",      "BOS": "BOSTON CELTICS",
    "BKN": "BROOKLYN NETS",      "CHA": "CHARLOTTE HORNETS",
    "CHI": "CHICAGO BULLS",      "CLE": "CLEVELAND CAVALIERS",
    "DAL": "DALLAS MAVERICKS",   "DEN": "DENVER NUGGETS",
    "DET": "DETROIT PISTONS",    "GS":  "GOLDEN STATE WARRIORS",
    "GSW": "GOLDEN STATE WARRIORS",
    "HOU": "HOUSTON ROCKETS",    "IND": "INDIANA PACERS",
    "LAC": "LOS ANGELES CLIPPERS", "LAL": "LOS ANGELES LAKERS",
    "MEM": "MEMPHIS GRIZZLIES",  "MIA": "MIAMI HEAT",
    "MIL": "MILWAUKEE BUCKS",    "MIN": "MINNESOTA TIMBERWOLVES",
    "NO":  "NEW ORLEANS PELICANS", "NOP": "NEW ORLEANS PELICANS",
    "NY":  "NEW YORK KNICKS",    "NYK": "NEW YORK KNICKS",
    "OKC": "OKLAHOMA CITY THUNDER", "ORL": "ORLANDO MAGIC",
    "PHI": "PHILADELPHIA 76ERS", "PHO": "PHOENIX SUNS",
    "POR": "PORTLAND TRAIL BLAZERS",
    "SA":  "SAN ANTONIO SPURS",  "SAS": "SAN ANTONIO SPURS",
    "SAC": "SACRAMENTO KINGS",   "TOR": "TORONTO RAPTORS",
    "UTA": "UTAH JAZZ",          "WAS": "WASHINGTON WIZARDS",
}


def _get(endpoint: str, params: dict) -> dict:
    if not RAPIDAPI_KEY:
        raise RuntimeError("RAPIDAPI_KEY env var not set")
    qs  = urllib.parse.urlencode(params)
    url = f"https://{RAPIDAPI_HOST}/{endpoint}?{qs}"
    req = urllib.request.Request(url, headers={
        "X-RapidAPI-Key":  RAPIDAPI_KEY,
        "X-RapidAPI-Host": RAPIDAPI_HOST,
    })
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _parse_date(yyyymmdd: str):
    """Convert YYYYMMDD string to YYYY-MM-DD, or return None."""
    if not yyyymmdd or len(yyyymmdd) != 8:
        return None
    try:
        return f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:]}"
    except Exception:
        return None


def fetch_team_roster(team_abbr: str) -> list:
    """Return list of player dicts for a team, including injury fields."""
    data = _get("getNBATeams", {"teamAbv": team_abbr, "rosters": "true"})
    time.sleep(REQUEST_DELAY)
    body = data.get("body", {})
    # Body may be a list or dict depending on whether one or many teams returned
    if isinstance(body, list):
        teams = body
    elif isinstance(body, dict):
        teams = list(body.values())
    else:
        return []

    players = []
    for team in teams:
        roster = team.get("Roster", {})
        team_abbr_resp = team.get("teamAbv", team_abbr)
        team_name = TEAM_ABBREV.get(team_abbr_resp.upper(), team_abbr_resp)
        if isinstance(roster, dict):
            roster = list(roster.values())
        for p in roster:
            inj = p.get("injury") or {}
            designation = (inj.get("designation") or "").strip()
            if not designation:
                continue  # active — skip
            players.append({
                "player_slug": (p.get("bRefID") or "").strip(),
                "tank01_id":   (p.get("playerID") or "").strip(),
                "name":        (p.get("longName") or p.get("espnName") or "").strip(),
                "team":        team_name,
                "designation": designation,
                "description": (inj.get("description") or "").strip(),
                "inj_date":    _parse_date(inj.get("injDate", "")),
                "return_date": _parse_date(inj.get("injReturnDate", "")),
            })
    return players


def sync(conn=None):
    """
    Fetch injury data for all 30 teams and upsert into the injuries table.
    Clears players who are no longer injured.
    """
    own_conn = conn is None
    if own_conn:
        init_db()
        conn = get_conn()

    now = datetime.utcnow().isoformat()
    all_injured = []

    for team in ALL_TEAMS:
        log.info(f"  Fetching roster: {team}")
        try:
            players = fetch_team_roster(team)
            if players:
                log.info(f"    {len(players)} injured players")
            all_injured.extend(players)
        except Exception as e:
            log.warning(f"  {team}: error — {e}")

    # Clear existing injury data and replace with fresh pull
    conn.execute("DELETE FROM injuries")

    inserted = 0
    for p in all_injured:
        if not p["player_slug"] and not p["tank01_id"]:
            continue  # can't map — skip
        conn.execute("""
            INSERT INTO injuries
                (player_slug, tank01_id, name, team, designation,
                 description, inj_date, return_date, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(player_slug) DO UPDATE SET
                tank01_id   = excluded.tank01_id,
                name        = excluded.name,
                team        = excluded.team,
                designation = excluded.designation,
                description = excluded.description,
                inj_date    = excluded.inj_date,
                return_date = excluded.return_date,
                updated_at  = excluded.updated_at
        """, (
            p["player_slug"], p["tank01_id"], p["name"], p["team"],
            p["designation"], p["description"],
            p["inj_date"], p["return_date"], now,
        ))
        inserted += 1

    conn.commit()
    log.info(f"Injury sync complete: {inserted} injured players stored")

    if own_conn:
        conn.close()


if __name__ == "__main__":
    if not RAPIDAPI_KEY:
        raise SystemExit("Set RAPIDAPI_KEY environment variable before running.")
    sync()
