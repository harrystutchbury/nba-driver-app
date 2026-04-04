"""
pull_birthdates.py — Pull birth dates from NBA API and store in player_bio table.

Fetches commonplayerinfo for each player in player_id_map.
Skips players already in player_bio to allow resuming if interrupted.

Run from the backend folder:
    python pull_birthdates.py
"""

import time
import logging
from datetime import datetime

from nba_api.stats.endpoints import commonplayerinfo
from nba_api.stats.library.http import NBAStatsHTTP

from schema import get_conn, init_db

REQUEST_DELAY = 6.0
RETRY_WAIT    = 90

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

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


def init_player_bio(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS player_bio (
            nba_id     INTEGER PRIMARY KEY,
            br_slug    TEXT,
            birthdate  TEXT   -- YYYY-MM-DD
        )
    """)
    conn.commit()


def fetch_birthdate(nba_id):
    """Return birthdate string YYYY-MM-DD or None."""
    info = commonplayerinfo.CommonPlayerInfo(player_id=nba_id)
    rows = info.get_data_frames()[0]
    if rows.empty:
        return None
    raw = rows.iloc[0].get('BIRTHDATE', None)
    if not raw:
        return None
    # NBA API returns ISO format like '1994-03-14T00:00:00'
    try:
        return datetime.fromisoformat(str(raw)).strftime('%Y-%m-%d')
    except Exception:
        return str(raw)[:10]


if __name__ == '__main__':
    init_db()
    conn = get_conn()
    init_player_bio(conn)

    # All mapped players
    all_players = conn.execute(
        "SELECT nba_id, br_slug FROM player_id_map ORDER BY br_slug"
    ).fetchall()

    # Skip already fetched
    done = {
        r['nba_id']
        for r in conn.execute("SELECT nba_id FROM player_bio").fetchall()
    }

    todo = [r for r in all_players if r['nba_id'] not in done]
    log.info(f"{len(all_players)} mapped players, {len(done)} already fetched, {len(todo)} to pull.")

    fetched = skipped = errors = 0

    for i, player in enumerate(todo, 1):
        nba_id  = player['nba_id']
        br_slug = player['br_slug']

        retries = 0
        while True:
            try:
                birthdate = fetch_birthdate(nba_id)
                conn.execute("""
                    INSERT INTO player_bio (nba_id, br_slug, birthdate)
                    VALUES (?, ?, ?)
                    ON CONFLICT(nba_id) DO UPDATE SET
                        br_slug   = excluded.br_slug,
                        birthdate = excluded.birthdate
                """, (nba_id, br_slug, birthdate))
                conn.commit()

                if birthdate:
                    log.info(f"[{i}/{len(todo)}] {br_slug} ({nba_id}): {birthdate}")
                    fetched += 1
                else:
                    log.warning(f"[{i}/{len(todo)}] {br_slug} ({nba_id}): no birthdate found")
                    skipped += 1
                break

            except Exception as e:
                retries += 1
                if retries >= 3:
                    log.error(f"[{i}/{len(todo)}] {br_slug} ({nba_id}): failed after 3 retries — {e}")
                    errors += 1
                    break
                log.warning(f"  Rate limited, waiting {RETRY_WAIT}s... ({e})")
                time.sleep(RETRY_WAIT)

        time.sleep(REQUEST_DELAY)

    conn.close()
    log.info(f"Done. fetched={fetched}  no_date={skipped}  errors={errors}")
