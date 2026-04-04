"""
regress.py — Per-archetype Ridge regression for next-season stat projection.

For each archetype, fits a Ridge regression predicting next-season per-30
stats from current-season per-30 stats + age. One pipeline per archetype,
one independent Ridge model per target stat (multi-output).

The three C archetypes (scoring big, stretch big, defensive big) share a
single pooled model ("big") — individual samples are too few and too varied
to train reliably in isolation.

Models saved to backend/models/<slug>.joblib

Usage:
    python engine/regress.py          # fit all, save, print R²
    python engine/regress.py --cv 5   # set cross-validation folds (default: 5)
"""

import argparse
import os
import sys

import joblib
import numpy as np
from sklearn.impute import SimpleImputer
from sklearn.linear_model import RidgeCV
from sklearn.model_selection import cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.archetypes import ARCHETYPES, assign_archetypes
from engine.training_data import STAT_COLS, build_dataset
from schema import get_conn

MODELS_DIR = os.environ.get(
    "MODELS_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'models'),
)

# Current-season features fed into the model
REG_FEATURES = [f'p30_{c}' for c in STAT_COLS] + ['fg_pct', 'age']

# Next-season stats we're predicting
REG_TARGETS = [f'next_{c}' for c in STAT_COLS] + ['next_fg_pct']

ALPHAS   = [0.1, 1.0, 10.0, 100.0, 1000.0]
MIN_ROWS = 25

# C archetypes share one pooled model — keeps sample size viable
BIG_ARCHETYPES  = {'scoring big', 'stretch big', 'defensive big'}
POOLED_BIG_NAME = 'big'

# Maps each archetype to the model slug used for regression
MODEL_SLUG = {a: (POOLED_BIG_NAME if a in BIG_ARCHETYPES else a.replace(' ', '_'))
              for a in ARCHETYPES}


def _make_pipeline():
    return Pipeline([
        ('imputer', SimpleImputer(strategy='median')),
        ('scaler',  StandardScaler()),
        ('ridge',   RidgeCV(alphas=ALPHAS)),
    ])


def fit_archetype(df_subset, cv=5):
    """
    Fit a multi-output regression model for one archetype (or pooled group).

    Returns (pipeline, r2_per_target, n_rows) or (None, None, n_rows)
    if there are too few training examples.
    """
    valid = df_subset.dropna(subset=REG_TARGETS)
    n = len(valid)

    if n < MIN_ROWS:
        return None, None, n

    X = valid[REG_FEATURES].values
    Y = valid[REG_TARGETS].values

    pipeline = _make_pipeline()
    pipeline.fit(X, Y)

    folds = min(cv, n)
    r2_per_target = {}
    for i, col in enumerate(REG_TARGETS):
        scores = cross_val_score(
            _make_pipeline(), X, Y[:, i],
            cv=folds, scoring='r2',
        )
        r2_per_target[col] = round(float(scores.mean()), 3)

    return pipeline, r2_per_target, n


def save_model(slug, pipeline, r2_per_target, n_rows):
    os.makedirs(MODELS_DIR, exist_ok=True)
    path = os.path.join(MODELS_DIR, f'{slug}.joblib')
    joblib.dump({
        'slug':     slug,
        'pipeline': pipeline,
        'features': REG_FEATURES,
        'targets':  REG_TARGETS,
        'r2':       r2_per_target,
        'n_train':  n_rows,
    }, path)
    return path


def load_model(archetype):
    """Load the regression model for a given archetype. Returns the stored dict."""
    slug = MODEL_SLUG[archetype]
    path = os.path.join(MODELS_DIR, f'{slug}.joblib')
    return joblib.load(path)


def predict(archetype, current_stats: dict) -> dict:
    """
    Project next-season per-30 stats for a player.

    Args:
        archetype:     one of ARCHETYPES
        current_stats: dict with keys matching REG_FEATURES

    Returns:
        dict mapping each REG_TARGET to a projected float
    """
    obj      = load_model(archetype)
    pipeline = obj['pipeline']
    features = obj['features']

    X = np.array([[current_stats.get(f, np.nan) for f in features]])
    Y = pipeline.predict(X)[0]
    return dict(zip(REG_TARGETS, Y))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cv', type=int, default=5, help='Cross-validation folds')
    args = parser.parse_args()

    conn = get_conn()
    df   = build_dataset(conn)
    conn.close()

    df = assign_archetypes(df)

    print(f"\nFitting regression models  (cv={args.cv})\n")
    print(f"{'Model':<20} {'n_train':>7}  " +
          "  ".join(f"{t.replace('next_',''):>6}" for t in REG_TARGETS))
    print('─' * 90)

    # --- individual archetype models (guards + wings) ---
    for archetype in ARCHETYPES:
        if archetype in BIG_ARCHETYPES:
            continue
        subset = df[df['archetype'] == archetype]
        pipeline, r2, n = fit_archetype(subset, cv=args.cv)

        if pipeline is None:
            print(f"{archetype:<20} {'':>7}  (skipped — only {n} rows with next-season data)")
            continue

        save_model(archetype.replace(' ', '_'), pipeline, r2, n)
        r2_str = '  '.join(f"{r2[t]:>6.3f}" for t in REG_TARGETS)
        print(f"{archetype:<20} {n:>7}  {r2_str}")

    # --- pooled big model ---
    big_subset = df[df['archetype'].isin(BIG_ARCHETYPES)]
    pipeline, r2, n = fit_archetype(big_subset, cv=args.cv)

    if pipeline is None:
        print(f"{'big (pooled)':<20} {'':>7}  (skipped — only {n} rows)")
    else:
        save_model(POOLED_BIG_NAME, pipeline, r2, n)
        r2_str = '  '.join(f"{r2[t]:>6.3f}" for t in REG_TARGETS)
        print(f"{'big (pooled)':<20} {n:>7}  {r2_str}")

    print('─' * 90)
    print(f"\nModels saved to {MODELS_DIR}/")
