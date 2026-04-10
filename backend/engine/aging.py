"""
aging.py — Data-driven aging curves from within-player year-over-year ratios.

For each consecutive player-season pair in the training data, compute:
    ratio = next_season_per30 / current_season_per30

Average those ratios by age bucket, then fit a smooth quadratic. This avoids
the selection-bias problem of comparing different players at different ages —
instead we track the same players across time.

The resulting curve(age) returns the expected year-over-year multiplier for
a player of that age, e.g. 1.03 at age 23 means players of that age typically
improve ~3% per year in that stat.
"""

import numpy as np

MIN_OBS    = 5     # minimum player-seasons per age bucket
AGE_RANGE  = range(18, 42)

# Max year-over-year ratio change attributable to aging alone
RATIO_FLOOR = 0.88
RATIO_CAP   = 1.08

# Mapping: stat label → (current_col, next_col) in build_dataset() output
_STAT_PAIRS = {
    'pts':    ('p30_pts',  'next_pts'),
    'reb':    ('p30_reb',  'next_reb'),
    'ast':    ('p30_ast',  'next_ast'),
    'stl':    ('p30_stl',  'next_stl'),
    'blk':    ('p30_blk',  'next_blk'),
    'tov':    ('p30_tov',  'next_tov'),
    'fg3m':   ('p30_fg3m', 'next_fg3m'),
    'fg_pct': ('fg_pct',   'next_fg_pct'),
}


def build_aging_curves(df):
    """
    Build per-stat aging curves from within-player year-over-year ratios.

    Parameters
    ----------
    df : DataFrame from build_dataset() — must include p30_* and next_* columns.

    Returns
    -------
    dict  { stat_label: callable(age) -> expected_ratio }
    """
    df = df.copy()
    df = df.dropna(subset=['age'])
    df['age'] = df['age'].astype(int)

    curves = {}
    for stat, (cur_col, nxt_col) in _STAT_PAIRS.items():
        if cur_col not in df.columns or nxt_col not in df.columns:
            continue

        # Keep only rows where both this season and next season exist
        sub = df.dropna(subset=[cur_col, nxt_col]).copy()
        # Avoid division by near-zero
        sub = sub[sub[cur_col].abs() > 0.1]
        sub['ratio'] = sub[nxt_col] / sub[cur_col]
        # Filter extreme outliers (injuries, role explosions, sample noise)
        sub = sub[(sub['ratio'] >= 0.5) & (sub['ratio'] <= 2.0)]

        obs_ages, obs_ratios = [], []
        for age in AGE_RANGE:
            bucket = sub[sub['age'] == age]['ratio']
            if len(bucket) >= MIN_OBS:
                obs_ages.append(age)
                obs_ratios.append(float(bucket.mean()))

        if len(obs_ages) < 4:
            continue

        # Fit a quadratic to (age, mean_ratio) — no peak constraint needed here,
        # the ratio naturally peaks at young ages and crosses 1.0 near the stat peak.
        coeffs = np.polyfit(obs_ages, obs_ratios, 2)
        curves[stat] = np.poly1d(coeffs)

    return curves


def aging_ratio(curves, archetype, stat, current_age, next_age):
    """
    Return the expected year-over-year multiplier for a player aging from
    current_age to next_age.

    The curve at current_age gives the historically observed average ratio
    next_season/current_season for players of that age and stat.
    Clamped to [RATIO_FLOOR, RATIO_CAP].
    """
    curve = curves.get(stat)
    if curve is None:
        return 1.0

    ratio = float(curve(current_age))
    return float(np.clip(ratio, RATIO_FLOOR, RATIO_CAP))
