#!/usr/bin/env python3
"""
Route B: upload local NBA.com Hustle per-game rows to prod.

Prod (Render) can't reach NBA.com's hustle endpoint, but the local DB already
has the per-game hustle data. This reads it and POSTs it to the prod
/admin/upload-hustle endpoint in chunks.

Usage (token comes from the clipboard so it's never typed/logged):
    # in the browser console on app.rotointel.com:  copy(localStorage.getItem('nba_token'))
    ADMIN_TOKEN="$(pbpaste)" python3 backend/upload_hustle.py
"""
import json
import os
import sqlite3
import ssl
import sys
import urllib.request

DB    = os.environ.get("NBA_DB_PATH", os.path.join(os.path.dirname(__file__), "data", "nba.db"))
PROD  = os.environ.get("PROD_BASE", "https://app.rotointel.com")
TOKEN = os.environ.get("ADMIN_TOKEN", "").strip()
CHUNK = 2000

if not TOKEN:
    sys.exit("Set ADMIN_TOKEN (copy(localStorage.getItem('nba_token')) then ADMIN_TOKEN=\"$(pbpaste)\").")

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
rows = [dict(r) for r in conn.execute(
    """SELECT player_id, nba_com_player_id, game_date, gp, min,
              contested_shots, contested_shots_2pt, contested_shots_3pt, deflections,
              charges_drawn, loose_balls_recovered, screen_assists
       FROM nbacom_stats_game_log
       WHERE measure_type='Hustle' AND deflections IS NOT NULL""").fetchall()]
conn.close()
print(f"{len(rows)} local hustle rows to upload from {DB}")

total = 0
for i in range(0, len(rows), CHUNK):
    chunk = rows[i:i + CHUNK]
    data = json.dumps({"rows": chunk}).encode()
    req = urllib.request.Request(
        f"{PROD}/api/admin/upload-hustle", data=data, method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, context=ctx, timeout=180) as r:
        resp = json.load(r)
    total += resp.get("upserted", 0)
    print(f"  {i + len(chunk)}/{len(rows)} -> {resp}")

print(f"Done. Uploaded {total} hustle rows.")
