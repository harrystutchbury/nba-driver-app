"""
refresh_shots.py — Pull shot-level data from the NBA API (shotchartdetail)
and upsert into shot_logs.

Must run map_players.py first to populate player_id_map.

Run from the backend folder:
    python refresh_shots.py
    python refresh_shots.py --season 2025 --season 2026
"""

import argparse
import logging
import time

from nba_api.stats.endpoints import shotchartdetail
from nba_api.stats.library.http import NBAStatsHTTP

from schema import get_conn, init_db

REQUEST_DELAY   = 6.0
RETRY_WAIT      = 90
DEFAULT_SEASONS = [2024, 2025, 2026]

# Spoof a real browser — stats.nba.com blocks non-browser user agents
NBAStatsHTTP.headers = {
    "Host":                      "stats.nba.com",
    "User-Agent":                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept":                    "application/json, text/plain, */*",
    "Accept-Language":           "en-AU,en;q=0.9",
    "Accept-Encoding":           "gzip, deflate, br",
    "x-nba-stats-origin":        "stats",
    "x-nba-stats-token":         "true",
    "Referer":                   "https://www.nba.com/",
    "Origin":                    "https://www.nba.com",
    "Connection":                "keep-alive",
    "Sec-Fetch-Dest":            "empty",
    "Sec-Fetch-Mode":            "cors",
    "Sec-Fetch-Site":            "same-site",
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# -----------------------------------------------------------------------
# Zone mapping — collapse NBA API zones to 5 canonical zones
# -----------------------------------------------------------------------

ZONE_MAP = {
    "Restricted Area":          "restricted_area",
    "In The Paint (Non-RA)":    "paint_non_ra",
    "Mid-Range":                "mid_range",
    "Left Corner 3":            "corner_3",
    "Right Corner 3":           "corner_3",
    "Above the Break 3":        "above_break_3",
    "Backcourt":                None,   # excluded — effectively never counts
}


def season_str(season_end_year):
    return f"{season_end_year - 1}-{str(season_end_year)[2:]}"


# -----------------------------------------------------------------------
# Pull shots for one player/season
# -----------------------------------------------------------------------

def fetch_shots(nba_id, season_end_year):
    for attempt in range(5):
        time.sleep(REQUEST_DELAY + attempt * 2)  # back off a little each retry
        try:
            endpoint = shotchartdetail.ShotChartDetail(
                player_id=nba_id,
                team_id=0,
                season_nullable=season_str(season_end_year),
                season_type_all_star="Regular Season",
                context_measure_simple="FGA",
                timeout=60,
            )
            return endpoint.get_data_frames()[0]
        except Exception as e:
            msg = str(e)
            if "429" in msg:
                wait = RETRY_WAIT * (attempt + 1)
                log.warning(f"  429 nba_id={nba_id}, waiting {wait}s (attempt {attempt + 1}/5)...")
                time.sleep(wait)
            elif "connection" in msg.lower() or "timeout" in msg.lower():
                wait = 30 * (attempt + 1)
                log.warning(f"  Connection error nba_id={nba_id}, waiting {wait}s...")
                time.sleep(wait)
            else:
                log.warning(f"  nba_id={nba_id} failed: {e}")
                return None
    log.error(f"  nba_id={nba_id} exhausted retries, skipping.")
    return None


# -----------------------------------------------------------------------
# Refresh shots for a season
# -----------------------------------------------------------------------

def refresh_season(conn, season_end_year):
    label = season_str(season_end_year)
    log.info(f"[{label}] Starting shot log refresh...")

    # Players with a mapping
    mapped = conn.execute("""
        SELECT m.br_slug, m.nba_id, m.nba_name
        FROM player_id_map m
        INNER JOIN players p ON p.slug = m.br_slug AND p.season = ?
    """, (label,)).fetchall()

    if not mapped:
        log.warning(f"[{label}] No mapped players found. Run map_players.py first.")
        return

    log.info(f"[{label}] {len(mapped)} mapped players to process.")

    # Find players whose shots are already fully loaded for this season
    existing = set(
        r[0] for r in conn.execute(
            "SELECT DISTINCT nba_id FROM shot_logs WHERE season = ?", (label,)
        )
    )

    # Latest game date in game_logs for this season (used to detect stale data)
    latest_game = (conn.execute(
        "SELECT MAX(game_date) FROM game_logs WHERE season = ?", (label,)
    ).fetchone()[0] or "")

    latest_shot = {
        r[0]: r[1] for r in conn.execute(
            "SELECT nba_id, MAX(game_date) FROM shot_logs WHERE season = ? GROUP BY nba_id",
            (label,),
        )
    }

    pulled = skipped = 0

    for i, row in enumerate(mapped):
        slug, nba_id, name = row["br_slug"], row["nba_id"], row["nba_name"]

        if i % 50 == 0:
            log.info(f"  {i}/{len(mapped)} players processed...")

        # Skip if already up to date
        if latest_shot.get(nba_id, "") >= latest_game and latest_game:
            skipped += 1
            continue

        df = fetch_shots(nba_id, season_end_year)
        if df is None or df.empty:
            continue

        rows = []
        for _, shot in df.iterrows():
            zone_raw = shot.get("SHOT_ZONE_BASIC", "")
            zone     = ZONE_MAP.get(zone_raw)
            if zone is None:
                continue  # skip backcourt etc.

            game_date = str(shot.get("GAME_DATE", ""))
            # NBA API returns YYYYMMDD — convert to YYYY-MM-DD
            if len(game_date) == 8 and game_date.isdigit():
                game_date = f"{game_date[:4]}-{game_date[4:6]}-{game_date[6:]}"

            rows.append((
                nba_id,
                slug,
                str(shot.get("GAME_ID", "")),
                game_date,
                label,
                zone,
                int(shot.get("SHOT_MADE_FLAG", 0)),
                float(shot.get("SHOT_DISTANCE", 0) or 0),
                float(shot.get("LOC_X", 0) or 0),
                float(shot.get("LOC_Y", 0) or 0),
            ))

        if rows:
            conn.executemany("""
                INSERT INTO shot_logs
                    (nba_id, player_slug, game_id, game_date, season,
                     zone, made, distance, loc_x, loc_y)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(nba_id, game_id, loc_x, loc_y) DO UPDATE SET
                    made     = excluded.made,
                    zone     = excluded.zone,
                    distance = excluded.distance
            """, rows)
            conn.commit()
            pulled += len(rows)

    log.info(f"[{label}] Done. {pulled} shots pulled, {skipped} players already current.")


# -----------------------------------------------------------------------
# Entrypoint
# -----------------------------------------------------------------------

def run(seasons):
    init_db()
    conn = get_conn()
    for season_end_year in seasons:
        refresh_season(conn, season_end_year)
    conn.close()
    log.info("All done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", action="append", dest="seasons", type=int)
    args    = parser.parse_args()
    seasons = args.seasons or DEFAULT_SEASONS
    run(seasons)
