"""
aging.py — Parametric per-year aging multipliers for NBA stat projections.

Uses a simple age-bracket model calibrated to typical NBA development curves.
Avoids data-fitting from per-30 population stats, which suffer from selection
bias (only good young players get minutes, flattening the apparent age curve).

Year-over-year rates by age bracket:
  - Counting stats (pts/reb/ast/stl/blk/fg3m): +3-5% through mid-20s, flat at peak, -2-5% from early 30s
  - Turnovers: improve (decrease) when young, worsen when old
  - FG%: small gains through age 27, then slow decline
"""

import numpy as np

# Max year-over-year ratio change attributable to aging alone
RATIO_FLOOR = 0.88
RATIO_CAP   = 1.08


def build_aging_curves(df):
    """
    No-op kept for API compatibility. The parametric model doesn't need training data.
    Returns an empty dict; aging_ratio uses the parametric model directly.
    """
    return {}


def aging_ratio(curves, archetype, stat, current_age, next_age):
    """
    Return the per-year multiplier when a player ages from current_age to next_age.

    Uses a parametric model — see module docstring for rates.
    The ratio is clamped to [RATIO_FLOOR, RATIO_CAP].
    """
    years = float(next_age) - float(current_age)
    age   = float(current_age)

    if stat == 'tov':
        # Turnovers: fewer is better. Young players improve (ratio < 1), veterans get worse.
        if age < 24:
            rate = 0.96
        elif age < 27:
            rate = 0.98
        elif age < 30:
            rate = 1.00
        elif age < 33:
            rate = 1.02
        else:
            rate = 1.04

    elif stat == 'fg_pct':
        if age < 24:
            rate = 1.006
        elif age < 27:
            rate = 1.003
        elif age < 32:
            rate = 1.000
        elif age < 35:
            rate = 0.997
        else:
            rate = 0.993

    else:
        # Counting stats: pts, reb, ast, stl, blk, fg3m
        if age < 22:
            rate = 1.050
        elif age < 24:
            rate = 1.035
        elif age < 26:
            rate = 1.020
        elif age < 28:
            rate = 1.008
        elif age < 30:
            rate = 0.998
        elif age < 32:
            rate = 0.985
        elif age < 34:
            rate = 0.968
        else:
            rate = 0.950

    ratio = rate ** years
    return float(np.clip(ratio, RATIO_FLOOR, RATIO_CAP))
