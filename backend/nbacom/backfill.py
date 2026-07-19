from __future__ import annotations

"""
backfill.py — Populate the full 2025-26 season history from NBA.com.

Iterates day-by-day from SEASON_START to yesterday, skipping non-game days,
and calls the nightly pipeline for each game date found.

Resumable: if interrupted, re-run with the same arguments and it will skip
dates already in the database (use --force to reprocess them).

Estimated runtime for a full season:
    ~160 game days × 12 measure types × 2s delay = ~64 minutes in delays alone.
    Allow several hours for network latency and retries.

Usage:
    cd backend
    python -m nbacom.backfill                             # full season
    python -m nbacom.backfill --from 2026-01-01           # resume from Jan 1
    python -m nbacom.backfill --from 2026-01-01 --to 2026-01-31  # January only
    python -m nbacom.backfill --force                     # reprocess all dates
"""

import argparse
import logging
import os
import sys
import time
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from schema import get_conn  # noqa: E402
from nbacom.client import CURRENT_SEASON, MEASURE_TYPES  # noqa: E402
from nbacom.pipeline import run_nightly, _update_season_averages  # noqa: E402
from nbacom.schema import init_nbacom_tables  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

SEASON_START  = date(2025, 10, 22)
INTER_CALL_DELAY_BACKFILL = 3.0   # slightly more conservative than nightly
MONTH_PAUSE   = 30.0              # seconds between calendar months


def _get_game_dates_from_db(conn, start: date, end: date) -> set[str]:
    """
    Return set of dates where we have game_logs entries — used as ground truth
    for whether a game was played on a given day.
    """
    rows = conn.execute(
        "SELECT DISTINCT game_date FROM game_logs WHERE game_date >= ? AND game_date <= ?",
        (start.isoformat(), end.isoformat()),
    ).fetchall()
    return {r["game_date"] for r in rows}


def _get_already_processed(conn, measure_type: str = None) -> set[str]:
    """
    Return dates already in nbacom_stats_game_log (all measure types present).
    A date is considered fully processed only when all 12 measure types succeeded.
    """
    if measure_type:
        rows = conn.execute(
            "SELECT DISTINCT game_date FROM nbacom_stats_game_log WHERE measure_type = ?",
            (measure_type,),
        ).fetchall()
    else:
        # A date is complete only if ALL measure types are present
        n = len(MEASURE_TYPES)
        rows = conn.execute(
            """
            SELECT game_date
            FROM nbacom_stats_game_log
            GROUP BY game_date
            HAVING COUNT(DISTINCT measure_type) >= ?
            """,
            (n,),
        ).fetchall()
    return {r["game_date"] for r in rows}


def run_backfill(
    start: date = SEASON_START,
    end: date | None = None,
    force: bool = False,
):
    """
    Main backfill entry point.

    Args:
        start:  First date to process (inclusive).
        end:    Last date to process (inclusive). Defaults to yesterday.
        force:  If True, reprocess dates already in the database.
    """
    if end is None:
        end = date.today() - timedelta(days=1)

    if start > end:
        log.error("Start date %s is after end date %s", start, end)
        return

    conn = get_conn()
    init_nbacom_tables()

    game_dates_set  = _get_game_dates_from_db(conn, start, end)
    done_dates      = set() if force else _get_already_processed(conn)
    conn.close()

    log.info("=" * 60)
    log.info("NBA.com backfill: %s → %s", start, end)
    log.info("Game days in schedule:   %d", len(game_dates_set))
    log.info("Already processed:       %d", len(done_dates))
    log.info("Force reprocess:         %s", force)
    log.info("=" * 60)

    # Collect game dates in range that haven't been processed
    pending = sorted(
        d for d in game_dates_set
        if start.isoformat() <= d <= end.isoformat() and d not in done_dates
    )

    if not pending:
        log.info("Nothing to process — all game days already in database. "
                 "Use --force to reprocess.")
        _update_season_averages(get_conn())
        return

    log.info("%d game days to process.", len(pending))

    total_ok   = 0
    total_fail = 0
    current_month = None

    for i, date_str in enumerate(pending, 1):
        game_date = date.fromisoformat(date_str)

        # Pause between calendar months to avoid sustained rate limiting
        month_key = (game_date.year, game_date.month)
        if current_month and month_key != current_month:
            log.info("Month boundary — pausing %.0fs before next month ...", MONTH_PAUSE)
            time.sleep(MONTH_PAUSE)
        current_month = month_key

        log.info("[%d/%d] Processing %s ...", i, len(pending), date_str)
        try:
            # Import here so we can override the inter-call delay for backfill
            import nbacom.client as _client
            original_delay = _client.INTER_CALL_DELAY
            _client.INTER_CALL_DELAY = INTER_CALL_DELAY_BACKFILL

            # skip_avgs=True: don't recalculate averages after every single day;
            # we do one final recalculation at the end.
            success = run_nightly(game_date=game_date, skip_avgs=True)

            _client.INTER_CALL_DELAY = original_delay

            if success:
                total_ok += 1
                log.info("  ✓ %s complete", date_str)
            else:
                total_fail += 1
                log.warning("  ✗ %s had failures (see pipeline_log for details)", date_str)

        except Exception as exc:
            total_fail += 1
            log.error("  ✗ %s unhandled error: %s", date_str, exc)

    # Final season average recalculation
    log.info("Backfill done: %d OK, %d failed.", total_ok, total_fail)
    log.info("Recalculating season averages from complete game log ...")
    conn = get_conn()
    _update_season_averages(conn)
    conn.close()
    log.info("Backfill complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NBA.com full-season backfill")
    parser.add_argument(
        "--from",
        dest="from_date",
        default=None,
        help="Start date YYYY-MM-DD (default: 2025-10-22 season start)",
    )
    parser.add_argument(
        "--to",
        dest="to_date",
        default=None,
        help="End date YYYY-MM-DD (default: yesterday)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Reprocess dates already in the database",
    )
    args = parser.parse_args()

    start = date.fromisoformat(args.from_date) if args.from_date else SEASON_START
    end   = date.fromisoformat(args.to_date)   if args.to_date   else None

    run_backfill(start=start, end=end, force=args.force)
