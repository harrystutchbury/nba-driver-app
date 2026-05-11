"""
ADP loading and player matching.

Reads the BBM XLS file, uses Yahoo ADP (primary) or Fantrax ADP (fallback),
and fuzzy-matches player names to our database slugs.
"""

from __future__ import annotations

import logging
import sqlite3
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

# Default path — override via env var or pass explicitly
DEFAULT_ADP_PATH = Path(__file__).parent.parent / "data" / "BBM_PlayerRankings.xls"


def load_adp(xls_path: str | Path = DEFAULT_ADP_PATH, prefer: str = "yahoo") -> list[dict]:
    """
    Parse BBM XLS and return players sorted by ADP ascending.

    Each entry: {name, team, position, adp_rank, yahoo_adp, fantrax_adp, min_pg}
    """
    try:
        import xlrd
    except ImportError:
        raise ImportError("xlrd is required for ADP loading: pip install xlrd")

    wb = xlrd.open_workbook(str(xls_path))
    sh = wb.sheet_by_index(0)
    headers = [sh.cell_value(0, c) for c in range(sh.ncols)]

    players = []
    for r in range(1, sh.nrows):
        row = {headers[c]: sh.cell_value(r, c) for c in range(sh.ncols)}
        name = (row.get("Name") or "").strip()
        if not name:
            continue

        yahoo_adp   = row.get("Y!Adp")  or 999.0
        fantrax_adp = row.get("FTAdp")  or 999.0
        adp         = yahoo_adp if prefer == "yahoo" else fantrax_adp

        players.append({
            "name":        name,
            "team":        (row.get("Team") or "").strip(),
            "position":    (row.get("Pos")  or "").strip(),
            "yahoo_adp":   yahoo_adp,
            "fantrax_adp": fantrax_adp,
            "adp_rank":    adp,
            "min_pg":      row.get("m/g") or 0.0,
        })

    players.sort(key=lambda p: p["adp_rank"])
    log.info("Loaded %d ADP players from %s", len(players), xls_path)
    return players


def match_to_slugs(adp_players: list[dict], conn: sqlite3.Connection, score_cutoff: int = 85) -> list[dict]:
    """
    Fuzzy-match ADP player names against full_name in our players table.
    Adds 'slug' key to each player dict. Players without a match are dropped.
    """
    try:
        from rapidfuzz import process as fuzz_process
    except ImportError:
        raise ImportError("rapidfuzz required: pip install rapidfuzz")

    rows = conn.execute("SELECT slug, full_name FROM players").fetchall()
    name_to_slug = {r["full_name"]: r["slug"] for r in rows}
    db_names = list(name_to_slug.keys())

    matched, unmatched = [], []
    for p in adp_players:
        result = fuzz_process.extractOne(p["name"], db_names, score_cutoff=score_cutoff)
        if result:
            p = {**p, "slug": name_to_slug[result[0]]}
            matched.append(p)
        else:
            unmatched.append(p["name"])

    if unmatched:
        log.debug("ADP unmatched (%d): %s", len(unmatched), unmatched[:10])
    log.info("ADP matched %d / %d players to slugs", len(matched), len(adp_players))
    return matched


def get_draft_order(
    adp_players: list[dict],
    league_size: int,
    roster_size: int,
    noise_sigma: float = 8.0,
    rng: np.random.Generator | None = None,
) -> list[list[dict]]:
    """
    Simulate a snake draft with Gaussian ADP noise to produce unique league rosters.

    Returns list of `league_size` teams, each a list of `roster_size` player dicts.
    Noise lets different simulated leagues have different roster compositions.
    """
    if rng is None:
        rng = np.random.default_rng()

    total_picks = league_size * roster_size
    pool = adp_players[:total_picks + 20]  # small buffer for noise resorting

    # Add noise to ADP and re-sort to create variety across simulated leagues
    noisy = [(p, p["adp_rank"] + rng.normal(0, noise_sigma)) for p in pool]
    noisy.sort(key=lambda x: x[1])
    ordered = [p for p, _ in noisy][:total_picks]

    # Snake draft: round 1 → 1..N, round 2 → N..1, round 3 → 1..N, ...
    teams: list[list[dict]] = [[] for _ in range(league_size)]
    for pick_idx, player in enumerate(ordered):
        round_num = pick_idx // league_size
        slot      = pick_idx  % league_size
        team_idx  = slot if round_num % 2 == 0 else (league_size - 1 - slot)
        teams[team_idx].append(player)

    return teams
