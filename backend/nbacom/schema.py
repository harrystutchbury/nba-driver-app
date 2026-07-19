"""
schema.py — Creates nbacom_* tables in the existing NBA database.

Run standalone to initialise tables:
    cd backend && python -m nbacom.schema
"""

import os
import sys

# Allow running as a script from the backend directory
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from schema import DB_PATH, get_conn  # noqa: E402

# Stat columns shared by nbacom_stats_game_log and nbacom_stats_season_avg.
# NULL in any row whose measure_type doesn't populate that column.
_STAT_COLS_DDL = """
    -- SpeedDistance
    dist_feet             REAL,
    dist_miles            REAL,
    dist_miles_off        REAL,
    dist_miles_def        REAL,
    avg_speed             REAL,
    avg_speed_off         REAL,
    avg_speed_def         REAL,
    -- Rebounding
    oreb_chance           REAL,
    dreb_chance           REAL,
    reb_chance            REAL,
    contested_oreb        REAL,
    contested_dreb        REAL,
    contested_reb         REAL,
    deferred_reb_chance   REAL,
    reb_chance_pct        REAL,
    oreb_chance_pct       REAL,
    dreb_chance_pct       REAL,
    -- Possessions
    touches               REAL,
    front_ct_touches      REAL,
    paint_touches         REAL,
    post_touches          REAL,
    elbow_touches         REAL,
    time_of_poss          REAL,
    avg_sec_per_touch     REAL,
    pts_per_touch         REAL,
    -- CatchShoot
    catch_shoot_fgm       REAL,
    catch_shoot_fga       REAL,
    catch_shoot_fg_pct    REAL,
    catch_shoot_pts       REAL,
    catch_shoot_efg_pct   REAL,
    -- PullUpShot
    pull_up_fgm           REAL,
    pull_up_fga           REAL,
    pull_up_fg_pct        REAL,
    pull_up_pts           REAL,
    pull_up_efg_pct       REAL,
    -- Defense
    contested_shots       REAL,
    contested_shots_2pt   REAL,
    contested_shots_3pt   REAL,
    deflections           REAL,
    charges_drawn         REAL,
    loose_balls_recovered REAL,
    screen_assists        REAL,
    -- Drives
    drives                REAL,
    drive_fgm             REAL,
    drive_fga             REAL,
    drive_fg_pct          REAL,
    drive_pts             REAL,
    drive_ast             REAL,
    drive_tov             REAL,
    drive_pf              REAL,
    -- Passing (pass_ast instead of ast to avoid SQL keyword confusion)
    passes_made           REAL,
    passes_received       REAL,
    potential_ast         REAL,
    pass_ast              REAL,
    secondary_ast         REAL,
    ast_to                REAL,
    ast_ratio             REAL,
    -- ElbowTouch
    elbow_touch_fgm       REAL,
    elbow_touch_fga       REAL,
    elbow_touch_fg_pct    REAL,
    elbow_touch_pts       REAL,
    elbow_touch_ast       REAL,
    elbow_touch_tov       REAL,
    -- PostTouch
    post_touch_fgm        REAL,
    post_touch_fga        REAL,
    post_touch_fg_pct     REAL,
    post_touch_pts        REAL,
    post_touch_ast        REAL,
    post_touch_tov        REAL,
    -- PaintTouch
    paint_touch_fgm       REAL,
    paint_touch_fga       REAL,
    paint_touch_fg_pct    REAL,
    paint_touch_pts       REAL,
    paint_touch_ast       REAL,
    paint_touch_tov       REAL,
    -- Efficiency
    pie                   REAL,
    true_shooting_pct     REAL,
    usg_pct               REAL,
    ast_pct               REAL,
    oreb_pct              REAL,
    dreb_pct              REAL,
    reb_pct               REAL,
    net_rating            REAL,
    off_rating            REAL,
    def_rating            REAL
"""

_CREATE_STATEMENTS = [
    # Maps NBA.com player IDs (which differ from Tank01) to our internal slugs.
    # Populated on first encounter; updated whenever team/name changes.
    """
    CREATE TABLE IF NOT EXISTS nbacom_player_id_mapping (
        our_player_id      TEXT    NOT NULL,
        nba_com_player_id  INTEGER NOT NULL,
        player_name        TEXT,
        team_abbreviation  TEXT,
        last_verified      TEXT,
        PRIMARY KEY (our_player_id),
        UNIQUE (nba_com_player_id)
    )
    """,

    # Players from NBA.com that couldn't be matched to our database.
    # Review manually and either add to the mapping or ignore.
    """
    CREATE TABLE IF NOT EXISTS nbacom_unmatched_players (
        nba_com_player_id  INTEGER NOT NULL,
        player_name        TEXT,
        team_abbreviation  TEXT,
        game_date          TEXT,
        created_at         TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (nba_com_player_id, game_date)
    )
    """,

    # Per-game stats; one row per player per game date per measure_type.
    # Stats for other measure types are NULL in each row.
    f"""
    CREATE TABLE IF NOT EXISTS nbacom_stats_game_log (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id          TEXT,
        nba_com_player_id  INTEGER NOT NULL,
        game_date          TEXT    NOT NULL,
        measure_type       TEXT    NOT NULL,
        gp                 INTEGER,
        min                REAL,
        {_STAT_COLS_DDL},
        created_at         TEXT DEFAULT (datetime('now')),
        UNIQUE (nba_com_player_id, game_date, measure_type)
    )
    """,

    # Rolling averages (full_season / last_30 / last_14) computed from game_log.
    # One row per player × season × period × measure_type.
    f"""
    CREATE TABLE IF NOT EXISTS nbacom_stats_season_avg (
        player_id          TEXT,
        nba_com_player_id  INTEGER NOT NULL,
        season             TEXT    NOT NULL,
        period             TEXT    NOT NULL,
        measure_type       TEXT    NOT NULL,
        gp                 INTEGER,
        min                REAL,
        {_STAT_COLS_DDL},
        updated_at         TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (nba_com_player_id, season, period, measure_type)
    )
    """,

    # Audit log for every pipeline run (nightly or backfill).
    """
    CREATE TABLE IF NOT EXISTS nbacom_pipeline_log (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        run_date         TEXT    NOT NULL,
        measure_type     TEXT,
        rows_pulled      INTEGER,
        success          INTEGER NOT NULL,
        error_message    TEXT,
        duration_seconds REAL,
        created_at       TEXT DEFAULT (datetime('now'))
    )
    """,
]

_CREATE_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_nbacom_game_log_player_date ON nbacom_stats_game_log (player_id, game_date)",
    "CREATE INDEX IF NOT EXISTS idx_nbacom_game_log_measure ON nbacom_stats_game_log (measure_type, game_date)",
    "CREATE INDEX IF NOT EXISTS idx_nbacom_season_avg_player ON nbacom_stats_season_avg (player_id, season, period)",
]


def init_nbacom_tables():
    conn = get_conn()
    for sql in _CREATE_STATEMENTS:
        conn.execute(sql)
    for idx in _CREATE_INDEXES:
        conn.execute(idx)
    conn.commit()
    conn.close()
    print(f"nbacom tables initialised in {DB_PATH}")


if __name__ == "__main__":
    init_nbacom_tables()
