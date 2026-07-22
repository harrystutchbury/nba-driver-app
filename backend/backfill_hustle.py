"""Backfill Hustle measure type for all dates that don't have it yet."""
import sys, sqlite3, time, logging
sys.path.insert(0, '/Users/harry/projects/nba-driver-app/backend')

logging.basicConfig(level=logging.WARNING)

from nbacom.pipeline import (
    get_conn, init_nbacom_tables,
    _load_id_map, _build_name_index, _match_player,
    _insert_game_log_rows, _update_season_averages,
    CURRENT_SEASON,
)
from nbacom.client import fetch_hustle

conn = get_conn()
init_nbacom_tables()

cur = conn.execute('''
    SELECT DISTINCT game_date FROM nbacom_stats_game_log
    WHERE measure_type = 'Hustle' AND contested_shots IS NULL
    ORDER BY game_date
''')
dates = [r[0] for r in cur.fetchall()]

print(f"Backfilling Hustle for {len(dates)} dates ...")
ok = fail = 0

id_map = _load_id_map(conn)
name_index = _build_name_index(conn)

from datetime import datetime
for i, d in enumerate(dates, 1):
    dt = datetime.strptime(d, "%Y-%m-%d").date()
    try:
        api_rows = fetch_hustle(dt, dt)
        enriched = []
        for row in api_rows:
            slug = _match_player(conn, row["nba_com_player_id"], row["player_name"],
                                  row["team_abbreviation"], d, id_map, name_index)
            enriched.append({**row, "player_id": slug})
        _insert_game_log_rows(conn, enriched, "Hustle", d)
        conn.commit()
        ok += 1
        print(f"  [{i}/{len(dates)}] {d} OK  ({len(enriched)} rows)")
    except Exception as e:
        fail += 1
        print(f"  [{i}/{len(dates)}] {d} FAILED: {e}")

print(f"\nDone. OK={ok}  FAILED={fail}")

if ok > 0:
    print("Updating season averages ...")
    _update_season_averages(conn)
    print("Season averages updated.")

conn.close()
