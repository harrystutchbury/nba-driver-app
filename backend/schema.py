"""
schema.py — DB table definitions for Basketball Reference data.
"""

import sqlite3
import os

DB_PATH = os.environ.get(
    "NBA_DB_PATH",
    os.path.join(os.path.dirname(__file__), "data", "nba.db"),
)


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_conn()
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS players (
            slug        TEXT NOT NULL,
            full_name   TEXT NOT NULL,
            team        TEXT,
            season      TEXT NOT NULL,
            PRIMARY KEY (slug, season)
        )
    """)

    # game_logs — one row per player per game
    # dreb_pct and oreb_pct are computed per game during refresh:
    #   dreb_pct = dreb / (opp_fga * (1 - opp_fg%) + 0.44 * opp_fta * (1 - opp_ft%)) * min_share
    #   oreb_pct = oreb / (team_fga * (1 - team_fg%) + 0.44 * team_fta * (1 - team_ft%)) * min_share
    # Computing per game (not from period averages) ensures they are
    # independent of the opportunity drivers in the decomposition formula.
    c.execute("""
        CREATE TABLE IF NOT EXISTS game_logs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            player_slug TEXT NOT NULL,
            game_date   TEXT NOT NULL,
            season      TEXT NOT NULL,
            team        TEXT NOT NULL,
            opponent    TEXT,
            home_away   TEXT,
            min         REAL,
            pts         REAL,
            reb         REAL,
            oreb        REAL,
            dreb        REAL,
            ast         REAL,
            stl         REAL,
            blk         REAL,
            tov         REAL,
            fgm         REAL,
            fga         REAL,
            fg3m        REAL,
            fg3a        REAL,
            ftm         REAL,
            fta         REAL,
            dreb_pct    REAL,   -- def rebound rate: computed per game
            oreb_pct    REAL,   -- off rebound rate: computed per game
            UNIQUE(player_slug, game_date, team)
        )
    """)

    # team_games — one row per team per game
    # Stores full box score so we can compute pace and rebound opportunities
    c.execute("""
        CREATE TABLE IF NOT EXISTS team_games (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            team            TEXT NOT NULL,
            game_date       TEXT NOT NULL,
            season          TEXT NOT NULL,

            -- team shooting
            team_fga        REAL,
            team_fgm        REAL,
            team_fg_pct     REAL,
            team_fta        REAL,
            team_ftm        REAL,
            team_ft_pct     REAL,
            team_oreb       REAL,
            team_dreb       REAL,
            team_tov        REAL,

            -- opponent shooting (enriched via self-join)
            opp_fga         REAL,
            opp_fgm         REAL,
            opp_fg_pct      REAL,
            opp_fta         REAL,
            opp_ftm         REAL,
            opp_ft_pct      REAL,
            opp_oreb        REAL,
            opp_dreb        REAL,
            opp_tov         REAL,

            minutes         REAL,
            pace            REAL,   -- computed after enrichment

            UNIQUE(team, game_date)
        )
    """)

    # player_id_map — maps Basketball Reference slugs to NBA API IDs
    c.execute("""
        CREATE TABLE IF NOT EXISTS player_id_map (
            br_slug     TEXT PRIMARY KEY,
            nba_id      INTEGER NOT NULL,
            br_name     TEXT,
            nba_name    TEXT,
            match_tier  INTEGER  -- 1=exact, 2=fuzzy, 3=manual
        )
    """)

    # shot_logs — one row per field goal attempt, from NBA API shotchartdetail
    c.execute("""
        CREATE TABLE IF NOT EXISTS shot_logs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            nba_id      INTEGER NOT NULL,
            player_slug TEXT,
            game_id     TEXT NOT NULL,
            game_date   TEXT NOT NULL,
            season      TEXT NOT NULL,
            zone        TEXT NOT NULL,  -- canonical zone (see ZONE_MAP)
            made        INTEGER NOT NULL,
            distance    REAL,
            loc_x       REAL,
            loc_y       REAL,
            UNIQUE(nba_id, game_id, loc_x, loc_y)
        )
    """)

    # nba_schedule — upcoming games fetched during daily refresh
    c.execute("""
        CREATE TABLE IF NOT EXISTS nba_schedule (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            game_date   TEXT NOT NULL,
            home_team   TEXT NOT NULL,
            away_team   TEXT NOT NULL,
            season      INTEGER NOT NULL,
            UNIQUE(game_date, home_team, away_team)
        )
    """)

    conn.commit()
    conn.close()
    print(f"DB initialised at {DB_PATH}")


if __name__ == "__main__":
    init_db()
