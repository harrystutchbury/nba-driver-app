"""
upload_schedule.py — fetch upcoming NBA schedule from Tank01 and push to Render.
Run from backend/ directory after activating your venv.

Usage:
    export RAPIDAPI_KEY=your_key_here
    python upload_schedule.py
"""

import json
import logging
import os
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import date, timedelta

RAPIDAPI_KEY  = os.environ.get("RAPIDAPI_KEY", "")
RAPIDAPI_HOST = "tank01-fantasy-stats.p.rapidapi.com"
UPLOAD_URL    = "https://nba-driver-app.onrender.com/api/admin/upload-schedule"
SEASON_END_YEAR = 2026
SEASON_END_DATE = date(2026, 6, 30)

log = logging.getLogger(__name__)

TEAM_ABBREV = {
    "ATL": "ATLANTA HAWKS",
    "BOS": "BOSTON CELTICS",
    "BKN": "BROOKLYN NETS",
    "CHA": "CHARLOTTE HORNETS",
    "CHI": "CHICAGO BULLS",
    "CLE": "CLEVELAND CAVALIERS",
    "DAL": "DALLAS MAVERICKS",
    "DEN": "DENVER NUGGETS",
    "DET": "DETROIT PISTONS",
    "GS":  "GOLDEN STATE WARRIORS",
    "GSW": "GOLDEN STATE WARRIORS",
    "HOU": "HOUSTON ROCKETS",
    "IND": "INDIANA PACERS",
    "LAC": "LOS ANGELES CLIPPERS",
    "LAL": "LOS ANGELES LAKERS",
    "MEM": "MEMPHIS GRIZZLIES",
    "MIA": "MIAMI HEAT",
    "MIL": "MILWAUKEE BUCKS",
    "MIN": "MINNESOTA TIMBERWOLVES",
    "NO":  "NEW ORLEANS PELICANS",
    "NOP": "NEW ORLEANS PELICANS",
    "NY":  "NEW YORK KNICKS",
    "NYK": "NEW YORK KNICKS",
    "OKC": "OKLAHOMA CITY THUNDER",
    "ORL": "ORLANDO MAGIC",
    "PHI": "PHILADELPHIA 76ERS",
    "PHO": "PHOENIX SUNS",
    "POR": "PORTLAND TRAIL BLAZERS",
    "SA":  "SAN ANTONIO SPURS",
    "SAS": "SAN ANTONIO SPURS",
    "SAC": "SACRAMENTO KINGS",
    "TOR": "TORONTO RAPTORS",
    "UTA": "UTAH JAZZ",
    "WAS": "WASHINGTON WIZARDS",
}


def fetch_games_for_date(game_date: date) -> list:
    date_str = game_date.strftime("%Y%m%d")
    params = urllib.parse.urlencode({"gameDate": date_str})
    url = f"https://{RAPIDAPI_HOST}/getNBAGamesForDate?{params}"
    req = urllib.request.Request(url, headers={
        "X-RapidAPI-Key":  RAPIDAPI_KEY,
        "X-RapidAPI-Host": RAPIDAPI_HOST,
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read()).get("body", [])


def run():
    if not RAPIDAPI_KEY:
        raise RuntimeError("RAPIDAPI_KEY env var not set")

    today = date.today()
    rows  = []
    d     = today

    log.info(f"Fetching schedule from {today} to {SEASON_END_DATE}...")

    while d <= SEASON_END_DATE:
        try:
            games = fetch_games_for_date(d)
            for g in games:
                home = TEAM_ABBREV.get(g.get("home", "").upper())
                away = TEAM_ABBREV.get(g.get("away", "").upper())
                if home and away:
                    rows.append({
                        "game_date": d.isoformat(),
                        "home_team": home,
                        "away_team": away,
                        "season":    SEASON_END_YEAR,
                    })
            if games:
                log.info(f"  {d}: {len(games)} games")
        except Exception as e:
            log.warning(f"  {d}: error — {e}")

        d += timedelta(days=1)
        time.sleep(0.5)

    log.info(f"Found {len(rows)} upcoming games. Uploading to Render...")

    payload = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(
        UPLOAD_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode("utf-8")
            log.info(f"Response ({resp.status}): {body}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        log.error(f"Error ({e.code}): {body}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not RAPIDAPI_KEY:
        raise SystemExit("Set RAPIDAPI_KEY environment variable before running.")
    run()
