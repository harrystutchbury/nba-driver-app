"""
ingest_tank01.py — Pull NBA game logs from Tank01 API and upsert into the local DB.

Replaces basketball-reference scraping for current-season game log ingestion.

Usage:
    export RAPIDAPI_KEY=your_key_here
    python ingest_tank01.py                  # current season, all tracked players
    python ingest_tank01.py --season 2026    # explicit season end-year
    python ingest_tank01.py --days 7         # only games from last N days
    python ingest_tank01.py --build-map      # rebuild tank01_id → br_slug mapping only

Steps:
    1. Build/update player ID map (longName → br_slug → tank01_id)
    2. For each mapped player, fetch game logs from Tank01
    3. Transform fields to match existing game_logs schema
    4. Upsert — safe to re-run; duplicates are ignored
"""

import argparse
import os
import time
import unicodedata
import urllib.request
import urllib.parse
import json
import logging
from datetime import date, timedelta

from schema import get_conn, init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

RAPIDAPI_KEY  = os.environ.get("RAPIDAPI_KEY", "")
RAPIDAPI_HOST = "tank01-fantasy-stats.p.rapidapi.com"
REQUEST_DELAY = 1.2   # seconds between API calls (free tier: ~1 req/sec)

# Tank01 abbreviation → DB full team name
# Tank01 uses non-standard abbrevs for a few teams (SA, NO, NY, GS, Utah as UTA)
TEAM_ABBREV = {
    "ATL": "ATLANTA HAWKS",
    "BOS": "BOSTON CELTICS",
    "BKN": "BROOKLYN NETS",
    "CHA": "CHARLOTTE HORNETS",
    "CHI": "CHICAGO BULLS",
    "CLE": "CLEVELAND CAVALIERS",
    "DAL": "DALLAS MAVERICKS",
    "DEN": "DENVER NUGGETS",
    "DET": "DETROIT PISTONS",
    "GS":  "GOLDEN STATE WARRIORS",
    "GSW": "GOLDEN STATE WARRIORS",
    "HOU": "HOUSTON ROCKETS",
    "IND": "INDIANA PACERS",
    "LAC": "LOS ANGELES CLIPPERS",
    "LAL": "LOS ANGELES LAKERS",
    "MEM": "MEMPHIS GRIZZLIES",
    "MIA": "MIAMI HEAT",
    "MIL": "MILWAUKEE BUCKS",
    "MIN": "MINNESOTA TIMBERWOLVES",
    "NO":  "NEW ORLEANS PELICANS",
    "NOP": "NEW ORLEANS PELICANS",
    "NY":  "NEW YORK KNICKS",
    "NYK": "NEW YORK KNICKS",
    "OKC": "OKLAHOMA CITY THUNDER",
    "ORL": "ORLANDO MAGIC",
    "PHI": "PHILADELPHIA 76ERS",
    "PHO": "PHOENIX SUNS",
    "POR": "PORTLAND TRAIL BLAZERS",
    "SA":  "SAN ANTONIO SPURS",
    "SAS": "SAN ANTONIO SPURS",
    "SAC": "SACRAMENTO KINGS",
    "TOR": "TORONTO RAPTORS",
    "UTA": "UTAH JAZZ",
    "WAS": "WASHINGTON WIZARDS",
}


def season_label(season_end_year: int) -> str:
    return f"{season_end_year - 1}-{str(season_end_year)[2:]}"


def season_from_date(game_date: date) -> str:
    """NBA season runs Oct–Jun. Games after Sep belong to the next end-year."""
    end_year = game_date.year + 1 if game_date.month >= 10 else game_date.year
    return season_label(end_year)


def normalize_name(name: str) -> str:
    """Lowercase, strip accents, strip punctuation for fuzzy matching."""
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_name = "".join(c for c in nfkd if not unicodedata.combining(c))
    return ascii_name.lower().strip()


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def _get(endpoint: str, params: dict) -> dict:
    if not RAPIDAPI_KEY:
        raise RuntimeError("RAPIDAPI_KEY env var not set")
    qs  = urllib.parse.urlencode(params)
    url = f"https://{RAPIDAPI_HOST}/{endpoint}?{qs}"
    req = urllib.request.Request(url, headers={
        "X-RapidAPI-Key":  RAPIDAPI_KEY,
        "X-RapidAPI-Host": RAPIDAPI_HOST,
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_player_list() -> list[dict]:
    """Return list of all NBA players from Tank01."""
    data = _get("getNBAPlayerList", {})
    # Response: {"statusCode": 200, "body": [...]}
    return data.get("body", [])


def fetch_player_games(tank01_id: str, season_end_year: int) -> dict:
    """Return game log dict keyed by gameID for a single player + season."""
    # Tank01 season format appears to be the end year, e.g. "2026"
    data = _get("getNBAGamesForPlayer", {
        "playerID": tank01_id,
        "season":   str(season_end_year),
    })
    time.sleep(REQUEST_DELAY)
    return data.get("body", {})


# ---------------------------------------------------------------------------
# Player ID mapping
# ---------------------------------------------------------------------------

def ensure_tank01_map_table(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tank01_player_map (
            br_slug     TEXT PRIMARY KEY,
            tank01_id   TEXT NOT NULL,
            tank01_name TEXT
        )
    """)
    conn.commit()


def build_player_map(conn):
    """
    Fetch Tank01 player list and match to existing players by name.
    Stores mappings in tank01_player_map table.
    """
    ensure_tank01_map_table(conn)

    log.info("Fetching Tank01 player list…")
    tank01_players = fetch_player_list()
    time.sleep(REQUEST_DELAY)

    # Build name → tank01_id lookup (normalised)
    t01_by_name = {}
    for p in tank01_players:
        name = p.get("longName") or p.get("espnName") or ""
        pid  = p.get("playerID", "")
        if name and pid:
            t01_by_name[normalize_name(name)] = (pid, name)

    # Load all players from our DB
    db_players = conn.execute(
        "SELECT slug, full_name FROM players"
    ).fetchall()

    matched = 0
    skipped = 0
    for row in db_players:
        slug, full_name = row["slug"], row["full_name"]
        key = normalize_name(full_name)
        if key in t01_by_name:
            t01_id, t01_name = t01_by_name[key]
            conn.execute("""
                INSERT INTO tank01_player_map (br_slug, tank01_id, tank01_name)
                VALUES (?, ?, ?)
                ON CONFLICT(br_slug) DO UPDATE SET
                    tank01_id=excluded.tank01_id,
                    tank01_name=excluded.tank01_name
            """, (slug, t01_id, t01_name))
            matched += 1
        else:
            log.warning(f"  No Tank01 match for: {full_name!r}")
            skipped += 1

    conn.commit()
    log.info(f"Player map: {matched} matched, {skipped} skipped")


# ---------------------------------------------------------------------------
# Field transformation
# ---------------------------------------------------------------------------

def parse_game_id(game_id: str, player_team_abbrev: str) -> tuple[str, str, str]:
    """
    gameID format: YYYYMMDD_AWAY@HOME
    Returns (game_date_iso, opponent_full, home_away)
    """
    date_part, matchup = game_id.split("_", 1)
    game_date = f"{date_part[:4]}-{date_part[4:6]}-{date_part[6:]}"

    away_abbrev, home_abbrev = matchup.split("@")
    if player_team_abbrev.upper() == home_abbrev.upper():
        home_away = "H"
        opp_abbrev = away_abbrev
    else:
        home_away = "A"
        opp_abbrev = home_abbrev

    opponent = TEAM_ABBREV.get(opp_abbrev.upper(), opp_abbrev.upper())
    return game_date, opponent, home_away


def transform_game(game: dict, br_slug: str):
    """
    Map a single Tank01 game dict to a game_logs row.
    Returns None if essential fields are missing.
    """
    game_id = game.get("gameID", "")
    team_abbrev = game.get("teamAbv") or game.get("team", "")

    try:
        game_date, opponent, home_away = parse_game_id(game_id, team_abbrev)
    except (ValueError, KeyError):
        log.warning(f"  Could not parse gameID: {game_id!r}")
        return None

    gd = date.fromisoformat(game_date)
    season = season_from_date(gd)
    team   = TEAM_ABBREV.get(team_abbrev.upper(), team_abbrev.upper())

    def f(key, default=0.0):
        v = game.get(key, default)
        try:
            return float(v) if v not in (None, "", "null") else default
        except (ValueError, TypeError):
            return default

    return {
        "player_slug": br_slug,
        "game_date":   game_date,
        "season":      season,
        "team":        team,
        "opponent":    opponent,
        "home_away":   home_away,
        "min":         f("mins"),
        "pts":         f("pts"),
        "reb":         f("reb"),
        "oreb":        f("OffReb"),
        "dreb":        f("DefReb"),
        "ast":         f("ast"),
        "stl":         f("stl"),
        "blk":         f("blk"),
        "tov":         f("TOV"),
        "fgm":         f("fgm"),
        "fga":         f("fga"),
        "fg3m":        f("tptfgm"),
        "fg3a":        f("tptfga"),
        "ftm":         f("ftm"),
        "fta":         f("fta"),
        # dreb_pct / oreb_pct require team box score data — left NULL for now
        # Run refresh.py enrichment step or a separate team_games pull to populate
        "dreb_pct":    None,
        "oreb_pct":    None,
    }


# ---------------------------------------------------------------------------
# Upsert helper
# ---------------------------------------------------------------------------

def upsert_game_logs(conn, rows: list[dict]):
    if not rows:
        return
    cols   = list(rows[0].keys())
    ph     = ", ".join("?" * len(cols))
    update = ", ".join(
        f"{c}=excluded.{c}" for c in cols
        if c not in ("player_slug", "game_date", "team")
    )
    sql = (
        f"INSERT INTO game_logs ({', '.join(cols)}) VALUES ({ph}) "
        f"ON CONFLICT(player_slug, game_date, team) DO UPDATE SET {update}"
    )
    conn.executemany(sql, [
        [r[c] for c in cols] for r in rows
    ])
    conn.commit()


# ---------------------------------------------------------------------------
# Main ingestion
# ---------------------------------------------------------------------------

def ingest(season_end_year: int, since_date=None):
    conn = get_conn()
    init_db()
    ensure_tank01_map_table(conn)

    # Load player map — only players with game_logs in this season
    season = season_label(season_end_year)
    mapped = conn.execute("""
        SELECT DISTINCT t.br_slug, t.tank01_id
        FROM tank01_player_map t
        JOIN game_logs g ON g.player_slug = t.br_slug
        WHERE g.season = ?
    """, (season,)).fetchall()
    if not mapped:
        log.warning("No player mappings found. Run with --build-map first.")
        return

    log.info(f"Ingesting season {season_end_year} for {len(mapped)} players…")

    total_inserted = 0
    for row in mapped:
        br_slug   = row["br_slug"]
        tank01_id = row["tank01_id"]

        log.info(f"  Fetching {br_slug} ({tank01_id})…")
        try:
            games = fetch_player_games(tank01_id, season_end_year)
        except Exception as e:
            log.error(f"  Error fetching {br_slug}: {e}")
            continue

        rows = []
        for game_id, game in games.items():
            if not isinstance(game, dict):
                continue
            row_dict = transform_game(game, br_slug)
            if row_dict is None:
                continue
            # Filter by date if requested
            if since_date and date.fromisoformat(row_dict["game_date"]) < since_date:
                continue
            rows.append(row_dict)

        if rows:
            upsert_game_logs(conn, rows)
            log.info(f"    → {len(rows)} games upserted")
            total_inserted += len(rows)
        else:
            log.info(f"    → no new games")

    log.info(f"Done. Total game rows upserted: {total_inserted}")
    conn.close()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest NBA game logs from Tank01 API")
    parser.add_argument("--season", type=int, default=None,
                        help="Season end year (default: current season)")
    parser.add_argument("--days",   type=int, default=None,
                        help="Only ingest games from the last N days")
    parser.add_argument("--build-map", action="store_true",
                        help="Rebuild player ID mapping then exit")
    args = parser.parse_args()

    if not RAPIDAPI_KEY:
        raise SystemExit("Set RAPIDAPI_KEY environment variable before running.")

    conn = get_conn()
    init_db()
    ensure_tank01_map_table(conn)

    if args.build_map:
        build_player_map(conn)
        conn.close()
        raise SystemExit(0)

    # Determine season
    if args.season:
        season_year = args.season
    else:
        today = date.today()
        season_year = today.year + 1 if today.month >= 10 else today.year

    since = date.today() - timedelta(days=args.days) if args.days else None

    conn.close()
    ingest(season_year, since_date=since)
