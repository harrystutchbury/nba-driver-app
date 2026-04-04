"""
training_data.py — Build the per-30 player-season training dataset.

Each row is a qualifying player-season with:
  - Per-30 rate stats: pts, reb, ast, stl, blk, tov, fg3m
  - Efficiency: fg_pct, ft_pct
  - Shot diet zone frequencies (5 canonical zones)
  - age: player age on October 1 of the season start year
  - position_group: G / F / C (from player_bio)
  - next_* columns: following season's per-30 stats (regression targets)

Filters:
  - MIN_GAMES   >= 20 games played in season
  - MIN_MINUTES >= 15 min/game average

Usage:
    from engine.training_data import build_dataset, FEATURE_COLS, TARGET_COLS
    df = build_dataset(conn)
"""

import pandas as pd
from datetime import date

MIN_GAMES   = 20
MIN_MINUTES = 15
RATE_SCALE  = 30   # per-30 minutes

STAT_COLS = ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fg3m']
ZONES     = ['restricted_area', 'paint_non_ra', 'mid_range', 'corner_3', 'above_break_3']

# position_group encoded as numeric for clustering (G=0, F=1, C=2)
POSITION_ENCODING = {'G': 0, 'F': 1, 'C': 2}

FEATURE_COLS = (
    [f'p30_{c}' for c in STAT_COLS]
    + ['fg_pct', 'ft_pct']
    + [f'freq_{z}' for z in ZONES]
    + ['age', 'position_enc']
)

TARGET_COLS = [f'next_{c}' for c in STAT_COLS] + ['next_fg_pct', 'next_ft_pct']


def build_dataset(conn):
    """
    Return a DataFrame of qualifying player-seasons.
    Rows without a following season have null next_* columns — useful for
    current-season players whose projection is the output, not an input.
    """
    # ------------------------------------------------------------------
    # 1. Per-season aggregates from game_logs
    # ------------------------------------------------------------------
    rows = conn.execute("""
        SELECT
            player_slug,
            season,
            COUNT(*)                                  AS gp,
            AVG(min)                                  AS min_pg,
            SUM(min)                                  AS total_min,
            SUM(pts)                                  AS total_pts,
            SUM(reb)                                  AS total_reb,
            SUM(ast)                                  AS total_ast,
            SUM(stl)                                  AS total_stl,
            SUM(blk)                                  AS total_blk,
            SUM(tov)                                  AS total_tov,
            SUM(fg3m)                                 AS total_fg3m,
            SUM(fgm) * 100.0 / NULLIF(SUM(fga), 0)   AS fg_pct,
            SUM(ftm) * 100.0 / NULLIF(SUM(fta), 0)   AS ft_pct
        FROM game_logs
        WHERE min > 0
        GROUP BY player_slug, season
        HAVING COUNT(*) >= ? AND AVG(min) >= ?
    """, [MIN_GAMES, MIN_MINUTES]).fetchall()

    df = pd.DataFrame([dict(r) for r in rows])
    if df.empty:
        return df

    # Per-30 rate stats
    for col in STAT_COLS:
        df[f'p30_{col}'] = df[f'total_{col}'] / df['total_min'] * RATE_SCALE

    df = df.drop(columns=[f'total_{col}' for col in STAT_COLS] + ['total_min'])

    # ------------------------------------------------------------------
    # 2. Shot diet from shot_logs
    # ------------------------------------------------------------------
    shot_rows = conn.execute("""
        SELECT player_slug, season, zone, COUNT(*) AS fga
        FROM shot_logs
        GROUP BY player_slug, season, zone
    """).fetchall()

    shot_df = pd.DataFrame([dict(r) for r in shot_rows])
    if not shot_df.empty:
        shot_pivot = (
            shot_df
            .pivot_table(index=['player_slug', 'season'], columns='zone', values='fga', fill_value=0)
            .reset_index()
        )
        for z in ZONES:
            if z not in shot_pivot.columns:
                shot_pivot[z] = 0
        zone_totals = shot_pivot[ZONES].sum(axis=1)
        for z in ZONES:
            shot_pivot[f'freq_{z}'] = shot_pivot[z] / zone_totals.replace(0, float('nan'))
        shot_pivot = shot_pivot[['player_slug', 'season'] + [f'freq_{z}' for z in ZONES]]
        df = df.merge(shot_pivot, on=['player_slug', 'season'], how='left')
    else:
        for z in ZONES:
            df[f'freq_{z}'] = float('nan')

    # ------------------------------------------------------------------
    # 3. Age and position from player_bio
    # ------------------------------------------------------------------
    bio_rows = conn.execute("""
        SELECT b.br_slug, b.birthdate, b.position_group
        FROM player_bio b
        WHERE b.birthdate IS NOT NULL
    """).fetchall()
    bio_df = pd.DataFrame([dict(r) for r in bio_rows])

    if not bio_df.empty:
        df = df.merge(bio_df, left_on='player_slug', right_on='br_slug', how='left')
        df = df.drop(columns='br_slug')

        # Age = years on October 1 of the season start year
        # Season '2024-25' starts year = 2024, so oct_1 = 2024-10-01
        def age_on_oct1(row):
            if not row['birthdate']:
                return float('nan')
            try:
                bd        = date.fromisoformat(row['birthdate'])
                season_yr = int(row['season'][:4])
                oct1      = date(season_yr, 10, 1)
                age       = (oct1 - bd).days / 365.25
                # Sanity check — flag bad NBA API ID mappings (e.g. player confused with parent)
                return age if 15 <= age <= 50 else float('nan')
            except Exception:
                return float('nan')

        df['age'] = df.apply(age_on_oct1, axis=1)
    else:
        df['age']            = float('nan')
        df['position_group'] = None

    df['position_enc'] = df['position_group'].map(POSITION_ENCODING)

    # ------------------------------------------------------------------
    # 4. Attach next-season targets
    # ------------------------------------------------------------------
    next_cols = {f'p30_{c}': f'next_{c}' for c in STAT_COLS}
    next_cols.update({'fg_pct': 'next_fg_pct', 'ft_pct': 'next_ft_pct'})

    targets = (
        df[['player_slug', 'season'] + list(next_cols.keys())]
        .rename(columns=next_cols)
        .copy()
    )
    targets['season'] = targets['season'].apply(_prev_season)

    df = df.merge(targets, on=['player_slug', 'season'], how='left')

    return df.sort_values(['player_slug', 'season']).reset_index(drop=True)


def _prev_season(season: str) -> str:
    """Shift a season label back one year. '2024-25' -> '2023-24'."""
    start = int(season[:4])
    return f"{start - 1}-{str(start)[2:]}"


# ------------------------------------------------------------------
# Quick validation
# ------------------------------------------------------------------
if __name__ == '__main__':
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from schema import get_conn

    conn = get_conn()
    df   = build_dataset(conn)
    conn.close()

    n_total   = len(df)
    n_targets = df['next_pts'].notna().sum()
    seasons   = sorted(df['season'].unique())

    print(f"Player-seasons:          {n_total}")
    print(f"  with next-season data: {n_targets}  ({n_targets/n_total*100:.0f}%)")
    print(f"  current season only:   {n_total - n_targets}")
    print(f"Seasons covered:         {seasons[0]} → {seasons[-1]}")
    print(f"\nPer-30 averages across all rows:")
    print(df[[f'p30_{c}' for c in STAT_COLS]].mean().round(2).to_string())
    print(f"\nShot diet coverage:  {df['freq_restricted_area'].notna().sum()} / {n_total}")
    print(f"Age coverage:        {df['age'].notna().sum()} / {n_total}")
    print(f"Position coverage:   {df['position_group'].notna().sum()} / {n_total}")
    print(f"\nAge range:  {df['age'].min():.1f} – {df['age'].max():.1f}  "
          f"(mean {df['age'].mean():.1f})")
    print(f"\nPosition breakdown:")
    print(df['position_group'].value_counts().to_string())
    print(f"\nSample row:")
    print(df[FEATURE_COLS + TARGET_COLS].dropna().iloc[0])
