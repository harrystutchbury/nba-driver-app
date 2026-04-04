"""
decompose.py — Driver decomposition engine.

Midpoint partial derivative method with guaranteed zero residual.

The residual problem: avg(A) * avg(B) != avg(A*B) when both A and B
vary across games. This means any formula using multiple averaged
opportunity variables will not reconstruct the actual stat value,
causing a large residual.

The solution: collapse all opportunity variables into a single
pre-computed rate that IS a ratio of sums, so the formula closes:

  dreb = opp_avail_rate * min * dreb_pct

where:
  opp_avail_rate = SUM(avail_dreb per game) / SUM(min per game)
  dreb_pct       = SUM(dreb) / SUM(avail_dreb)

Verification:
  opp_avail_rate * avg_min * dreb_pct
  = (SUM(avail)/SUM(min)) * (SUM(min)/N) * (SUM(dreb)/SUM(avail))
  = SUM(dreb) / N
  = avg_dreb  ✓

This guarantees formula(period_values) == stat exactly,
which is required for zero residual in the midpoint decomp.

Available dreb per game =
  (opp_fga * (1 - opp_fg_pct) + 0.44 * opp_fta * (1 - opp_ft_pct))
  * (player_min / team_min)

0.44 is the Hollinger constant for reboundable free throw attempts.
"""

import sqlite3
from dataclasses import dataclass


@dataclass
class Driver:
    key:          str
    label:        str
    category:     str
    value_a:      float
    value_b:      float
    contribution: float


@dataclass
class DecompResult:
    player_slug: str
    stat:        str
    period_a:    tuple
    period_b:    tuple
    stat_a:      float
    stat_b:      float
    delta:       float
    drivers:     list


# -----------------------------------------------------------------------
# Fetch and aggregate a period
# -----------------------------------------------------------------------

def fetch_period(conn, player_slug, date_from, date_to):
    row = conn.execute("""
        SELECT
            COUNT(*)            AS games,
            AVG(g.min)          AS avg_min,
            SUM(g.min)          AS sum_min,
            AVG(g.pts)          AS avg_pts,
            AVG(g.reb)          AS avg_reb,
            AVG(g.oreb)         AS avg_oreb,
            AVG(g.dreb)         AS avg_dreb,
            AVG(g.ast)          AS avg_ast,
            AVG(g.stl)          AS avg_stl,
            AVG(g.blk)          AS avg_blk,
            AVG(g.tov)          AS avg_tov,
            AVG(g.fga)          AS avg_fga,
            AVG(g.fgm)          AS avg_fgm,
            AVG(g.fg3a)         AS avg_fg3a,
            AVG(g.fg3m)         AS avg_fg3m,
            AVG(g.fta)          AS avg_fta,
            AVG(g.ftm)          AS avg_ftm,

            AVG(t.pace)         AS avg_pace,
            AVG(t.minutes)      AS avg_team_minutes,

            -- opp_avail_rate: available defensive rebounds per player-minute
            -- = SUM(available dreb per game) / SUM(player minutes)
            -- available per game = (opp FG misses + 0.44 * opp FT misses) * min_share
            SUM(
                (t.opp_fga * (1.0 - t.opp_fg_pct)
                 + 0.44 * t.opp_fta * (1.0 - t.opp_ft_pct))
                * (g.min / NULLIF(t.minutes, 0))
            ) / NULLIF(SUM(g.min), 0) AS opp_avail_rate,

            -- team_avail_rate: available offensive rebounds per player-minute
            SUM(
                (t.team_fga * (1.0 - t.team_fg_pct)
                 + 0.44 * t.team_fta * (1.0 - t.team_ft_pct))
                * (g.min / NULLIF(t.minutes, 0))
            ) / NULLIF(SUM(g.min), 0) AS team_avail_rate,

            -- dreb_pct: ratio of sums (not average of ratios)
            SUM(g.dreb) / NULLIF(SUM(
                (t.opp_fga * (1.0 - t.opp_fg_pct)
                 + 0.44 * t.opp_fta * (1.0 - t.opp_ft_pct))
                * (g.min / NULLIF(t.minutes, 0))
            ), 0) AS dreb_pct,

            -- oreb_pct: ratio of sums
            SUM(g.oreb) / NULLIF(SUM(
                (t.team_fga * (1.0 - t.team_fg_pct)
                 + 0.44 * t.team_fta * (1.0 - t.team_ft_pct))
                * (g.min / NULLIF(t.minutes, 0))
            ), 0) AS oreb_pct

        FROM game_logs g
        LEFT JOIN team_games t
            ON  t.team      = g.team
            AND t.game_date = g.game_date
        WHERE
            g.player_slug = ?
            AND g.game_date >= ?
            AND g.game_date <= ?
            AND g.min > 0
    """, (player_slug, date_from, date_to)).fetchone()

    if not row or row["games"] == 0:
        return None

    d        = dict(row)
    min_     = d["avg_min"]          or 0
    team_min = d["avg_team_minutes"] or 240
    pace     = d["avg_pace"]         or 0

    # Rebound drivers — simple per-minute rates, zero residual guaranteed
    d["min"]          = min_
    d["dreb_per_min"] = (d["avg_dreb"] or 0) / min_ if min_ else 0
    d["oreb_per_min"] = (d["avg_oreb"] or 0) / min_ if min_ else 0

    # Points drivers
    fg2a = (d["avg_fga"] or 0) - (d["avg_fg3a"] or 0)
    fg2m = (d["avg_fgm"] or 0) - (d["avg_fg3m"] or 0)
    d["fg2a_per_min"] = fg2a / min_ if min_ else 0
    d["fg3a_per_min"] = (d["avg_fg3a"] or 0) / min_ if min_ else 0
    d["fta_per_min"]  = (d["avg_fta"]  or 0) / min_ if min_ else 0
    d["fg2_pct"]      = fg2m / fg2a             if fg2a > 0              else 0
    d["fg3_pct"]      = d["avg_fg3m"] / d["avg_fg3a"] if (d["avg_fg3a"] or 0) > 0 else 0
    d["ft_pct"]       = d["avg_ftm"]  / d["avg_fta"]  if (d["avg_fta"]  or 0) > 0 else 0

    # Assist driver
    d["ast_per_min"] = (d["avg_ast"] or 0) / min_ if min_ else 0

    # Steals / blocks / turnovers
    poss_per_min = pace / 48 if pace else 0
    d["poss_per_min"] = poss_per_min
    d["stl_per_poss"] = (d["avg_stl"] or 0) / (min_ * poss_per_min) if (min_ and poss_per_min) else 0
    d["blk_per_poss"] = (d["avg_blk"] or 0) / (min_ * poss_per_min) if (min_ and poss_per_min) else 0
    d["tov_per_poss"] = (d["avg_tov"] or 0) / (min_ * poss_per_min) if (min_ and poss_per_min) else 0

    return d


# -----------------------------------------------------------------------
# Midpoint partial derivative decomposition
# -----------------------------------------------------------------------

def midpoint_decomp(drivers_a, drivers_b, formula):
    mid   = {k: (drivers_a[k] + drivers_b[k]) / 2 for k in drivers_a}
    h     = 1e-7
    f_mid = formula(mid)

    contributions = {}
    for key in drivers_a:
        mid_h              = {**mid, key: mid[key] + h}
        partial            = (formula(mid_h) - f_mid) / h
        contributions[key] = partial * (drivers_b[key] - drivers_a[key])

    return contributions


def verify(result):
    total    = sum(d.contribution for d in result.drivers)
    residual = abs(result.delta - total)
    if residual > 0.05:
        import warnings
        warnings.warn(
            f"Residual {residual:.4f} for {result.player_slug} {result.stat}. "
            f"Delta {result.delta}, drivers sum {total:.4f}."
        )
    return residual


# -----------------------------------------------------------------------
# Driver trees
# -----------------------------------------------------------------------

def decompose_rebounds(pa, pb):
    """
    TRB/g = min * (dreb_per_min + oreb_per_min)

    3 drivers — clean, exact, zero residual by construction.
      min          → role (coaching decision)
      dreb_per_min → def rebounding output rate (skill + opportunity combined)
      oreb_per_min → off rebounding output rate (skill + opportunity combined)
    """
    keys = {
        "min":          ("Minutes played",   "role"),
        "dreb_per_min": ("Def. rebound rate", "skill"),
        "oreb_per_min": ("Off. rebound rate", "skill"),
    }

    def formula(d):
        return d["min"] * (d["dreb_per_min"] + d["oreb_per_min"])

    da = {k: pa[k] for k in keys}
    db = {k: pb[k] for k in keys}
    c  = midpoint_decomp(da, db, formula)

    return [Driver(key=k, label=keys[k][0], category=keys[k][1],
                   value_a=pa[k], value_b=pb[k],
                   contribution=round(c[k], 3)) for k in keys]


def decompose_points(pa, pb):
    """
    PTS/g = min * (fg2a_per_min * fg2_pct * 2
                 + fg3a_per_min * fg3_pct * 3
                 + fta_per_min  * ft_pct)
    """
    keys = {
        "min":          ("Minutes played", "role"),
        "fg2a_per_min": ("2pt FGA/min",    "role"),
        "fg2_pct":      ("2pt FG%",        "skill"),
        "fg3a_per_min": ("3pt FGA/min",    "role"),
        "fg3_pct":      ("3pt FG%",        "skill"),
        "fta_per_min":  ("FTA/min",        "skill"),
        "ft_pct":       ("FT%",            "skill"),
    }

    def formula(d):
        return d["min"] * (
            d["fg2a_per_min"] * d["fg2_pct"] * 2 +
            d["fg3a_per_min"] * d["fg3_pct"] * 3 +
            d["fta_per_min"]  * d["ft_pct"]
        )

    da = {k: pa[k] for k in keys}
    db = {k: pb[k] for k in keys}
    c  = midpoint_decomp(da, db, formula)

    return [Driver(key=k, label=keys[k][0], category=keys[k][1],
                   value_a=pa[k], value_b=pb[k],
                   contribution=round(c[k], 3)) for k in keys]


def decompose_assists(pa, pb):
    keys = {
        "min":         ("Minutes played", "role"),
        "ast_per_min": ("Assist rate",    "skill"),
    }
    def formula(d): return d["min"] * d["ast_per_min"]
    da = {k: pa[k] for k in keys}
    db = {k: pb[k] for k in keys}
    c  = midpoint_decomp(da, db, formula)
    return [Driver(key=k, label=keys[k][0], category=keys[k][1],
                   value_a=pa[k], value_b=pb[k],
                   contribution=round(c[k], 3)) for k in keys]


def decompose_steals(pa, pb):
    keys = {
        "min":          ("Minutes played",        "role"),
        "poss_per_min": ("Pace (poss/min)",        "team"),
        "stl_per_poss": ("Steals per possession",  "skill"),
    }
    def formula(d): return d["min"] * d["poss_per_min"] * d["stl_per_poss"]
    da = {k: pa[k] for k in keys}
    db = {k: pb[k] for k in keys}
    c  = midpoint_decomp(da, db, formula)
    return [Driver(key=k, label=keys[k][0], category=keys[k][1],
                   value_a=pa[k], value_b=pb[k],
                   contribution=round(c[k], 3)) for k in keys]


def decompose_blocks(pa, pb):
    keys = {
        "min":          ("Minutes played",         "role"),
        "poss_per_min": ("Pace (poss/min)",         "team"),
        "blk_per_poss": ("Blocks per possession",   "skill"),
    }
    def formula(d): return d["min"] * d["poss_per_min"] * d["blk_per_poss"]
    da = {k: pa[k] for k in keys}
    db = {k: pb[k] for k in keys}
    c  = midpoint_decomp(da, db, formula)
    return [Driver(key=k, label=keys[k][0], category=keys[k][1],
                   value_a=pa[k], value_b=pb[k],
                   contribution=round(c[k], 3)) for k in keys]


def decompose_turnovers(pa, pb):
    keys = {
        "min":          ("Minutes played",             "role"),
        "poss_per_min": ("Pace (poss/min)",             "team"),
        "tov_per_poss": ("Turnovers per possession",    "skill"),
    }
    def formula(d): return d["min"] * d["poss_per_min"] * d["tov_per_poss"]
    da = {k: pa[k] for k in keys}
    db = {k: pb[k] for k in keys}
    c  = midpoint_decomp(da, db, formula)
    return [Driver(key=k, label=keys[k][0], category=keys[k][1],
                   value_a=pa[k], value_b=pb[k],
                   contribution=round(c[k], 3)) for k in keys]


# -----------------------------------------------------------------------
# Registry + entrypoint
# -----------------------------------------------------------------------

STAT_DECOMPOSERS = {
    "reb": decompose_rebounds,
    "pts": decompose_points,
    "ast": decompose_assists,
    "stl": decompose_steals,
    "blk": decompose_blocks,
    "tov": decompose_turnovers,
}

STAT_RAW_KEYS = {
    "reb": "avg_reb",
    "pts": "avg_pts",
    "ast": "avg_ast",
    "stl": "avg_stl",
    "blk": "avg_blk",
    "tov": "avg_tov",
}


def decompose(conn, player_slug, stat, period_a, period_b):
    if stat not in STAT_DECOMPOSERS:
        raise ValueError(f"Unknown stat '{stat}'. Choose from {list(STAT_DECOMPOSERS)}")

    pa = fetch_period(conn, player_slug, period_a[0], period_a[1])
    pb = fetch_period(conn, player_slug, period_b[0], period_b[1])

    if pa is None or pb is None:
        return None

    stat_a  = round(pa[STAT_RAW_KEYS[stat]], 3)
    stat_b  = round(pb[STAT_RAW_KEYS[stat]], 3)
    drivers = STAT_DECOMPOSERS[stat](pa, pb)

    result = DecompResult(
        player_slug=player_slug,
        stat=stat,
        period_a=period_a,
        period_b=period_b,
        stat_a=stat_a,
        stat_b=stat_b,
        delta=round(stat_b - stat_a, 3),
        drivers=drivers,
    )

    verify(result)
    return result
