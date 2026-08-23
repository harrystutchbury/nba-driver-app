"""
adp_espn.py — pull ESPN Average Draft Position (ADP) for the draft season.

ESPN's game-level player feed is public (no auth / no cookies). Per player we read:
  ownership.averageDraftPosition      — crowd ADP (fills in through draft season)
  draftRanksByRankType.STANDARD.rank  — ESPN's own projected draft rank (year-round)

Players are matched to our br_slug (exact ESPN-id map → normalized-name → fuzzy)
and upserted into player_adp. Additive and idempotent.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
import urllib.request

log = logging.getLogger(__name__)

# season id in ESPN's fba game = the calendar year the season ENDS
#   2026-27 -> 2027 (matches the app's existing seasons/2026 = 2025-26 usage)
ESPN_URL = ("https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/"
            "seasons/{year}/players?scoringPeriodId=0&view=kona_player_info")
# limit high enough to cover every draftable player; filterActive drops FAs/retirees
_FANTASY_FILTER = '{"players":{"limit":1500,"filterActive":{"value":true}}}'

_NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def _norm(s: str) -> str:
    """Lowercase, strip accents to ASCII, drop suffixes/punctuation. For matching."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-z ]", "", s.lower())
    toks = [t for t in s.split() if t not in _NAME_SUFFIXES]
    return "".join(toks)


def season_end_year(season: str) -> int:
    """'2026-27' -> 2027."""
    a, b = season.split("-")
    return int(a[:2] + b)


def fetch_espn_adp(year: int, timeout: int = 30) -> list[dict]:
    """Return [{espn_id, name, adp, rank}] for players with a draft signal."""
    req = urllib.request.Request(
        ESPN_URL.format(year=year),
        headers={
            "x-fantasy-filter": _FANTASY_FILTER,
            "accept": "application/json",
            "user-agent": "Mozilla/5.0 (roto-intel adp)",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    players = data if isinstance(data, list) else data.get("players", [])
    out = []
    for p in players:
        pl   = p.get("player", p)
        own  = pl.get("ownership") or {}
        std  = (pl.get("draftRanksByRankType") or {}).get("STANDARD") or {}
        adp  = own.get("averageDraftPosition")
        rank = std.get("rank")
        # keep only players with some draft signal (a rank or a real ADP)
        if rank is None and not (isinstance(adp, (int, float)) and adp > 0):
            continue
        out.append({
            "espn_id": str(pl.get("id") or ""),
            "name":    (pl.get("fullName") or "").strip(),
            "adp":     adp if (isinstance(adp, (int, float)) and adp > 0) else None,
            "rank":    rank,
        })
    return out


def refresh_espn_adp(conn, season: str) -> dict:
    """Fetch ESPN ADP for `season`, match to slugs, upsert into player_adp."""
    year = season_end_year(season)
    adp_players = fetch_espn_adp(year)

    # Match pool: this season's roster only, so we don't map a name onto a
    # retired same-named player. Exact ESPN-id map first, then name, then fuzzy.
    roster = conn.execute(
        "SELECT slug, full_name FROM players WHERE season = ?", (season,)
    ).fetchall()
    name_to_slug = {r["full_name"]: r["slug"] for r in roster}
    norm_to_slug = {}
    for r in roster:
        norm_to_slug.setdefault(_norm(r["full_name"]), r["slug"])

    espn_id_to_slug = {
        r["provider_id"]: r["br_slug"]
        for r in conn.execute(
            "SELECT provider_id, br_slug FROM fantasy_player_map "
            "WHERE provider = 'espn' AND br_slug IS NOT NULL"
        ).fetchall()
    }

    try:
        from rapidfuzz import process as fuzz_process
        fuzz_names = list(name_to_slug.keys())
    except Exception:
        fuzz_process = None
        fuzz_names = []

    matched, unmatched = [], []
    for p in adp_players:
        slug = espn_id_to_slug.get(p["espn_id"]) or norm_to_slug.get(_norm(p["name"]))
        if not slug and fuzz_process and fuzz_names:
            res = fuzz_process.extractOne(p["name"], fuzz_names, score_cutoff=88)
            if res:
                slug = name_to_slug[res[0]]
        if slug:
            matched.append({**p, "slug": slug})
        else:
            unmatched.append(p["name"])

    # De-dupe: if two ESPN entries map to one slug, keep the better draft signal.
    by_slug: dict[str, dict] = {}
    for m in matched:
        prev = by_slug.get(m["slug"])
        if prev is None or (m["rank"] or 9999) < (prev["rank"] or 9999):
            by_slug[m["slug"]] = m

    for slug, m in by_slug.items():
        conn.execute("""
            INSERT INTO player_adp (slug, season, espn_adp, espn_rank, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(slug, season) DO UPDATE SET
                espn_adp   = excluded.espn_adp,
                espn_rank  = excluded.espn_rank,
                updated_at = datetime('now')
        """, (slug, season, m["adp"], m["rank"]))
    conn.commit()

    return {
        "season":           season,
        "espn_season_year": year,
        "fetched":          len(adp_players),
        "matched":          len(by_slug),
        "unmatched_count":  len(unmatched),
        "unmatched_sample": unmatched[:15],
    }
