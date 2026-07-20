"""
aging.py — Manual smooth aging curves per stat.

Each stat is defined by a piecewise linear curve:
  - Before peak_age: linearly tapers from growth_at_20 -> 0
  - After peak_age:  linearly increases from 0 -> decline_at_40

Values are year-over-year % change (positive = improvement, negative = decline).
For tov, positive means MORE turnovers (worse).

Curve params: (peak_age, yoy_pct_at_age_20, yoy_pct_at_age_40)
"""

# (peak_age, growth_pct_at_20, decline_pct_at_40)
_CURVE_PARAMS = {
    'pts':    (27,  +6.0,  -5.5),
    'reb':    (28,  +3.0,  -2.5),
    'ast':    (29,  +7.0,  -2.5),
    'stl':    (25,  +3.0,  -3.0),
    'blk':    (26,  +4.0,  -3.0),
    'tov':    (28,  +2.0,  -1.5),
    'fg3m':   (27,  +7.0,  -4.0),
    'fg_pct': (27,  +2.0,  -2.0),
    'ft_pct': (27,  +0.5,  -0.5),
}

_STATS = list(_CURVE_PARAMS.keys())


def _smooth_yoy(stat, age):
    """Return the year-over-year % change for a stat at a given age."""
    peak, g20, d40 = _CURVE_PARAMS[stat]
    if age <= peak:
        return g20 * (peak - age) / (peak - 20)
    else:
        return d40 * (age - peak) / (40 - peak)


def build_aging_curves(df=None):
    """
    Return the aging curves dict. The df argument is accepted for
    backwards compatibility but is not used — curves are hardcoded.
    """
    return {stat: None for stat in _STATS}


def aging_ratio(curves, archetype, stat, current_age, next_age=None):
    """
    Return the year-over-year multiplier (e.g. 1.03 = +3%) for a player
    of current_age in the given stat.
    """
    if stat not in _CURVE_PARAMS:
        return 1.0
    pct = _smooth_yoy(stat, int(current_age))
    return 1.0 + pct / 100.0


def aging_ratio_std(curves, stat, current_age):
    """
    Return a fixed uncertainty band per stat for optimistic/pessimistic scenarios.
    """
    _STAT_SD = {
        'pts': 0.06, 'reb': 0.04, 'ast': 0.05,
        'stl': 0.04, 'blk': 0.04, 'tov': 0.03,
        'fg3m': 0.06, 'fg_pct': 0.03, 'ft_pct': 0.02,
    }
    return _STAT_SD.get(stat, 0.04)
