"""
cluster.py — Cluster NBA player-seasons into archetypes.

Pipeline:
  1. Build dataset via training_data.build_dataset()
  2. Impute missing values (median)
  3. StandardScaler -> PCA (retain 95% variance)
  4. KMeans with k selected by silhouette score (search k=4..14)
  5. Save cluster labels to player_clusters table
  6. Print cluster profiles

Usage:
    python engine/cluster.py              # fit, save, print profiles
    python engine/cluster.py --k 10      # force a specific k
"""

import argparse
import os
import sys

import numpy as np
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.impute import SimpleImputer
from sklearn.metrics import silhouette_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from schema import get_conn
from engine.training_data import build_dataset, FEATURE_COLS, STAT_COLS, ZONES

RANDOM_STATE = 42
K_RANGE      = range(4, 15)

# Feature weights applied before StandardScaler.
# Multiplying a feature by N gives it N times the influence on PCA/clustering.
FEATURE_WEIGHTS = {
    'p30_pts':              1.0,
    'p30_reb':              1.0,
    'p30_ast':              2.0,
    'p30_stl':              1.0,
    'p30_blk':              1.0,
    'p30_tov':              0.0,   # excluded
    'p30_fg3m':             2.0,
    'fg_pct':               1.0,
    'ft_pct':               0.0,   # excluded
    'freq_restricted_area': 0.0,   # excluded
    'freq_paint_non_ra':    0.0,   # excluded
    'freq_mid_range':       0.0,   # excluded
    'freq_corner_3':        0.0,   # excluded
    'freq_above_break_3':   0.0,   # excluded
    'age':                  0.0,   # excluded
    'position_enc':         2.5,
}


def fit_clusters(df, k=None):
    """
    Fit clustering pipeline on FEATURE_COLS.
    Returns (pipeline, labels, chosen_k, silhouette).
    """
    X = df[FEATURE_COLS].values

    imputer = SimpleImputer(strategy='median')
    scaler  = StandardScaler()
    pca     = PCA(n_components=0.95, random_state=RANDOM_STATE)

    X_imp    = imputer.fit_transform(X)
    X_scaled = scaler.fit_transform(X_imp)

    # Apply feature weights AFTER scaling so StandardScaler doesn't cancel them out
    weights  = np.array([FEATURE_WEIGHTS.get(col, 1.0) for col in FEATURE_COLS])
    X_scaled = X_scaled * weights

    X_pca    = pca.fit_transform(X_scaled)

    print(f"PCA: {X_pca.shape[1]} components retain 95% variance "
          f"(from {len(FEATURE_COLS)} features)")

    if k is not None:
        km     = KMeans(n_clusters=k, random_state=RANDOM_STATE, n_init=20)
        labels = km.fit_predict(X_pca)
        sil    = silhouette_score(X_pca, labels)
        print(f"Forced k={k}  silhouette={sil:.4f}")
    else:
        best_k, best_sil, best_labels, best_km = None, -1, None, None
        for ki in K_RANGE:
            km     = KMeans(n_clusters=ki, random_state=RANDOM_STATE, n_init=20)
            labels = km.fit_predict(X_pca)
            sil    = silhouette_score(X_pca, labels)
            print(f"  k={ki:2d}  silhouette={sil:.4f}")
            if sil > best_sil:
                best_k, best_sil, best_labels, best_km = ki, sil, labels, km
        k, labels, sil = best_k, best_labels, best_sil
        km = best_km
        print(f"\nBest k={k}  silhouette={sil:.4f}")

    pipeline = Pipeline([
        ('imputer', imputer),
        ('scaler',  scaler),
        ('pca',     pca),
        ('kmeans',  km),
    ])

    return pipeline, labels, k, sil


def save_clusters(conn, df, labels):
    """Upsert (player_slug, season, cluster_id) into player_clusters table."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS player_clusters (
            player_slug TEXT NOT NULL,
            season      TEXT NOT NULL,
            cluster_id  INTEGER NOT NULL,
            PRIMARY KEY (player_slug, season)
        )
    """)
    rows = [
        (row['player_slug'], row['season'], int(label))
        for (_, row), label in zip(df.iterrows(), labels)
    ]
    conn.executemany("""
        INSERT INTO player_clusters (player_slug, season, cluster_id)
        VALUES (?, ?, ?)
        ON CONFLICT(player_slug, season) DO UPDATE SET cluster_id = excluded.cluster_id
    """, rows)
    conn.commit()
    print(f"Saved {len(rows)} cluster assignments to player_clusters table.")


def print_profiles(df, labels, k):
    """Print mean per-30 stats and shot diet per cluster, sorted by pts."""
    df = df.copy()
    df['cluster_id'] = labels

    display_cols = (
        [f'p30_{c}' for c in STAT_COLS]
        + ['fg_pct', 'ft_pct']
        + [f'freq_{z}' for z in ZONES]
        + ['age', 'min_pg']
    )

    profiles = df.groupby('cluster_id')[display_cols].mean()
    profiles = profiles.sort_values('p30_pts', ascending=False)

    # Count players per cluster
    counts = df.groupby('cluster_id').size().rename('n')
    profiles = profiles.join(counts)

    print(f"\n{'='*80}")
    print(f"CLUSTER PROFILES  (k={k}, sorted by pts/30)")
    print(f"{'='*80}")
    for cid, row in profiles.iterrows():
        print(f"\nCluster {cid}  (n={int(row['n'])})")
        print(f"  Per-30:  "
              f"pts={row[f'p30_pts']:.1f}  reb={row['p30_reb']:.1f}  ast={row['p30_ast']:.1f}  "
              f"stl={row['p30_stl']:.1f}  blk={row['p30_blk']:.1f}  tov={row['p30_tov']:.1f}  "
              f"3pm={row['p30_fg3m']:.1f}")
        print(f"  Eff:     fg%={row['fg_pct']:.1f}  ft%={row['ft_pct']:.1f}")
        print(f"  Diet:    "
              f"RA={row['freq_restricted_area']:.0%}  "
              f"paint={row['freq_paint_non_ra']:.0%}  "
              f"mid={row['freq_mid_range']:.0%}  "
              f"c3={row['freq_corner_3']:.0%}  "
              f"ab3={row['freq_above_break_3']:.0%}")
        print(f"  Avg min: {row['min_pg']:.1f}  avg age: {row['age']:.1f}")

    # Show 5 example players per cluster (most recent season)
    print(f"\n{'='*80}")
    print("EXAMPLE PLAYERS PER CLUSTER (most recent season)")
    print(f"{'='*80}")
    latest = df.sort_values('season', ascending=False).groupby(['cluster_id', 'player_slug']).first().reset_index()
    for cid in sorted(profiles.index):
        examples = (
            latest[latest['cluster_id'] == cid]
            .sort_values('p30_pts', ascending=False)
            .head(5)
        )
        names = ', '.join(
            f"{r['player_slug']} ({r['season']})"
            for _, r in examples.iterrows()
        )
        print(f"Cluster {cid}: {names}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--k', type=int, default=None, help='Force number of clusters')
    args = parser.parse_args()

    conn = get_conn()
    df   = build_dataset(conn)

    print(f"Fitting clusters on {len(df)} player-seasons, {len(FEATURE_COLS)} features...")
    _, labels, k, _ = fit_clusters(df, k=args.k)

    save_clusters(conn, df, labels)
    print_profiles(df, labels, k)

    conn.close()
