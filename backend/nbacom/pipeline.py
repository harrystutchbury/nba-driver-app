from __future__ import annotations

"""
pipeline.py — Nightly NBA.com tracking/hustle stats pipeline.

Usage:
    cd backend
    python -m nbacom.pipeline                    # process yesterday
    python -m nbacom.pipeline --date 2026-04-10  # process a specific date
    python -m nbacom.pipeline --update-avgs-only # skip game log, just recalculate averages

Schedule: run daily at 06:00 ET (games typically finish well before then).
"""

import argparse
import logging
import os
import sys
import time
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from schema import get_conn  # noqa: E402
from nbacom.schema import init_nbacom_tables  # noqa: E402
from nbacom.client import (  # noqa: E402
    MEASURE_TYPES,
    MEASURE_COL_MAP,
    ALL_STAT_DB_COLS,
    CURRENT_SEASON,
    fetch_measure,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

MAX_MEASURE_FAILURES = 3   # abort the run if this many measure types fail
MIN_PLAYER_ROW_COUNT = 100  # flag a warning if fewer rows returned on a game night


# ---------------------------------------------------------------------------
# Player ID mapping
# ---------------------------------------------------------------------------

def _load_id_map(conn) -> dict[int, str]:
    """Returns {nba_com_player_id: our_player_id} from the mapping table."""
    rows = conn.execute(
        "SELECT nba_com_player_id, our_player_id FROM nbacom_player_id_mapping"
    ).fetchall()
    return {r["nba_com_player_id"]: r["our_player_id"] for r in rows}


def _build_name_index(conn) -> dict[str, str]:
    """
    Returns {normalised_name: player_slug} from our players table.
    Used to fuzzy-match NBA.com player names.
    """
    rows = conn.execute(
        "SELECT DISTINCT slug, full_name FROM players ORDER BY season DESC"
    ).fetchall()
    index: dict[str, str] = {}
    for r in rows:
        key = r["full_name"].lower().strip()
        if key not in index:
            index[key] = r["slug"]
    return index


def _match_player(
    conn,
    nba_com_id: int,
    player_name: str,
    team: str,
    game_date: str,
    id_map: dict,
    name_index: dict,
) -> str | None:
    """
    Resolve nba_com_player_id → our player slug.

    Strategy:
    1. Check existing mapping table (fastest path)
    2. Exact name match in our players table
    3. Try rapidfuzz if available (fuzzy match)
    4. Write to unmatched_players and return None
    """
    if nba_com_id in id_map:
        return id_map[nba_com_id]

    normalised = player_name.lower().strip()
    if normalised in name_index:
        slug = name_index[normalised]
        _save_mapping(conn, slug, nba_com_id, player_name, team)
        id_map[nba_com_id] = slug
        return slug

    # Fuzzy fallback
    try:
        from rapidfuzz import process as rfprocess
        match = rfprocess.extractOne(normalised, name_index.keys(), score_cutoff=90)
        if match:
            slug = name_index[match[0]]
            log.info("Fuzzy matched '%s' → '%s' (score %.0f)", player_name, slug, match[1])
            _save_mapping(conn, slug, nba_com_id, player_name, team)
            id_map[nba_com_id] = slug
            return slug
    except ImportError:
        pass

    # Could not match — write to unmatched table for manual review
    log.warning("Could not match NBA.com player: %s (id=%d, team=%s)", player_name, nba_com_id, team)
    conn.execute(
        """
        INSERT OR IGNORE INTO nbacom_unmatched_players
            (nba_com_player_id, player_name, team_abbreviation, game_date)
        VALUES (?, ?, ?, ?)
        """,
        (nba_com_id, player_name, team, game_date),
    )
    return None


def _save_mapping(conn, slug: str, nba_com_id: int, name: str, team: str):
    today = date.today().isoformat()
    conn.execute(
        """
        INSERT INTO nbacom_player_id_mapping
            (our_player_id, nba_com_player_id, player_name, team_abbreviation, last_verified)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(our_player_id) DO UPDATE SET
            nba_com_player_id = excluded.nba_com_player_id,
            player_name       = excluded.player_name,
            team_abbreviation = excluded.team_abbreviation,
            last_verified     = excluded.last_verified
        """,
        (slug, nba_com_id, name, team, today),
    )


# ---------------------------------------------------------------------------
# Game log insertion
# ---------------------------------------------------------------------------

def _insert_game_log_rows(conn, rows: list[dict], measure_type: str, game_date: str):
    """Upsert a list of normalised rows into nbacom_stats_game_log."""
    if not rows:
        return

    # Build INSERT with only the columns present in the first row (plus fixed ones).
    # All other stat columns default to NULL via the UNIQUE conflict update.
    sample = rows[0]
    stat_db_cols = [c for c in sample if c in ALL_STAT_DB_COLS]

    fixed_cols = ["player_id", "nba_com_player_id", "game_date", "measure_type", "gp", "min"]
    all_cols   = fixed_cols + stat_db_cols
    placeholders = ", ".join("?" * len(all_cols))
    update_set   = ", ".join(f"{c}=excluded.{c}" for c in all_cols if c != "nba_com_player_id")

    sql = (
        f"INSERT INTO nbacom_stats_game_log ({', '.join(all_cols)}) "
        f"VALUES ({placeholders}) "
        f"ON CONFLICT(nba_com_player_id, game_date, measure_type) DO UPDATE SET {update_set}"
    )

    params = [
        [
            row.get("player_id"),
            row["nba_com_player_id"],
            game_date,
            measure_type,
            row.get("gp"),
            row.get("min"),
        ] + [row.get(c) for c in stat_db_cols]
        for row in rows
    ]
    conn.executemany(sql, params)


# ---------------------------------------------------------------------------
# Season average computation (from stored game log — no extra API calls)
# ---------------------------------------------------------------------------

def _update_season_averages(conn, season: str = CURRENT_SEASON):
    """
    Recompute nbacom_stats_season_avg from the nbacom_stats_game_log.

    Periods:
      full_season — all game_log rows for this season
      last_30     — game_log rows in the last 30 days
      last_14     — game_log rows in the last 14 days

    Note: percentage/rate stats (fg_pct, avg_speed, pie, etc.) are averaged
    arithmetically across games. This gives slightly different results from the
    true weighted season average but is acceptable for a secondary source.
    For exact weighted percentages, requery the API with the appropriate date range.
    """
    log.info("Updating season averages for %s ...", season)
    today     = date.today()
    cutoff_30 = (today - timedelta(days=30)).isoformat()
    cutoff_14 = (today - timedelta(days=14)).isoformat()

    # We need per-player, per-measure_type averages over each period window.
    # The game_log links nba_com_player_id to player_id; we join on it.
    stat_db_cols = sorted(ALL_STAT_DB_COLS)
    avg_exprs    = ", ".join(f"AVG({c}) AS {c}" for c in stat_db_cols)

    periods = {
        "full_season": None,   # no date filter beyond season tag (all rows in season's date range)
        "last_30":     cutoff_30,
        "last_14":     cutoff_14,
    }

    season_start = "2025-10-22"  # first game of 2025-26; adjust for other seasons
    season_end   = today.isoformat()

    for period_name, cutoff in periods.items():
        if cutoff:
            date_filter = f"AND game_date >= '{cutoff}'"
        else:
            date_filter = f"AND game_date >= '{season_start}' AND game_date <= '{season_end}'"

        rows = conn.execute(f"""
            SELECT
                nba_com_player_id,
                MAX(player_id)      AS player_id,
                measure_type,
                COUNT(*)            AS gp,
                AVG(min)            AS min,
                {avg_exprs}
            FROM nbacom_stats_game_log
            WHERE game_date {date_filter}
            GROUP BY nba_com_player_id, measure_type
        """).fetchall()

        if not rows:
            continue

        cols        = ["player_id", "nba_com_player_id", "season", "period", "measure_type", "gp", "min"] + stat_db_cols
        placeholders = ", ".join("?" * len(cols))
        update_set   = ", ".join(
            f"{c}=excluded.{c}" for c in cols
            if c not in ("nba_com_player_id", "season", "period", "measure_type")
        )
        sql = (
            f"INSERT INTO nbacom_stats_season_avg ({', '.join(cols)}) "
            f"VALUES ({placeholders}) "
            f"ON CONFLICT(nba_com_player_id, season, period, measure_type) DO UPDATE SET {update_set}, "
            f"updated_at=datetime('now')"
        )

        params = [
            [
                r["player_id"], r["nba_com_player_id"], season, period_name,
                r["measure_type"], r["gp"], r["min"],
            ] + [r[c] for c in stat_db_cols]
            for r in rows
        ]
        conn.executemany(sql, params)
        log.info("  %s: upserted %d rows", period_name, len(rows))

    conn.commit()
    log.info("Season averages updated.")


# ---------------------------------------------------------------------------
# Main nightly pipeline
# ---------------------------------------------------------------------------

def run_nightly(game_date: date | None = None, skip_avgs: bool = False):
    """
    Pull tracking/hustle stats for game_date (default: yesterday) and store
    per-game rows in nbacom_stats_game_log. Then update season averages.

    If more than MAX_MEASURE_FAILURES measure types fail, the run is aborted
    early and all successful data is committed.
    """
    if game_date is None:
        game_date = date.today() - timedelta(days=1)

    game_date_str = game_date.isoformat()
    log.info("=" * 60)
    log.info("NBA.com nightly pipeline — %s", game_date_str)
    log.info("=" * 60)

    conn = get_conn()
    init_nbacom_tables()   # idempotent; creates tables if absent

    id_map     = _load_id_map(conn)
    name_index = _build_name_index(conn)

    failures       = 0
    total_inserted = 0

    for measure_type in MEASURE_TYPES:
        t_start = time.monotonic()
        log.info("Pulling %s ...", measure_type)
        try:
            api_rows = fetch_measure(measure_type, game_date, game_date)

            if len(api_rows) < MIN_PLAYER_ROW_COUNT:
                log.warning(
                    "%s returned only %d rows (expected >=%d on a game night). "
                    "May be a non-game day or an API issue.",
                    measure_type, len(api_rows), MIN_PLAYER_ROW_COUNT,
                )

            # Attach our player_id to each row
            enriched = []
            for row in api_rows:
                slug = _match_player(
                    conn,
                    row["nba_com_player_id"],
                    row["player_name"],
                    row["team_abbreviation"],
                    game_date_str,
                    id_map,
                    name_index,
                )
                enriched.append({**row, "player_id": slug})

            _insert_game_log_rows(conn, enriched, measure_type, game_date_str)
            conn.commit()

            duration = time.monotonic() - t_start
            total_inserted += len(enriched)
            log.info("  %s: %d rows — %.1fs", measure_type, len(enriched), duration)

            conn.execute(
                "INSERT INTO nbacom_pipeline_log "
                "(run_date, measure_type, rows_pulled, success, duration_seconds) "
                "VALUES (?, ?, ?, 1, ?)",
                (game_date_str, measure_type, len(enriched), duration),
            )
            conn.commit()

        except Exception as exc:
            failures += 1
            duration = time.monotonic() - t_start
            log.error("FAILED %s: %s", measure_type, exc)
            conn.execute(
                "INSERT INTO nbacom_pipeline_log "
                "(run_date, measure_type, rows_pulled, success, error_message, duration_seconds) "
                "VALUES (?, ?, 0, 0, ?, ?)",
                (game_date_str, measure_type, str(exc), duration),
            )
            conn.commit()

            if failures >= MAX_MEASURE_FAILURES:
                log.error(
                    "%d measure type failures — aborting run. "
                    "Check NBA.com availability or rate limiting.",
                    failures,
                )
                break

    log.info("Game log done: %d total rows, %d measure type failures.", total_inserted, failures)

    if not skip_avgs and failures < MAX_MEASURE_FAILURES:
        _update_season_averages(conn)

    conn.close()
    return failures == 0


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NBA.com nightly tracking pipeline")
    parser.add_argument(
        "--date",
        default=None,
        help="Game date to process (YYYY-MM-DD). Defaults to yesterday.",
    )
    parser.add_argument(
        "--update-avgs-only",
        action="store_true",
        help="Skip game log pull, only recalculate season averages.",
    )
    args = parser.parse_args()

    if args.date:
        target = date.fromisoformat(args.date)
    else:
        target = None

    if args.update_avgs_only:
        conn = get_conn()
        _update_season_averages(conn)
        conn.close()
    else:
        success = run_nightly(game_date=target)
        sys.exit(0 if success else 1)
