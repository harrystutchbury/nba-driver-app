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


# ── Age curve seeding ───────────────────────────────────────────────────────
# Piecewise linear YoY % change: at age 20 → peak, growth fades to 0;
# post-peak → decline grows linearly to d40 at age 40.
_AGE_CURVE_PARAMS = {
    'PTS':    (27,  +6.0,  -5.5),
    'REB':    (28,  +3.0,  -2.5),
    'AST':    (29,  +7.0,  -2.5),
    'STL':    (25,  +3.0,  -3.0),
    'BLK':    (26,  +4.0,  -3.0),
    'TOV':    (28,  +2.0,  -1.5),
    '3PM':    (27,  +7.0,  -4.0),
    'FG_PCT': (27,  +2.0,  -2.0),
    'FT_PCT': (27,  +0.5,  -0.5),
}


# Optimistic = ages better (peak a year later, more growth, half the decline);
# pessimistic = ages worse (peak a year earlier, less growth, steeper decline).
def _scenario_params(stat: str) -> dict:
    peak, g20, d40 = _AGE_CURVE_PARAMS[stat]
    return {
        "base":        (peak,     g20,       d40),
        "optimistic":  (peak + 1, g20 * 1.3, d40 * 0.5),
        "pessimistic": (peak - 1, g20 * 0.7, d40 * 1.5),
    }


def _smooth_yoy(params, age: int) -> float:
    peak, g20, d40 = params
    if age <= peak:
        return g20 * (peak - age) / (peak - 20)
    return d40 * (age - peak) / (40 - peak)


def _curve_mult(stat: str, age: int, scenario: str) -> float:
    return round(1.0 + _smooth_yoy(_scenario_params(stat)[scenario], age) / 100.0, 6)


def _backfill_scenario_curves(conn) -> None:
    """Populate optimistic/pessimistic multipliers on existing rows (they were
    originally seeded NULL). Idempotent — only touches rows still missing them."""
    rows = conn.execute(
        "SELECT age, stat FROM age_curve_lookup "
        "WHERE optimistic_multiplier IS NULL OR pessimistic_multiplier IS NULL"
    ).fetchall()
    for r in rows:
        stat, age = r["stat"], r["age"]
        if stat not in _AGE_CURVE_PARAMS:
            continue
        conn.execute(
            "UPDATE age_curve_lookup SET optimistic_multiplier=?, pessimistic_multiplier=? "
            "WHERE age=? AND stat=?",
            (_curve_mult(stat, age, "optimistic"), _curve_mult(stat, age, "pessimistic"), age, stat),
        )


def _seed_age_curves(conn) -> None:
    existing = conn.execute("SELECT COUNT(*) FROM age_curve_lookup").fetchone()[0]
    if existing:
        _backfill_scenario_curves(conn)   # fill opt/pess on pre-existing rows
        return
    rows = [
        (age, stat,
         _curve_mult(stat, age, "base"),
         _curve_mult(stat, age, "optimistic"),
         _curve_mult(stat, age, "pessimistic"))
        for stat in _AGE_CURVE_PARAMS
        for age in range(18, 43)
    ]
    conn.executemany(
        "INSERT OR IGNORE INTO age_curve_lookup "
        "(age, stat, base_case_multiplier, optimistic_multiplier, pessimistic_multiplier) "
        "VALUES (?, ?, ?, ?, ?)",
        rows,
    )


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

    # injuries — current injury status for each player
    c.execute("""
        CREATE TABLE IF NOT EXISTS injuries (
            player_slug TEXT PRIMARY KEY,
            tank01_id   TEXT,
            name        TEXT,
            team        TEXT,
            designation TEXT,   -- 'Out', 'Doubtful', 'Questionable', 'Day-To-Day'
            description TEXT,
            inj_date    TEXT,   -- YYYY-MM-DD
            return_date TEXT,   -- YYYY-MM-DD or NULL
            updated_at  TEXT    -- ISO datetime
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS news_cache (
            id         INTEGER PRIMARY KEY CHECK (id = 1),
            payload    TEXT,   -- JSON blob
            fetched_at INTEGER -- Unix timestamp
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            display_name  TEXT,
            created_at    TEXT DEFAULT (datetime('now'))
        )
    """)

    # Migration: add display_name to existing users tables
    try:
        conn.execute("ALTER TABLE users ADD COLUMN display_name TEXT")
    except Exception:
        pass  # column already exists

    # Migration: mark how a players row was sourced. NULL/absent = Basketball
    # Reference season totals (the default refresh); 'tank01' = added from a live
    # roster sync (rookies/signings that have no BR season stats yet).
    try:
        conn.execute("ALTER TABLE players ADD COLUMN roster_source TEXT")
    except Exception:
        pass  # column already exists

    # Migration: add scoring_settings to fantasy_connections
    try:
        conn.execute("ALTER TABLE fantasy_connections ADD COLUMN scoring_settings TEXT")
    except Exception:
        pass  # column already exists

    conn.execute("""
        CREATE TABLE IF NOT EXISTS fantasy_player_map (
            provider      TEXT NOT NULL,   -- 'espn' or 'yahoo'
            provider_id   TEXT NOT NULL,   -- ESPN numeric ID or Yahoo player key
            provider_name TEXT NOT NULL,   -- name as it appears in ESPN/Yahoo
            br_slug       TEXT,            -- Basketball Reference slug (null = unmatched)
            br_name       TEXT,            -- BR full name for human verification
            match_tier    INTEGER,         -- 1=exact, 2=fuzzy-auto, 3=manual
            confidence    REAL,            -- fuzzy score 0-100 (null for exact/manual)
            updated_at    TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (provider, provider_id)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS comments (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            player_slug TEXT NOT NULL,
            username    TEXT NOT NULL,
            body        TEXT NOT NULL,
            created_at  TEXT DEFAULT (datetime('now'))
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS comment_votes (
            comment_id  INTEGER NOT NULL,
            username    TEXT NOT NULL,
            vote        INTEGER NOT NULL,
            PRIMARY KEY (comment_id, username)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS fantasy_connections (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT NOT NULL,
            provider      TEXT NOT NULL DEFAULT 'yahoo',
            access_token  TEXT,
            refresh_token TEXT,
            expires_at    TEXT,
            league_key    TEXT,
            team_key      TEXT,
            updated_at    TEXT DEFAULT (datetime('now')),
            UNIQUE(username, provider)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS oauth_states (
            state      TEXT PRIMARY KEY,
            username   TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            token      TEXT PRIMARY KEY,
            username   TEXT NOT NULL,
            expires_at TEXT NOT NULL
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS blog_posts (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            slug         TEXT UNIQUE NOT NULL,
            title        TEXT NOT NULL,
            content      TEXT NOT NULL DEFAULT '',
            cover_image  TEXT,
            category     TEXT,
            author       TEXT NOT NULL,
            is_published INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT DEFAULT (datetime('now')),
            updated_at   TEXT DEFAULT (datetime('now'))
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS blog_comments (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id    INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
            username   TEXT NOT NULL,
            body       TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS blog_comment_votes (
            comment_id INTEGER NOT NULL,
            username   TEXT NOT NULL,
            vote       INTEGER NOT NULL,
            PRIMARY KEY (comment_id, username)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS blog_post_players (
            post_id     INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
            player_slug TEXT NOT NULL,
            PRIMARY KEY (post_id, player_slug)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS player_adjustments (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            player_slug TEXT NOT NULL,
            min_pg      REAL,
            fga_pg      REAL,
            fg_pct      REAL,     -- 0-100 scale
            fg3a_pg     REAL,
            fg3_pct     REAL,     -- 0-100 scale
            fta_pg      REAL,
            ft_pct      REAL,     -- 0-100 scale
            oreb_rate   REAL,     -- off-reb per 36 min
            dreb_rate   REAL,     -- def-reb per 36 min
            ast_rate    REAL,     -- assists per 36 min
            stl_rate    REAL,     -- steals per 36 min
            blk_rate    REAL,     -- blocks per 36 min
            tov_rate    REAL,     -- turnovers per 36 min
            start_date  TEXT,     -- YYYY-MM-DD, NULL = open start
            end_date    TEXT,     -- YYYY-MM-DD, NULL = open end
            is_active   INTEGER NOT NULL DEFAULT 1,
            notes       TEXT,
            created_at  TEXT DEFAULT (datetime('now')),
            updated_at  TEXT DEFAULT (datetime('now'))
        )
    """)
    # Migrations: add rate columns if upgrading from counting-stat schema
    for _col in ("oreb_rate", "dreb_rate", "ast_rate", "stl_rate", "blk_rate", "tov_rate"):
        try:
            conn.execute(f"ALTER TABLE player_adjustments ADD COLUMN {_col} REAL")
        except Exception:
            pass

    # Migrations
    try:
        conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
    except Exception:
        pass  # already exists

    try:
        conn.execute("ALTER TABLE users ADD COLUMN tier TEXT DEFAULT 'free'")
    except Exception:
        pass  # already exists

    try:
        conn.execute("ALTER TABLE users ADD COLUMN stripe_customer_id TEXT")
    except Exception:
        pass  # already exists

    try:
        conn.execute("ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT")
    except Exception:
        pass  # already exists

    try:
        conn.execute("ALTER TABLE fantasy_player_map ADD COLUMN position TEXT")
    except Exception:
        pass  # already exists

    try:
        conn.execute("ALTER TABLE game_logs ADD COLUMN plus_minus TEXT")
    except Exception:
        pass  # already exists

    # tank01_player_map may be created by ingest_tank01.py before this runs;
    # ensure position column exists whenever the API server starts
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tank01_player_map (
                br_slug     TEXT PRIMARY KEY,
                tank01_id   TEXT NOT NULL,
                tank01_name TEXT,
                position    TEXT
            )
        """)
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE tank01_player_map ADD COLUMN position TEXT")
    except Exception:
        pass  # already exists

    # Moderation: hidden flag on comments
    for _tbl in ("comments", "blog_comments"):
        try:
            conn.execute(f"ALTER TABLE {_tbl} ADD COLUMN is_hidden INTEGER DEFAULT 0")
        except Exception:
            pass  # already exists

    # Box score origin flag on player comments
    try:
        conn.execute("ALTER TABLE comments ADD COLUMN game_date TEXT")
    except Exception:
        pass  # already exists

    # Blocked words for auto-moderation
    conn.execute("""
        CREATE TABLE IF NOT EXISTS blocked_words (
            word TEXT PRIMARY KEY,
            added_at TEXT DEFAULT (datetime('now'))
        )
    """)

    # Forum
    conn.execute("""
        CREATE TABLE IF NOT EXISTS forum_posts (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            title        TEXT NOT NULL,
            body         TEXT NOT NULL,
            username     TEXT NOT NULL,
            display_name TEXT NOT NULL,
            created_at   TEXT DEFAULT (datetime('now')),
            is_hidden    INTEGER NOT NULL DEFAULT 0
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS forum_comments (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id      INTEGER NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
            parent_id    INTEGER REFERENCES forum_comments(id) ON DELETE CASCADE,
            username     TEXT NOT NULL,
            display_name TEXT NOT NULL,
            body         TEXT NOT NULL,
            created_at   TEXT DEFAULT (datetime('now')),
            is_hidden    INTEGER NOT NULL DEFAULT 0
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS forum_post_votes (
            post_id  INTEGER NOT NULL,
            username TEXT NOT NULL,
            vote     INTEGER NOT NULL,
            PRIMARY KEY (post_id, username)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS forum_comment_votes (
            comment_id INTEGER NOT NULL,
            username   TEXT NOT NULL,
            vote       INTEGER NOT NULL,
            PRIMARY KEY (comment_id, username)
        )
    """)

    # One-time cleanup: remove playoff and preseason game rows.
    # Regular season runs Oct 1 – Apr 14.  Both DELETEs are idempotent.
    conn.execute("""
        DELETE FROM game_logs
        WHERE game_date > ('20' || substr(season, 6, 2) || '-04-15')
    """)
    conn.execute("""
        DELETE FROM game_logs
        WHERE game_date < (substr(season, 1, 4) || '-10-01')
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS league_history_seasons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            provider TEXT NOT NULL,
            year INTEGER NOT NULL,
            data TEXT NOT NULL,
            fetched_at TEXT DEFAULT (datetime('now')),
            UNIQUE(username, provider, year)
        )
    """)

    # ── Projection calibration system ──────────────────────────────────────
    conn.execute("""
        CREATE TABLE IF NOT EXISTS projection_inputs (
            player_id          TEXT NOT NULL,
            season             TEXT NOT NULL,
            base_year          TEXT,
            scenario           TEXT NOT NULL DEFAULT 'base_case',
            projected_gp       REAL,
            minutes_per_game   REAL,
            usage_rate         REAL,
            steal_rate         REAL,
            block_rate         REAL,
            ast_rate           REAL,
            oreb_rate          REAL,
            dreb_rate          REAL,
            three_pa_rate      REAL,
            three_p_pct        REAL,
            two_pa_rate        REAL,
            two_p_pct          REAL,
            fta_rate           REAL,
            ft_pct             REAL,
            tov_rate           REAL,
            last_updated       TEXT,
            updated_by         TEXT,
            PRIMARY KEY (player_id, season)
        )
    """)
    # Migrations: add columns to existing tables that predate them
    for _col in ("projected_gp REAL", "oreb_rate REAL", "dreb_rate REAL"):
        try:
            conn.execute(f"ALTER TABLE projection_inputs ADD COLUMN {_col}")
        except Exception:
            pass  # column already exists

    conn.execute("""
        CREATE TABLE IF NOT EXISTS projection_edit_log (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id    TEXT NOT NULL,
            field_edited TEXT NOT NULL,
            old_value    REAL,
            new_value    REAL,
            edited_at    TEXT DEFAULT (datetime('now')),
            edited_by    TEXT,
            source_view  TEXT
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS age_curve_lookup (
            age                    INTEGER NOT NULL,
            stat                   TEXT NOT NULL,
            base_case_multiplier   REAL NOT NULL,
            optimistic_multiplier  REAL,
            pessimistic_multiplier REAL,
            PRIMARY KEY (age, stat)
        )
    """)

    # Seed age curves from piecewise linear params if table is empty
    _seed_age_curves(conn)

    # One-time: TOV was stored usage-normalised (tov/(usage·poss)); convert to a
    # plain per-possession rate (tov/poss) so it no longer depends on usage_rate.
    # Value-preserving: new tov_rate × poss == old tov_rate × usage × poss.
    conn.execute("CREATE TABLE IF NOT EXISTS applied_migrations (name TEXT PRIMARY KEY, applied_at TEXT)")
    if not conn.execute("SELECT 1 FROM applied_migrations WHERE name='tov_rate_decouple_v1'").fetchone():
        conn.execute("UPDATE projection_inputs SET tov_rate = COALESCE(tov_rate, 0) * COALESCE(usage_rate, 0)")
        conn.execute(
            "INSERT INTO applied_migrations (name, applied_at) VALUES ('tov_rate_decouple_v1', datetime('now'))"
        )

    conn.commit()
    conn.close()
    print(f"DB initialised at {DB_PATH}")


if __name__ == "__main__":
    init_db()
