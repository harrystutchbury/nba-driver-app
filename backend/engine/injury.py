"""
injury.py — Minute and usage redistribution when a player is out.

Algorithm:
  1. Take the injured player's projected mins and FGA
  2. Walk down the depth chart starting at their position
  3. Each player absorbs up to min(their_mins + MAX_BUMP, MAX_MINS) - their_mins
  4. Overflow cascades to positionally adjacent positions outward
  5. Total team minutes always sum to 240
  6. FGA redistributed proportionally by the same minute weights
  7. All other stats scale by new_mins / baseline_mins
"""

MAX_MINS = 34   # hard per-player ceiling
MAX_BUMP = 8    # max extra minutes any one player absorbs

# Outward adjacency from each position — order matters
POSITION_ADJACENCY = {
    'PG': ['PG', 'SG', 'SF', 'PF', 'C'],
    'SG': ['SG', 'PG', 'SF', 'PF', 'C'],
    'SF': ['SF', 'SG', 'PF', 'PG', 'C'],
    'PF': ['PF', 'SF', 'C',  'SG', 'PG'],
    'C':  ['C',  'PF', 'SF', 'SG', 'PG'],
}

# Broad position groups → canonical 5-man positions
_POS_NORM = {
    'PG': 'PG', 'SG': 'SG', 'SF': 'SF', 'PF': 'PF', 'C': 'C',
    'G':  'SG', 'F':  'SF', 'FC': 'PF', 'CF': 'C',  'GF': 'SF',
    'Guard': 'SG', 'Forward': 'SF', 'Center': 'C',
    'Guard-Forward': 'SF', 'Forward-Center': 'PF',
}


def normalise_position(raw: str) -> str:
    if not raw:
        return 'SF'
    p = raw.strip().upper().split('-')[0].split('/')[0]
    return _POS_NORM.get(p, _POS_NORM.get(raw.strip(), 'SF'))


def redistribute(injured_slug: str, roster: list[dict], depth_order: dict[str, list[str]]) -> dict[str, dict]:
    """
    Redistribute the injured player's minutes and FGA to teammates.

    Parameters
    ----------
    injured_slug : str
        BR slug of the injured player.
    roster : list of dicts
        Each dict must have: slug, position (raw), avg_min, avg_fga.
        Should include the injured player (they are skipped as a recipient).
    depth_order : dict
        Maps canonical position ('PG','SG',...) to ordered list of slugs,
        shallowest (starter) first.

    Returns
    -------
    dict  slug -> {new_min, new_fga, delta_min, delta_fga, min_scale}
        Only players who receive minutes are included.
    """
    by_slug = {p['slug']: p for p in roster}
    injured = by_slug.get(injured_slug)
    if not injured:
        return {}

    mins_pool = float(injured.get('avg_min') or 0)
    fga_pool  = float(injured.get('avg_fga') or 0)
    if mins_pool <= 0:
        return {}

    inj_pos = normalise_position(injured.get('position', ''))
    adjacency = POSITION_ADJACENCY.get(inj_pos, list(POSITION_ADJACENCY['SF']))

    # Build ordered recipient list — depth-chart order within each adjacent position
    seen = set([injured_slug])
    recipients = []
    for pos in adjacency:
        for slug in depth_order.get(pos, []):
            if slug in seen:
                continue
            p = by_slug.get(slug)
            if not p:
                continue
            base_min = float(p.get('avg_min') or 0)
            cap      = min(base_min + MAX_BUMP, MAX_MINS)
            headroom = max(0.0, cap - base_min)
            recipients.append({'slug': slug, 'base_min': base_min,
                                'base_fga': float(p.get('avg_fga') or 0),
                                'headroom': headroom})
            seen.add(slug)

    # Distribute minutes greedily down the list
    deltas: dict[str, float] = {}
    remaining = mins_pool

    for r in recipients:
        if remaining <= 0:
            break
        absorbed = min(r['headroom'], remaining)
        if absorbed > 0:
            deltas[r['slug']] = absorbed
            remaining -= absorbed

    # Edge case: still minutes left (very thin roster).
    # Give them to anyone below MAX_MINS in recipient order.
    if remaining > 0.01:
        for r in recipients:
            if remaining <= 0:
                break
            current = r['base_min'] + deltas.get(r['slug'], 0)
            extra   = min(MAX_MINS - current, remaining)
            if extra > 0:
                deltas[r['slug']] = deltas.get(r['slug'], 0) + extra
                remaining -= extra

    # FGA: distribute proportionally by minute deltas
    total_delta = sum(deltas.values())
    result = {}
    for slug, delta_min in deltas.items():
        p        = by_slug[slug]
        base_min = float(p.get('avg_min') or 0)
        base_fga = float(p.get('avg_fga') or 0)
        new_min  = base_min + delta_min
        delta_fga = fga_pool * (delta_min / total_delta) if total_delta > 0 else 0.0
        new_fga  = base_fga + delta_fga
        min_scale = new_min / base_min if base_min > 0 else 1.0
        result[slug] = {
            'new_min':   round(new_min, 1),
            'new_fga':   round(new_fga, 1),
            'delta_min': round(delta_min, 1),
            'delta_fga': round(delta_fga, 1),
            'min_scale': round(min_scale, 3),
        }

    return result
