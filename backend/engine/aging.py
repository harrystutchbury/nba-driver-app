"""
aging.py — Smooth per-archetype aging curves.

Fits a quadratic with peak constrained to ages 26-30 per archetype per stat.
Used in the projection loop to apply smooth year-over-year aging adjustments
on top of the Ridge model's baseline predictions.
"""

import numpy as np

PEAK_MIN  = 26
PEAK_MAX  = 30
MIN_OBS   = 3          # minimum data points per age bucket to include
AGE_RANGE = range(18, 42)

# Stats we build curves for (mapping label → training_data column)
AGING_STATS = {
    'pts':   'p30_pts',
    'reb':   'p30_reb',
    'ast':   'p30_ast',
    'stl':   'p30_stl',
    'blk':   'p30_blk',
    'tov':   'p30_tov',
    'fg3m':  'p30_fg3m',
    'fg_pct': 'fg_pct',
}

# Max year-over-year ratio change attributable to aging alone
RATIO_FLOOR = 0.88
RATIO_CAP   = 1.08


def _fit_quadratic(obs_ages, obs_vals, peak_min=PEAK_MIN, peak_max=PEAK_MAX):
    """
    Fit y = a*(x - p)^2 + k  where p (peak age) is in [peak_min, peak_max].

    Strategy:
    1. Fit unconstrained quadratic.
    2. If the vertex is already a downward-opening parabola inside the valid
       range, keep it.
    3. Otherwise clamp the peak to the nearest bound and refit with that
       fixed peak.

    Returns a callable  age -> predicted_value.
    """
    ages = np.array(obs_ages, dtype=float)
    vals = np.array(obs_vals, dtype=float)

    if len(ages) < 3:
        coeffs = np.polyfit(ages, vals, 1)
        return np.poly1d(coeffs)

    coeffs = np.polyfit(ages, vals, 2)
    a, b, _ = coeffs

    # vertex of unconstrained fit
    vertex_age = -b / (2 * a) if a != 0 else float('inf')

    if a < 0 and peak_min <= vertex_age <= peak_max:
        # Already a valid downward-opening parabola with peak in range — keep it
        return np.poly1d(coeffs)

    # Determine constrained peak
    if a < 0:
        # Parabola opens downward but peak is outside [26, 30] → clamp
        p = float(np.clip(vertex_age, peak_min, peak_max))
    else:
        # Parabola opens upward (monotonic in data range) → force peak to midpoint
        p = float((peak_min + peak_max) / 2)

    # Refit: y = a_new*(x - p)^2 + k   (linear in [a_new, k])
    X = np.column_stack([(ages - p) ** 2, np.ones_like(ages)])
    try:
        (a_new, k), *_ = np.linalg.lstsq(X, vals, rcond=None)
    except np.linalg.LinAlgError:
        return np.poly1d(coeffs)

    # Ensure it opens downward (aging curves must eventually decline)
    if a_new > 0:
        a_new = -1e-4   # near-flat but technically declining

    def curve(age):
        return float(a_new * (float(age) - p) ** 2 + k)

    return curve


def build_aging_curves(df):
    """
    Build smooth aging curves for every archetype × stat combination.

    Parameters
    ----------
    df : DataFrame from build_dataset() with 'archetype' and 'age' columns.

    Returns
    -------
    dict  {archetype: {stat_label: callable(age) -> value}}
    """
    df = df.copy()
    df = df.dropna(subset=['archetype', 'age'])
    df['age'] = df['age'].astype(int)

    curves = {}
    for arch in df['archetype'].dropna().unique():
        sub = df[df['archetype'] == arch]
        curves[arch] = {}

        for stat, col in AGING_STATS.items():
            if col not in sub.columns:
                continue

            obs_ages, obs_vals = [], []
            for age in AGE_RANGE:
                bucket = sub[sub['age'] == age][col].dropna()
                if len(bucket) >= MIN_OBS:
                    obs_ages.append(age)
                    obs_vals.append(float(bucket.mean()))

            if len(obs_ages) < 4:
                continue

            curves[arch][stat] = _fit_quadratic(obs_ages, obs_vals)

    return curves


def aging_ratio(curves, archetype, stat, current_age, next_age):
    """
    Return the multiplier to apply to a stat when a player ages from
    current_age to next_age, based on the smooth aging curve.

    Returns 1.0 if no curve is available for this archetype/stat.
    The ratio is clamped to [RATIO_FLOOR, RATIO_CAP] per year.
    """
    curve = curves.get(archetype, {}).get(stat)
    if curve is None:
        return 1.0

    cur_val  = curve(current_age)
    next_val = curve(next_age)

    if cur_val is None or abs(cur_val) < 1e-6:
        return 1.0

    ratio = next_val / cur_val
    return float(np.clip(ratio, RATIO_FLOOR, RATIO_CAP))
