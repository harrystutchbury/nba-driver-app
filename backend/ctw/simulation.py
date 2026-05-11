"""
Monte Carlo simulation engine for CTW win probability curves.

High-level flow:
  1. Build player pool from game_logs (10+ min/game, 20+ games)
  2. Pre-compute N_WEEK_SAMPLES weekly distributions per player by
     randomly sampling 3 or 4 actual games and summing stats
  3. For each league size, simulate N_LEAGUES snake-drafted leagues
     each playing N_WEEKS head-to-head weeks
  4. Collect (winning_team_total, losing_team_total) per category
     across all matchups → used by curves.py to build P(win | CTW%)
"""

from __future__ import annotations

import logging
import sqlite3
from itertools import combinations
from typing import Any

import numpy as np

from .constants import (
    ALL_CATS, COUNTING_CATS, DEFAULT_N_LEAGUES, DEFAULT_N_WEEK_SAMPLES,
    DEFAULT_N_WEEKS, ADP_NOISE_SIGMA, MIN_GAMES, MIN_MIN_PG, ROSTER_SIZE,
)

log = logging.getLogger(__name__)

# Columns fetched from game_logs for simulation
_GAME_COLS = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m", "fgm", "fga", "ftm", "fta"]


# ── Player pool ───────────────────────────────────────────────────────

def build_player_pool(conn: sqlite3.Connection, season: str) -> dict[str, dict]:
    """
    Return {slug: {name, min_pg, games: [...], weekly_dist: {cat: np.ndarray}}}
    for all players meeting the min games/minutes threshold.
    Weekly distributions are NOT yet sampled here — call build_weekly_distributions().
    """
    rows = conn.execute("""
        SELECT
            p.player_slug AS slug,
            pl.full_name  AS name,
            COUNT(*)      AS n_games,
            AVG(p.min)    AS avg_min,
            p.pts, p.reb, p.ast, p.stl, p.blk, p.tov, p.fg3m,
            p.fgm, p.fga, p.ftm, p.fta,
            p.game_date
        FROM game_logs p
        LEFT JOIN players pl ON pl.slug = p.player_slug AND pl.season = p.season
        WHERE p.season = ? AND p.min > 0
        GROUP BY p.player_slug
        HAVING COUNT(*) >= ? AND AVG(p.min) >= ?
    """, (season, MIN_GAMES, MIN_MIN_PG)).fetchall()

    # Reload as per-game rows for distribution sampling
    slugs = [r["slug"] for r in rows]
    if not slugs:
        return {}

    placeholders = ",".join("?" * len(slugs))
    game_rows = conn.execute(f"""
        SELECT player_slug AS slug, {', '.join(_GAME_COLS)}
        FROM game_logs
        WHERE season = ? AND min > 0 AND player_slug IN ({placeholders})
    """, (season, *slugs)).fetchall()

    # Group games by slug
    games_by_slug: dict[str, list] = {}
    for g in game_rows:
        games_by_slug.setdefault(g["slug"], []).append(g)

    # Build summary for each qualifying player
    pool = {}
    for r in rows:
        slug = r["slug"]
        games = games_by_slug.get(slug, [])
        if len(games) < MIN_GAMES:
            continue
        pool[slug] = {
            "slug":    slug,
            "name":    r["name"] or slug,
            "avg_min": r["avg_min"],
            "games":   games,
        }

    log.info("Player pool: %d players for season %s", len(pool), season)
    return pool


def build_weekly_distributions(
    pool: dict[str, dict],
    n_samples: int = DEFAULT_N_WEEK_SAMPLES,
    rng: np.random.Generator | None = None,
) -> dict[str, dict[str, np.ndarray]]:
    """
    Pre-compute weekly production distributions for every player in the pool.

    A "week" = sum of 3 or 4 randomly sampled games (equal probability).
    Sampling with replacement from actual game logs captures real variance.

    Returns {slug: {cat: np.ndarray(shape=n_samples)}}
    for cats: pts, reb, ast, stl, blk, tov, fg3m, fgm, fga, ftm, fta
    """
    if rng is None:
        rng = np.random.default_rng()

    distributions: dict[str, dict[str, np.ndarray]] = {}
    cats_with_volume = COUNTING_CATS + ["fgm", "fga", "ftm", "fta"]

    for slug, player in pool.items():
        games = player["games"]
        n_games = len(games)

        # Build (n_games, n_cols) matrix
        mat = np.array([
            [g[c] or 0.0 for c in cats_with_volume]
            for g in games
        ], dtype=np.float32)

        # Sample weeks: for each sample, draw 3 or 4 game indices
        week_sizes = rng.choice([3, 4], size=n_samples)
        weekly = np.zeros((n_samples, len(cats_with_volume)), dtype=np.float32)
        for i, wsize in enumerate(week_sizes):
            idx = rng.integers(0, n_games, size=wsize)
            weekly[i] = mat[idx].sum(axis=0)

        distributions[slug] = {
            cat: weekly[:, ci] for ci, cat in enumerate(cats_with_volume)
        }

    log.info("Built weekly distributions for %d players (%d samples each)", len(distributions), n_samples)
    return distributions


# ── Team simulation ───────────────────────────────────────────────────

def simulate_team_weeks(
    roster: list[dict],
    distributions: dict[str, dict[str, np.ndarray]],
    n_weeks: int,
    rng: np.random.Generator,
) -> dict[str, np.ndarray]:
    """
    For a roster of players, return weekly team totals for each category.
    Shape of each array: (n_weeks,)

    Counting stats are summed directly.
    FG% and FT% are computed from summed FGM/FGA and FTM/FTA.
    """
    cats_with_volume = COUNTING_CATS + ["fgm", "fga", "ftm", "fta"]
    team_weekly = {cat: np.zeros(n_weeks, dtype=np.float32) for cat in cats_with_volume}

    for player in roster:
        slug = player.get("slug")
        if not slug or slug not in distributions:
            continue
        dist = distributions[slug]
        n_samples = len(dist["pts"])
        idx = rng.integers(0, n_samples, size=n_weeks)
        for cat in cats_with_volume:
            team_weekly[cat] += dist[cat][idx]

    # Compute percentage rates from accumulated attempts
    fga = np.where(team_weekly["fga"] > 0, team_weekly["fga"], 1.0)
    fta = np.where(team_weekly["fta"] > 0, team_weekly["fta"], 1.0)
    team_weekly["fg"] = team_weekly["fgm"] / fga
    team_weekly["ft"] = team_weekly["ftm"] / fta

    return team_weekly


def simulate_league_size(
    adp_players: list[dict],
    distributions: dict[str, dict[str, np.ndarray]],
    league_size: int,
    n_leagues: int = DEFAULT_N_LEAGUES,
    n_weeks: int   = DEFAULT_N_WEEKS,
    rng: np.random.Generator | None = None,
) -> dict[str, Any]:
    """
    Run the full simulation for one league size.

    Returns:
        {
            "winning_totals": {cat: np.ndarray},   # all winning team totals
            "losing_totals":  {cat: np.ndarray},   # all losing team totals
            "margins":        {cat: np.ndarray},   # abs(winner - loser)
            "avg_team_fgm":   float,               # used for delta calculations
            "avg_team_fga":   float,
            "avg_team_ftm":   float,
            "avg_team_fta":   float,
        }
    """
    if rng is None:
        rng = np.random.default_rng()

    from .adp import get_draft_order

    from .constants import INVERTED_CATS

    n_pairs = league_size * (league_size - 1) // 2
    # Pre-allocate numpy arrays — avoids Python list overhead (28 bytes/float vs 4)
    capacity = n_leagues * n_pairs * n_weeks
    winning_totals: dict[str, np.ndarray] = {cat: np.empty(capacity, dtype=np.float32) for cat in ALL_CATS}
    losing_totals:  dict[str, np.ndarray] = {cat: np.empty(capacity, dtype=np.float32) for cat in ALL_CATS}
    margins:        dict[str, np.ndarray] = {cat: np.empty(capacity, dtype=np.float32) for cat in ALL_CATS}
    fill = {cat: 0 for cat in ALL_CATS}

    sum_fgm = sum_fga = sum_ftm = sum_fta = 0.0
    n_teams_total = 0

    for league_idx in range(n_leagues):
        teams = get_draft_order(
            adp_players, league_size, ROSTER_SIZE,
            noise_sigma=ADP_NOISE_SIGMA, rng=rng,
        )

        # Simulate weekly totals for each team
        team_weekly: list[dict[str, np.ndarray]] = []
        for roster in teams:
            tw = simulate_team_weeks(roster, distributions, n_weeks, rng)
            team_weekly.append(tw)
            sum_fgm += float(tw["fgm"].mean())
            sum_fga += float(tw["fga"].mean())
            sum_ftm += float(tw["ftm"].mean())
            sum_fta += float(tw["fta"].mean())
            n_teams_total += 1

        # Head-to-head matchups: every pair plays every week
        for t1, t2 in combinations(range(league_size), 2):
            for cat in ALL_CATS:
                t1_weekly = team_weekly[t1][cat]
                t2_weekly = team_weekly[t2][cat]
                diff = t1_weekly - t2_weekly

                if cat in INVERTED_CATS:
                    t1_wins = diff < 0
                else:
                    t1_wins = diff > 0

                win_totals = np.where(t1_wins, t1_weekly, t2_weekly)
                los_totals = np.where(t1_wins, t2_weekly, t1_weekly)

                nonzero = np.abs(diff) > 1e-6
                n_nz = int(nonzero.sum())
                if n_nz == 0:
                    continue
                f = fill[cat]
                winning_totals[cat][f:f + n_nz] = win_totals[nonzero]
                losing_totals[cat][f:f + n_nz]  = los_totals[nonzero]
                margins[cat][f:f + n_nz]         = np.abs(diff[nonzero])
                fill[cat] += n_nz

        if (league_idx + 1) % 100 == 0:
            log.info("  League size %d: %d/%d leagues done", league_size, league_idx + 1, n_leagues)

    return {
        "winning_totals": {cat: winning_totals[cat][:fill[cat]] for cat in ALL_CATS},
        "losing_totals":  {cat: losing_totals[cat][:fill[cat]]  for cat in ALL_CATS},
        "margins":        {cat: margins[cat][:fill[cat]]         for cat in ALL_CATS},
        "avg_team_fgm":   sum_fgm / n_teams_total if n_teams_total else 0.0,
        "avg_team_fga":   sum_fga / n_teams_total if n_teams_total else 1.0,
        "avg_team_ftm":   sum_ftm / n_teams_total if n_teams_total else 0.0,
        "avg_team_fta":   sum_fta / n_teams_total if n_teams_total else 1.0,
    }


def run_simulation(
    conn: sqlite3.Connection,
    adp_players: list[dict],
    season: str,
    league_sizes: list[int] | None = None,
    n_leagues: int = DEFAULT_N_LEAGUES,
    n_weeks:   int = DEFAULT_N_WEEKS,
    n_samples: int = DEFAULT_N_WEEK_SAMPLES,
    seed: int | None = None,
) -> dict[int, dict]:
    """
    Full simulation entry point. Returns results keyed by league size.
    Call curves.build_and_store() with the returned results.
    """
    if league_sizes is None:
        league_sizes = list(range(8, 17))

    rng = np.random.default_rng(seed)

    log.info("Building player pool...")
    pool = build_player_pool(conn, season)
    if not pool:
        raise ValueError(f"No player data found for season {season}")

    log.info("Building weekly distributions (n_samples=%d)...", n_samples)
    distributions = build_weekly_distributions(pool, n_samples=n_samples, rng=rng)

    # Filter ADP list to players in our distribution pool
    adp_in_pool = [p for p in adp_players if p.get("slug") in distributions]
    log.info("ADP players in distribution pool: %d", len(adp_in_pool))

    results: dict[int, dict] = {}
    for ls in league_sizes:
        log.info("Simulating league_size=%d (%d leagues × %d weeks)...", ls, n_leagues, n_weeks)
        results[ls] = simulate_league_size(
            adp_in_pool, distributions, ls, n_leagues, n_weeks, rng=rng
        )

    return results
