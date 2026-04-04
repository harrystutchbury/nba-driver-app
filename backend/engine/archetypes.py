"""
archetypes.py — Rule-based archetype assignment on top of cluster features.

Rules are applied in order within each position group. First match wins.

Position gate (hard):
    C  →  scoring big | stretch big | defensive big | rim-running big
    G  →  playmaking guard | scoring guard | utility guard
    F  →  scoring wing | utility wing

Stat thresholds (per-30 minutes):
    Scoring big:      C  +  pts   > 18.0
    Stretch big:      C  +  fg3m  > 1.0
    Defensive big:    C  (default)
    Playmaking guard: G  +  ast   > 6.0
    Scoring guard:    G  +  pts   > 16.0
    Utility guard:    G  (default)
    Scoring wing:     F  +  pts   > 14.0
    Utility wing:     F  (default)

Usage:
    from engine.archetypes import assign_archetypes
    df = assign_archetypes(df)   # df from build_dataset()
"""

ARCHETYPES = [
    'playmaking guard',
    'scoring guard',
    'utility guard',
    'scoring wing',
    'utility wing',
    'scoring big',
    'stretch big',
    'defensive big',
]

# Thresholds (per-30)
AST_PLAYMAKING_GUARD = 6.0
PTS_SCORING_GUARD    = 16.0
PTS_SCORING_BIG      = 18.0
FG3M_STRETCH_BIG     = 1.0
PTS_SCORING_WING     = 14.0


def _assign_row(pos, pts, ast, fg3m, blk, reb):
    """Return archetype string for a single player-season."""
    if pos == 'C':
        if pts > PTS_SCORING_BIG:
            return 'scoring big'
        if fg3m > FG3M_STRETCH_BIG:
            return 'stretch big'
        return 'defensive big'
    if pos == 'G':
        if ast > AST_PLAYMAKING_GUARD:
            return 'playmaking guard'
        if pts > PTS_SCORING_GUARD:
            return 'scoring guard'
        return 'utility guard'
    if pos == 'F':
        if pts > PTS_SCORING_WING:
            return 'scoring wing'
        return 'utility wing'
    return None   # unknown position


def assign_archetypes(df):
    """
    Add an 'archetype' column to a training_data DataFrame.
    Rows with unknown position get None.
    """
    df = df.copy()
    df['archetype'] = df.apply(
        lambda r: _assign_row(
            pos  = r.get('position_group'),
            pts  = r.get('p30_pts',  0),
            ast  = r.get('p30_ast',  0),
            fg3m = r.get('p30_fg3m', 0),
            blk  = r.get('p30_blk',  0),
            reb  = r.get('p30_reb',  0),
        ),
        axis=1,
    )
    return df


if __name__ == '__main__':
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from schema import get_conn
    from engine.training_data import build_dataset

    conn = get_conn()
    df   = build_dataset(conn)
    conn.close()

    df = assign_archetypes(df)

    print("Archetype counts:")
    print(df['archetype'].value_counts().to_string())
    print()

    for archetype in ARCHETYPES:
        subset = df[df['archetype'] == archetype]
        top = (
            subset
            .sort_values('p30_pts', ascending=False)
            .drop_duplicates('player_slug')
            .head(6)
        )
        examples = ', '.join(
            f"{r['player_slug']} ({r['season']})"
            for _, r in top.iterrows()
        )
        avg_pts  = subset['p30_pts'].mean()
        avg_reb  = subset['p30_reb'].mean()
        avg_ast  = subset['p30_ast'].mean()
        avg_fg3m = subset['p30_fg3m'].mean()
        avg_fgp  = subset['fg_pct'].mean()
        print(f"{'─'*70}")
        print(f"{archetype.upper()}  (n={len(subset)})")
        print(f"  pts={avg_pts:.1f}  reb={avg_reb:.1f}  ast={avg_ast:.1f}  "
              f"3pm={avg_fg3m:.1f}  fg%={avg_fgp:.1f}")
        print(f"  {examples}")
    print(f"{'─'*70}")
    print(f"\nNo position (unassigned): {df['archetype'].isna().sum()}")
