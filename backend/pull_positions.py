"""
pull_positions.py — Add position to player_bio.

Step 1: PlayerIndex (single API call) — covers all current/recent players.
Step 2: commonplayerinfo (one call per player) — covers retired players missed by Step 1.

Positions normalised to G / F / C (primary group).

Run from the backend folder:
    python pull_positions.py
"""

import logging
import time
import sys
import os

from nba_api.stats.endpoints import playerindex, commonplayerinfo
from nba_api.stats.library.http import NBAStatsHTTP

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schema import get_conn

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

# PlayerIndex uses abbreviations; commonplayerinfo uses full words
# Both collapsed to G / F / C
POSITION_GROUP = {
    # Abbreviated (PlayerIndex)
    'G':   'G', 'G-F': 'G',
    'F':   'F', 'F-G': 'F', 'F-C': 'F',
    'C':   'C', 'C-F': 'C',
    # Full words (commonplayerinfo)
    'Guard':          'G', 'Guard-Forward':  'G',
    'Forward':        'F', 'Forward-Guard':  'F', 'Forward-Center': 'F',
    'Center':         'C', 'Center-Forward': 'C',
}


def add_columns(conn):
    for col, typedef in [
        ('position',       'TEXT'),
        ('position_group', 'TEXT'),
        ('height',         'TEXT'),
        ('draft_year',     'INTEGER'),
    ]:
        try:
            conn.execute(f"ALTER TABLE player_bio ADD COLUMN {col} {typedef}")
            conn.commit()
        except Exception:
            pass  # already exists


def update_position(conn, nba_id, position, height=None, draft_year=None):
    pos_group = POSITION_GROUP.get(position, None)
    try:
        draft_year = int(draft_year) if draft_year and str(draft_year) not in ('nan', 'None', '') else None
    except Exception:
        draft_year = None
    conn.execute("""
        UPDATE player_bio
        SET position       = ?,
            position_group = ?,
            height         = COALESCE(?, height),
            draft_year     = COALESCE(?, draft_year)
        WHERE nba_id = ?
    """, (position or None, pos_group, height or None, draft_year, nba_id))


if __name__ == '__main__':
    conn = get_conn()
    add_columns(conn)

    # ------------------------------------------------------------------
    # Step 1: PlayerIndex — one call, covers current/recent players
    # ------------------------------------------------------------------
    log.info("Step 1: Fetching PlayerIndex...")
    df     = playerindex.PlayerIndex().get_data_frames()[0]
    index  = {int(row['PERSON_ID']): row for _, row in df.iterrows()}
    log.info(f"  {len(index)} players in PlayerIndex.")

    bio_rows = conn.execute("SELECT nba_id FROM player_bio").fetchall()
    step1_updated = 0
    for r in bio_rows:
        nba_id = int(r['nba_id'])
        if nba_id not in index:
            continue
        row = index[nba_id]
        update_position(
            conn, nba_id,
            position   = str(row.get('POSITION', '') or '').strip(),
            height     = str(row.get('HEIGHT',   '') or '').strip(),
            draft_year = row.get('DRAFT_YEAR', None),
        )
        step1_updated += 1
    conn.commit()
    log.info(f"  Updated {step1_updated} players from PlayerIndex.")

    # ------------------------------------------------------------------
    # Step 2: commonplayerinfo — for retired players not in PlayerIndex
    # ------------------------------------------------------------------
    missing = conn.execute("""
        SELECT nba_id, br_slug FROM player_bio
        WHERE position_group IS NULL
        ORDER BY br_slug
    """).fetchall()
    log.info(f"Step 2: {len(missing)} players still need position — fetching individually...")

    step2_updated = errors = 0
    for i, r in enumerate(missing, 1):
        nba_id  = int(r['nba_id'])
        br_slug = r['br_slug']
        retries = 0
        while True:
            try:
                info = commonplayerinfo.CommonPlayerInfo(player_id=nba_id)
                row  = info.get_data_frames()[0]
                if row.empty:
                    log.warning(f"[{i}/{len(missing)}] {br_slug}: no data")
                    break
                row = row.iloc[0]
                update_position(
                    conn, nba_id,
                    position   = str(row.get('POSITION', '') or '').strip(),
                    height     = str(row.get('HEIGHT',   '') or '').strip(),
                    draft_year = row.get('DRAFT_YEAR', None),
                )
                conn.commit()
                log.info(f"[{i}/{len(missing)}] {br_slug}: {row.get('POSITION', '?')}")
                step2_updated += 1
                break
            except Exception as e:
                retries += 1
                if retries >= 3:
                    log.error(f"[{i}/{len(missing)}] {br_slug}: failed — {e}")
                    errors += 1
                    break
                log.warning(f"  Rate limited, waiting {RETRY_WAIT}s...")
                time.sleep(RETRY_WAIT)
        time.sleep(REQUEST_DELAY)

    conn.close()
    log.info(f"Done. step1={step1_updated}  step2={step2_updated}  errors={errors}")

    # Summary
    conn = get_conn()
    print("\nPosition breakdown:")
    for r in conn.execute("""
        SELECT position_group, COUNT(*) as n FROM player_bio
        WHERE position_group IS NOT NULL
        GROUP BY position_group ORDER BY n DESC
    """).fetchall():
        print(f"  {r['position_group']}: {r['n']}")
    null_n = conn.execute("SELECT COUNT(*) FROM player_bio WHERE position_group IS NULL").fetchone()[0]
    print(f"  (no position): {null_n}")
    conn.close()
