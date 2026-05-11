"""
CLI entry point for CTW simulation pipeline.

Usage:
    python -m ctw.run --season 2024-25
    python -m ctw.run --season 2024-25 --league-sizes 10 12
    python -m ctw.run --season 2024-25 --scores-only   # skip simulation, recalc scores
    python -m ctw.run --season 2024-25 --n-leagues 200  # quick test run

Steps:
    1. init_ctw_tables
    2. run_simulation → build_curves → store_curves
    3. calculate_and_store (player scores)
    4. apply_scarcity
    5. validate_curves
"""

from __future__ import annotations

import argparse
import logging
import sys
import os
import time

# Allow running from the backend directory
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from schema import get_conn
from ctw.schema import init_ctw_tables
from ctw import adp as adp_mod
from ctw import simulation, curves as curve_mod, player_scores, adjustments, validate

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ctw.run")


def run(
    season: str,
    league_sizes: list[int] | None = None,
    scores_only: bool = False,
    adp_path=None,
    adp_prefer: str = "yahoo",
    seed: int | None = None,
) -> dict:
    """
    Run the full CTW simulation pipeline. Returns the validation report.
    Can also be called from the API endpoint.
    """
    t0 = time.time()
    conn = get_conn()
    init_ctw_tables(conn)
    log.info("CTW tables initialised")

    if league_sizes is None:
        league_sizes = list(range(8, 17))

    if not scores_only:
        adp_path = adp_path or adp_mod.DEFAULT_ADP_PATH
        log.info("Loading ADP from %s (prefer=%s)", adp_path, adp_prefer)
        adp_players = adp_mod.load_adp(adp_path, prefer=adp_prefer)
        adp_players = adp_mod.match_to_slugs(adp_players, conn)
        log.info("%d ADP players matched", len(adp_players))

        from ctw.constants import DEFAULT_N_LEAGUES, DEFAULT_N_WEEKS, DEFAULT_N_WEEK_SAMPLES
        import numpy as _np

        rng = _np.random.default_rng(seed)
        pool = simulation.build_player_pool(conn, season)
        if not pool:
            raise ValueError(f"No player data for season {season}")

        distributions = simulation.build_weekly_distributions(pool, n_samples=DEFAULT_N_WEEK_SAMPLES, rng=rng)
        adp_in_pool = [p for p in adp_players if p.get("slug") in distributions]
        log.info("ADP players in pool: %d", len(adp_in_pool))

        log.info("Running simulation for season=%s league_sizes=%s …", season, league_sizes)
        all_curves: dict = {}
        for ls in league_sizes:
            log.info("Simulating league_size=%d (%d leagues × %d weeks) …", ls, DEFAULT_N_LEAGUES, DEFAULT_N_WEEKS)
            result = simulation.simulate_league_size(adp_in_pool, distributions, ls, DEFAULT_N_LEAGUES, DEFAULT_N_WEEKS, rng=rng)
            ls_curves = curve_mod.build_curves({ls: result})
            curve_mod.store_curves(conn, ls_curves)
            all_curves.update(ls_curves)
            log.info("Stored curves for league_size=%d", ls)

        curve_mod.load_curves_into_cache(conn)
        log.info("All curves built and cached (%d)", len(all_curves))
    else:
        log.info("scores_only: loading existing curves into cache")
        curve_mod.load_curves_into_cache(conn)

    log.info("Calculating player scores …")
    player_scores.calculate_and_store(conn, season, league_sizes=league_sizes)

    log.info("Applying scarcity adjustments …")
    adjustments.apply_scarcity(conn, season, league_sizes=league_sizes)

    log.info("Running validation …")
    report = validate.validate_curves(conn, season)
    status = "PASS" if report.get("overall_pass") else "FAIL"
    log.info("Validation: %s — done in %.1f s", status, time.time() - t0)

    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Run CTW simulation pipeline")
    parser.add_argument("--season",       required=True,  help="Season string e.g. 2024-25")
    parser.add_argument("--league-sizes", nargs="+", type=int, default=None)
    parser.add_argument("--scores-only",  action="store_true")
    parser.add_argument("--adp-path",     default=None)
    parser.add_argument("--adp-prefer",   default="yahoo", choices=["yahoo", "fantrax"])
    parser.add_argument("--seed",         type=int, default=None)
    args = parser.parse_args()

    report = run(
        season=args.season,
        league_sizes=args.league_sizes,
        scores_only=args.scores_only,
        adp_path=args.adp_path,
        adp_prefer=args.adp_prefer,
        seed=args.seed,
    )
    if not report.get("overall_pass"):
        sys.exit(1)


if __name__ == "__main__":
    main()
