"""
engine/shots.py — Shot diet decomposition.

Decomposes the change in FG% between two periods into:
  - Diet effect:       did the player take more shots from efficient spots?
  - Efficiency effect: did they shoot better from those spots?

Formula:
  FG% = Σ_zones (zone_freq × zone_fg_pct)

  ΔFG% = diet_effect + efficiency_effect
       = Σ (Δzone_freq × avg_zone_fg_pct)
       + Σ (avg_zone_freq × Δzone_fg_pct)

  Uses the same midpoint partial derivative approach as the main engine
  so the two effects sum exactly to ΔFG% with zero residual.

Zones (5 canonical):
  restricted_area   — layups/dunks at the rim
  paint_non_ra      — floaters, short mid-post
  mid_range         — elbow, baseline, extended paint
  corner_3          — corner threes (left + right combined)
  above_break_3     — top-of-key and wing threes
"""

from dataclasses import dataclass


ZONE_LABELS = {
    "restricted_area": "Restricted area",
    "paint_non_ra":    "Paint (non-RA)",
    "mid_range":       "Mid-range",
    "corner_3":        "Corner 3",
    "above_break_3":   "Above-break 3",
}

ALL_ZONES = list(ZONE_LABELS.keys())


@dataclass
class ZoneStats:
    zone:      str
    label:     str
    fga_a:     int
    fgm_a:     int
    fg_pct_a:  float
    freq_a:    float       # share of total FGA
    fga_b:     int
    fgm_b:     int
    fg_pct_b:  float
    freq_b:    float
    diet_effect:       float   # contribution to ΔFG% from freq change
    efficiency_effect: float   # contribution to ΔFG% from pct change


@dataclass
class ShotDietResult:
    player_slug: str
    period_a:    tuple
    period_b:    tuple
    fg_pct_a:    float
    fg_pct_b:    float
    delta:       float
    diet_total:       float
    efficiency_total: float
    zones:       list   # list[ZoneStats]


# -----------------------------------------------------------------------
# Fetch aggregated zone stats for a period
# -----------------------------------------------------------------------

def fetch_zone_period(conn, player_slug, date_from, date_to):
    """
    Returns {zone: {fga, fgm}} for the period.
    Uses shot_logs joined to player_id_map on br_slug.
    """
    rows = conn.execute("""
        SELECT s.zone, COUNT(*) AS fga, SUM(s.made) AS fgm
        FROM shot_logs s
        INNER JOIN player_id_map m ON m.nba_id = s.nba_id
        WHERE m.br_slug  = ?
          AND s.game_date >= ?
          AND s.game_date <= ?
        GROUP BY s.zone
    """, (player_slug, date_from, date_to)).fetchall()

    if not rows:
        return None

    return {r["zone"]: {"fga": r["fga"], "fgm": r["fgm"]} for r in rows}


# -----------------------------------------------------------------------
# Decompose
# -----------------------------------------------------------------------

def decompose_shots(conn, player_slug, period_a, period_b):
    pa_raw = fetch_zone_period(conn, player_slug, period_a[0], period_a[1])
    pb_raw = fetch_zone_period(conn, player_slug, period_b[0], period_b[1])

    if pa_raw is None or pb_raw is None:
        return None

    total_fga_a = sum(z["fga"] for z in pa_raw.values())
    total_fga_b = sum(z["fgm"] for z in pb_raw.values())  # actually fga
    total_fga_b = sum(z["fga"] for z in pb_raw.values())

    if total_fga_a == 0 or total_fga_b == 0:
        return None

    total_fgm_a = sum(z["fgm"] for z in pa_raw.values())
    total_fgm_b = sum(z["fgm"] for z in pb_raw.values())

    fg_pct_a = total_fgm_a / total_fga_a
    fg_pct_b = total_fgm_b / total_fga_b
    delta    = round(fg_pct_b - fg_pct_a, 4)

    zones = []
    diet_total       = 0.0
    efficiency_total = 0.0

    for zone in ALL_ZONES:
        za = pa_raw.get(zone, {"fga": 0, "fgm": 0})
        zb = pb_raw.get(zone, {"fga": 0, "fgm": 0})

        fga_a = za["fga"]; fgm_a = za["fgm"]
        fga_b = zb["fga"]; fgm_b = zb["fgm"]

        pct_a  = fgm_a / fga_a if fga_a > 0 else 0.0
        pct_b  = fgm_b / fga_b if fga_b > 0 else 0.0
        freq_a = fga_a / total_fga_a
        freq_b = fga_b / total_fga_b

        avg_pct  = (pct_a  + pct_b)  / 2
        avg_freq = (freq_a + freq_b) / 2

        diet_eff       = round((freq_b - freq_a) * avg_pct,  4)
        efficiency_eff = round((pct_b  - pct_a)  * avg_freq, 4)

        diet_total       += diet_eff
        efficiency_total += efficiency_eff

        zones.append(ZoneStats(
            zone=zone,
            label=ZONE_LABELS[zone],
            fga_a=fga_a, fgm_a=fgm_a, fg_pct_a=round(pct_a, 3), freq_a=round(freq_a, 3),
            fga_b=fga_b, fgm_b=fgm_b, fg_pct_b=round(pct_b, 3), freq_b=round(freq_b, 3),
            diet_effect=diet_eff,
            efficiency_effect=efficiency_eff,
        ))

    return ShotDietResult(
        player_slug=player_slug,
        period_a=period_a,
        period_b=period_b,
        fg_pct_a=round(fg_pct_a, 3),
        fg_pct_b=round(fg_pct_b, 3),
        delta=delta,
        diet_total=round(diet_total, 4),
        efficiency_total=round(efficiency_total, 4),
        zones=zones,
    )
