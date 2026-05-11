"""CTW-specific database table definitions."""

import sqlite3


def init_ctw_tables(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        -- Win probability curves: CTW% → P(winning category)
        CREATE TABLE IF NOT EXISTS ctw_curves (
            category        TEXT    NOT NULL,
            league_size     INTEGER NOT NULL,
            ctw_pct         INTEGER NOT NULL,
            win_probability REAL    NOT NULL,
            sample_size     INTEGER NOT NULL,
            calculated_at   TEXT    NOT NULL,
            PRIMARY KEY (category, league_size, ctw_pct)
        );

        -- Per-category baselines derived from simulation
        CREATE TABLE IF NOT EXISTS ctw_league_baselines (
            league_size         INTEGER NOT NULL,
            category            TEXT    NOT NULL,
            avg_winning_total   REAL    NOT NULL,
            avg_losing_total    REAL    NOT NULL,
            std_winning_total   REAL    NOT NULL,
            percentile_25       REAL    NOT NULL,
            percentile_50       REAL    NOT NULL,
            percentile_75       REAL    NOT NULL,
            -- Needed for FG%/FT% delta calculation
            avg_team_fgm        REAL,
            avg_team_fga        REAL,
            avg_team_ftm        REAL,
            avg_team_fta        REAL,
            calculated_at       TEXT    NOT NULL,
            PRIMARY KEY (league_size, category)
        );

        -- Per-player CTW scores with scarcity adjustment
        CREATE TABLE IF NOT EXISTS ctw_player_scores (
            player_slug             TEXT    NOT NULL,
            season                  TEXT    NOT NULL,
            league_size             INTEGER NOT NULL,
            period                  TEXT    NOT NULL,

            -- CTW% per category (player's proportional contribution)
            ctw_pct_pts             REAL,
            ctw_pct_reb             REAL,
            ctw_pct_ast             REAL,
            ctw_pct_stl             REAL,
            ctw_pct_blk             REAL,
            ctw_pct_tov             REAL,
            ctw_pct_3pm             REAL,
            ctw_pct_fg              REAL,
            ctw_pct_ft              REAL,

            -- Expected category wins from curve lookup
            expected_wins_pts       REAL,
            expected_wins_reb       REAL,
            expected_wins_ast       REAL,
            expected_wins_stl       REAL,
            expected_wins_blk       REAL,
            expected_wins_tov       REAL,
            expected_wins_3pm       REAL,
            expected_wins_fg        REAL,
            expected_wins_ft        REAL,
            total_expected_wins     REAL,

            -- Scarcity-adjusted expected wins
            scarcity_adj_pts        REAL,
            scarcity_adj_reb        REAL,
            scarcity_adj_ast        REAL,
            scarcity_adj_stl        REAL,
            scarcity_adj_blk        REAL,
            scarcity_adj_tov        REAL,
            scarcity_adj_3pm        REAL,
            scarcity_adj_fg         REAL,
            scarcity_adj_ft         REAL,
            total_scarcity_adj_wins REAL,

            calculated_at           TEXT    NOT NULL,
            PRIMARY KEY (player_slug, season, league_size, period)
        );

    """)
    # Recreate validation log with correct schema (non-critical debug data)
    conn.executescript("""
        DROP TABLE IF EXISTS ctw_validation_log;
        CREATE TABLE ctw_validation_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            season      TEXT,
            check_name  TEXT NOT NULL,
            passed      INTEGER,
            detail      TEXT,
            checked_at  TEXT NOT NULL
        );
    """)
    conn.commit()
