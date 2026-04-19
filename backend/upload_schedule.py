"""
upload_schedule.py — fetch upcoming NBA schedule locally and push to Render.
Run from backend/ directory after activating your venv.
"""

import json
import urllib.request
from datetime import date

from basketball_reference_web_scraper import client

UPLOAD_URL = "https://nba-driver-app.onrender.com/api/admin/upload-schedule"
SEASON_END_YEAR = 2026

today = date.today()
print(f"Fetching schedule for season ending {SEASON_END_YEAR}...")
games = client.season_schedule(season_end_year=SEASON_END_YEAR)

rows = []
for g in games:
    game_date = g["start_time"].date()
    if game_date >= today:
        rows.append({
            "game_date": game_date.isoformat(),
            "home_team": g["home_team"].value,
            "away_team": g["away_team"].value,
            "season": SEASON_END_YEAR,
        })

print(f"Found {len(rows)} upcoming games. Uploading...")

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
        print(f"Response ({resp.status}): {body}")
except urllib.error.HTTPError as e:
    body = e.read().decode("utf-8")
    print(f"Error ({e.code}): {body}")
