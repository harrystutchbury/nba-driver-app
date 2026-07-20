"""
Dump nbacom_* tables from local DB to a SQL file for import on Render.
Run from the backend/ directory:
    python dump_nbacom.py
"""
import sqlite3

src = sqlite3.connect("data/nba.db")
tables = [
    "nbacom_player_id_mapping",
    "nbacom_unmatched_players",
    "nbacom_stats_game_log",
    "nbacom_stats_season_avg",
    "nbacom_pipeline_log",
]

with open("nbacom_dump.sql", "w") as f:
    for line in src.iterdump():
        if any(t in line for t in tables):
            f.write(line + "\n")

src.close()
print("Done — nbacom_dump.sql written")
