"""
Fetch missing 2024-25 shot data locally and upload to prod.

Usage:
    cd backend
    python upload_missing_shots.py --token YOUR_TOKEN --url https://your-render-url.com

Get your token from the browser console:
    localStorage.getItem('nba_token')
"""

import argparse
import time
import requests
import sys

# Must be run from the backend directory
import refresh_shots as rs

PROD_URL_DEFAULT = "https://nba-driver-app.onrender.com"


def get_missing_players(prod_url, token):
    resp = requests.get(
        f"{prod_url}/api/admin/shots-status",
        headers={"Authorization": f"Bearer {token}"},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json().get("missing_2024_25_shots", [])


def fetch_and_upload(player, prod_url, token):
    slug   = player["slug"]
    nba_id = player["nba_id"]
    print(f"\n[{slug}] nba_id={nba_id} — fetching 2024-25 shots from NBA API...")

    df = rs.fetch_shots(nba_id, 2025)
    if df is None or df.empty:
        print(f"  → NBA API returned empty/None, skipping")
        return 0

    shots = []
    for _, shot in df.iterrows():
        zone = rs.ZONE_MAP.get(shot.get("SHOT_ZONE_BASIC", ""))
        if zone is None:
            continue
        game_date = str(shot.get("GAME_DATE", ""))
        if len(game_date) == 8 and game_date.isdigit():
            game_date = f"{game_date[:4]}-{game_date[4:6]}-{game_date[6:]}"
        shots.append({
            "nba_id":      nba_id,
            "player_slug": slug,
            "game_id":     str(shot.get("GAME_ID", "")),
            "game_date":   game_date,
            "season":      "2024-25",
            "zone":        zone,
            "made":        int(shot.get("SHOT_MADE_FLAG", 0)),
            "distance":    float(shot.get("SHOT_DISTANCE", 0) or 0),
            "loc_x":       float(shot.get("LOC_X", 0) or 0),
            "loc_y":       float(shot.get("LOC_Y", 0) or 0),
        })

    if not shots:
        print(f"  → 0 valid zone shots after filtering, skipping")
        return 0

    print(f"  → {len(shots)} shots fetched, uploading to prod...")
    resp = requests.post(
        f"{prod_url}/api/admin/import-shots",
        json={"shots": shots},
        headers={"Authorization": f"Bearer {token}"},
        timeout=60,
    )
    resp.raise_for_status()
    result = resp.json()
    print(f"  → uploaded. total_shots now: {result.get('total_shots')}")
    return len(shots)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--token", required=True, help="Admin JWT from localStorage.getItem('nba_token')")
    parser.add_argument("--url", default=PROD_URL_DEFAULT, help="Prod base URL")
    args = parser.parse_args()

    print(f"Fetching missing players from {args.url}...")
    missing = get_missing_players(args.url, args.token)
    print(f"Found {len(missing)} players with 2024-25 game logs but no shot data:")
    for p in missing:
        print(f"  {p['slug']} (nba_id={p['nba_id']})")

    if not missing:
        print("Nothing to do.")
        return

    total_uploaded = 0
    for i, player in enumerate(missing):
        total_uploaded += fetch_and_upload(player, args.url, args.token)
        if i < len(missing) - 1:
            time.sleep(rs.REQUEST_DELAY)

    print(f"\nDone. {total_uploaded} shots uploaded across {len(missing)} players.")


if __name__ == "__main__":
    main()
