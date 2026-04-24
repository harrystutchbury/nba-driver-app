"""
analysis_usage_minutes.py

Two empirical analyses using within-player year-over-year changes:

1. USAGE → EFFICIENCY
   Does higher USG% hurt FG%, 3P%, and points-per-possession?
   Methodology: for each consecutive player-season pair, compute
   delta_usg and delta_efficiency. OLS regression gives the
   slope (efficiency cost per +1% USG).

2. MINUTES → DEFENSIVE RATE
   Do players who get more minutes produce less per-36 on defense
   (REB, STL, BLK)? Hypothesis: fatigue / role dilution means
   defensive rate doesn't scale linearly with playing time.
   Methodology: delta_mpg vs delta_per36 for each defensive stat.

Run from the backend/ directory:
    python analysis_usage_minutes.py
"""

import sys
import os
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schema import get_conn, init_db

# ── Minimum thresholds ────────────────────────────────────────────────────────
MIN_GP        = 20     # games played in a season to qualify
MIN_MPG       = 15     # minimum minutes per game to qualify
MIN_USG       = 10     # minimum usage rate to include (filters out end-of-bench)
MAX_DELTA_USG = 15     # cap USG swings (trades, injuries cause outliers)
MAX_DELTA_MPG = 15     # cap MPG swings


def build_season_rows(conn):
    """
    Return per-player per-season stats including USG% (BR formula).
    Only includes seasons meeting MIN_GP and MIN_MPG thresholds.
    """
    rows = conn.execute("""
        SELECT
            gl.player_slug,
            gl.season,
            COUNT(*)                                        AS gp,
            AVG(gl.min)                                     AS mpg,
            SUM(gl.pts)  / COUNT(*)                         AS pts_pg,
            SUM(gl.reb)  / COUNT(*)                         AS reb_pg,
            SUM(gl.stl)  / COUNT(*)                         AS stl_pg,
            SUM(gl.blk)  / COUNT(*)                         AS blk_pg,
            SUM(gl.tov)  / COUNT(*)                         AS tov_pg,
            SUM(gl.fg3m) / COUNT(*)                         AS fg3m_pg,
            SUM(gl.fga)  / COUNT(*)                         AS fga_pg,
            SUM(gl.fta)  / COUNT(*)                         AS fta_pg,
            -- FG% and 3P% (true shooting over season)
            SUM(gl.fgm) * 100.0 / NULLIF(SUM(gl.fga), 0)   AS fg_pct,
            SUM(gl.fg3m)* 100.0 / NULLIF(SUM(gl.fg3a), 0)  AS fg3_pct,
            SUM(gl.ftm) * 100.0 / NULLIF(SUM(gl.fta), 0)   AS ft_pct,
            -- TS% = pts / (2 * (FGA + 0.44*FTA))
            SUM(gl.pts) * 100.0 / NULLIF(2 * (SUM(gl.fga) + 0.44 * SUM(gl.fta)), 0) AS ts_pct,
            -- USG% numerator/denominator for BR formula
            SUM((gl.fga + 0.44*gl.fta + gl.tov) * (240.0/5))  AS usg_num,
            SUM(gl.min * (tg.team_fga + 0.44*tg.team_fta + tg.team_tov)) AS usg_den
        FROM game_logs gl
        JOIN team_games tg ON tg.team = gl.team AND tg.game_date = gl.game_date
        WHERE gl.min > 0
          AND tg.team_fga IS NOT NULL
        GROUP BY gl.player_slug, gl.season
        HAVING COUNT(*) >= ? AND AVG(gl.min) >= ?
    """, (MIN_GP, MIN_MPG)).fetchall()
    return [dict(r) for r in rows]


def compute_usg(row):
    if row["usg_den"] and row["usg_den"] > 0:
        return 100 * row["usg_num"] / row["usg_den"]
    return None


def per36(stat_pg, mpg):
    """Convert per-game to per-36 minutes."""
    if mpg and mpg > 0:
        return stat_pg * 36 / mpg
    return None


def ols(x, y):
    """Simple OLS: returns (slope, intercept, r, n)."""
    x, y = np.array(x), np.array(y)
    n = len(x)
    if n < 10:
        return None, None, None, n
    xm, ym = x.mean(), y.mean()
    ss_xy = ((x - xm) * (y - ym)).sum()
    ss_xx = ((x - xm) ** 2).sum()
    if ss_xx == 0:
        return None, None, None, n
    slope = ss_xy / ss_xx
    intercept = ym - slope * xm
    y_pred = slope * x + intercept
    ss_res = ((y - y_pred) ** 2).sum()
    ss_tot = ((y - ym) ** 2).sum()
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0
    r = np.sign(slope) * r2 ** 0.5
    return slope, intercept, r, n


def bucket_analysis(deltas_x, deltas_y, label_x, label_y, buckets):
    """
    Show mean delta_y within bins of delta_x.
    buckets: list of (low, high, label) tuples.
    """
    print(f"\n  {label_y} by {label_x} change:")
    print(f"  {'Bucket':<20} {'N':>5}  {'Mean Δ':>9}  {'Median Δ':>10}")
    print("  " + "-" * 48)
    for lo, hi, lbl in buckets:
        mask = [(lo <= dx < hi) for dx in deltas_x]
        ys = [dy for dy, m in zip(deltas_y, mask) if m]
        if ys:
            print(f"  {lbl:<20} {len(ys):>5}  {np.mean(ys):>+9.2f}  {np.median(ys):>+10.2f}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    init_db()
    conn = get_conn()
    rows = build_season_rows(conn)
    conn.close()

    # Index by player → sorted seasons
    by_player = {}
    for r in rows:
        by_player.setdefault(r["player_slug"], []).append(r)
    for slug in by_player:
        by_player[slug].sort(key=lambda r: r["season"])

    # Build consecutive season pairs
    pairs = []
    for slug, seasons in by_player.items():
        for i in range(len(seasons) - 1):
            a, b = seasons[i], seasons[i + 1]
            # Must be consecutive seasons — compare end year (e.g. "2023-24" → 2024)
            end_year = lambda s: int(s.split("-")[0]) + 1
            if end_year(b["season"]) - end_year(a["season"]) != 1:
                continue
            usg_a = compute_usg(a)
            usg_b = compute_usg(b)
            if usg_a is None or usg_b is None:
                continue
            if usg_a < MIN_USG or usg_b < MIN_USG:
                continue
            pairs.append({"a": a, "b": b, "usg_a": usg_a, "usg_b": usg_b})

    print(f"\n{'='*60}")
    print(f"  ANALYSIS: USAGE & MINUTES IMPACT")
    print(f"  {len(pairs)} consecutive player-season pairs")
    print(f"  Thresholds: ≥{MIN_GP}GP, ≥{MIN_MPG} min/g, ≥{MIN_USG}% USG")
    print(f"{'='*60}")

    # ── ANALYSIS 1: Usage → Efficiency ───────────────────────────────────────
    print(f"\n{'─'*60}")
    print("  PART 1: USAGE RATE → SHOOTING EFFICIENCY")
    print(f"{'─'*60}")
    print("  Hypothesis: higher USG% → lower FG%, 3P%, TS%")
    print()

    d_usg, d_fg, d_3p, d_ts, d_pts_per_poss = [], [], [], [], []
    for p in pairs:
        a, b = p["a"], p["b"]
        du = p["usg_b"] - p["usg_a"]
        if abs(du) > MAX_DELTA_USG:
            continue
        for src_d, src_a, src_b in [
            (d_fg,  a["fg_pct"],  b["fg_pct"]),
            (d_3p,  a["fg3_pct"], b["fg3_pct"]),
            (d_ts,  a["ts_pct"],  b["ts_pct"]),
        ]:
            if src_a is not None and src_b is not None:
                src_d.append(src_b - src_a)
            else:
                src_d.append(None)
        d_usg.append(du)

    for label, deltas in [("FG%", d_fg), ("3P%", d_3p), ("TS%", d_ts)]:
        pairs_clean = [(du, dd) for du, dd in zip(d_usg, deltas) if dd is not None]
        if not pairs_clean:
            continue
        xu, yd = zip(*pairs_clean)
        slope, _, r, n = ols(list(xu), list(yd))
        print(f"  {label}:")
        if slope is not None:
            print(f"    slope = {slope:+.3f} pct-pts per +1% USG   (r={r:+.3f}, n={n})")
            print(f"    → +5% USG ≈ {slope*5:+.2f}% {label}")
            print(f"    → +10% USG ≈ {slope*10:+.2f}% {label}")
        bucket_analysis(
            list(xu), list(yd),
            "ΔUSG%", f"Δ{label}",
            [(-15, -5, "USG down >5%"),
             (-5,  -2, "USG down 2-5%"),
             (-2,   2, "USG ±2% (stable)"),
             ( 2,   5, "USG up 2-5%"),
             ( 5,  15, "USG up >5%")]
        )
        print()

    # ── ANALYSIS 2: Minutes → Defensive Rate ─────────────────────────────────
    print(f"\n{'─'*60}")
    print("  PART 2: MINUTES → PER-36 DEFENSIVE PRODUCTION")
    print(f"{'─'*60}")
    print("  Hypothesis: more minutes → lower per-36 DEF rate (fatigue/role)")
    print()

    for stat, label in [("reb_pg", "REB"), ("stl_pg", "STL"), ("blk_pg", "BLK")]:
        d_mpg_list, d_rate_list = [], []
        for p in pairs:
            a, b = p["a"], p["b"]
            dmpg = b["mpg"] - a["mpg"]
            if abs(dmpg) > MAX_DELTA_MPG:
                continue
            r36_a = per36(a[stat], a["mpg"])
            r36_b = per36(b[stat], b["mpg"])
            if r36_a is None or r36_b is None:
                continue
            d_mpg_list.append(dmpg)
            d_rate_list.append(r36_b - r36_a)

        slope, _, r, n = ols(d_mpg_list, d_rate_list)
        print(f"  {label}/36:")
        if slope is not None:
            print(f"    slope = {slope:+.3f} per-36 per +1 min/g   (r={r:+.3f}, n={n})")
            if slope < 0:
                print(f"    → confirms hypothesis: more minutes = lower {label} rate")
            else:
                print(f"    → no degradation detected")
            # What does this imply for projecting minutes increases?
            print(f"    → +5 min/g ≈ {slope*5:+.2f} change in {label}/36")
        bucket_analysis(
            d_mpg_list, d_rate_list,
            "ΔMPG", f"Δ{label}/36",
            [(-15, -5, "MPG down >5"),
             (-5,  -2, "MPG down 2-5"),
             (-2,   2, "MPG ±2 (stable)"),
             ( 2,   5, "MPG up 2-5"),
             ( 5,  15, "MPG up >5")]
        )
        print()

    # ── ANALYSIS 3: Usage → Defensive Output ─────────────────────────────────
    print(f"\n{'─'*60}")
    print("  PART 3: USAGE RATE → DEFENSIVE OUTPUT")
    print(f"{'─'*60}")
    print("  Hypothesis: higher USG% → lower per-36 defensive production (energy cost)")
    print()

    for stat, label in [("reb_pg", "REB"), ("stl_pg", "STL"), ("blk_pg", "BLK")]:
        d_usg_def, d_rate_def = [], []
        for p in pairs:
            a, b = p["a"], p["b"]
            du = p["usg_b"] - p["usg_a"]
            if abs(du) > MAX_DELTA_USG:
                continue
            r36_a = per36(a[stat], a["mpg"])
            r36_b = per36(b[stat], b["mpg"])
            if r36_a is None or r36_b is None:
                continue
            d_usg_def.append(du)
            d_rate_def.append(r36_b - r36_a)

        slope, _, r, n = ols(d_usg_def, d_rate_def)
        print(f"  {label}/36:")
        if slope is not None:
            print(f"    slope = {slope:+.4f} per-36 per +1% USG   (r={r:+.3f}, n={n})")
            print(f"    → +5% USG ≈ {slope*5:+.3f} {label}/36")
            print(f"    → +10% USG ≈ {slope*10:+.3f} {label}/36")
        bucket_analysis(
            d_usg_def, d_rate_def,
            "ΔUSG%", f"Δ{label}/36",
            [(-15, -5, "USG down >5%"),
             (-5,  -2, "USG down 2-5%"),
             (-2,   2, "USG ±2% (stable)"),
             ( 2,   5, "USG up 2-5%"),
             ( 5,  15, "USG up >5%")]
        )
        print()

    # ── ANALYSIS 4: Minutes → FG% and FT% ────────────────────────────────────
    print(f"\n{'─'*60}")
    print("  PART 4: MINUTES → FG% AND FT%")
    print(f"{'─'*60}")
    print("  Hypothesis: more minutes → lower shooting efficiency (fatigue)")
    print()

    for stat, label in [("fg_pct", "FG%"), ("ft_pct", "FT%"), ("fg3_pct", "3P%"), ("ts_pct", "TS%")]:
        d_mpg_sh, d_sh = [], []
        for p in pairs:
            a, b = p["a"], p["b"]
            dmpg = b["mpg"] - a["mpg"]
            if abs(dmpg) > MAX_DELTA_MPG:
                continue
            va, vb = a.get(stat), b.get(stat)
            if va is None or vb is None:
                continue
            d_mpg_sh.append(dmpg)
            d_sh.append(vb - va)

        slope, _, r, n = ols(d_mpg_sh, d_sh)
        print(f"  {label}:")
        if slope is not None:
            print(f"    slope = {slope:+.4f} pct-pts per +1 min/g   (r={r:+.3f}, n={n})")
            print(f"    → +5 min/g ≈ {slope*5:+.2f}% {label}")
            print(f"    → +10 min/g ≈ {slope*10:+.2f}% {label}")
        bucket_analysis(
            d_mpg_sh, d_sh,
            "ΔMPG", f"Δ{label}",
            [(-15, -5, "MPG down >5"),
             (-5,  -2, "MPG down 2-5"),
             (-2,   2, "MPG ±2 (stable)"),
             ( 2,   5, "MPG up 2-5"),
             ( 5,  15, "MPG up >5")]
        )
        print()

    # ── SUMMARY ───────────────────────────────────────────────────────────────
    print(f"\n{'─'*60}")
    print("  SUMMARY")
    print(f"{'─'*60}")


if __name__ == "__main__":
    main()
