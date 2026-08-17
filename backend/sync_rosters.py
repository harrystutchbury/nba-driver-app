"""
sync_rosters.py — Add current-roster players missing from the players table.

The regular refresh (refresh.py) builds the players table from Basketball
Reference *season totals*, so it only contains players who have logged games.
Newly drafted / signed rookies have no season stats yet and are therefore
absent from the calibration rosters, even though they are on an NBA roster.

This pulls the live rosters from Tank01 (getNBATeams?rosters=true) and INSERTS
any current-roster player who is missing from the players table for the target
season. It is deliberately *additive*:

  - It never modifies or deletes existing rows (so it won't fight the BR
    refresh, and it won't reassign veterans who changed teams — that's a
    separate, deliberate operation).
  - Inserted rows are tagged roster_source='tank01' so they can be identified
    or undone: DELETE FROM players WHERE roster_source='tank01' AND season=?

Tank01's bRefID is the Basketball Reference slug, i.e. our players.slug, so the
mapping is exact. Players Tank01 has no bRefID for (BR page not created yet)
are reported as 'unmapped' rather than guessed at.

Usage:
    export RAPIDAPI_KEY=your_key_here
    python sync_rosters.py              # sync into the latest season
    python sync_rosters.py --dry-run    # report only, write nothing
"""

import json
import logging
import os
import re
import sys
import unicodedata
import urllib.request
import urllib.parse
from datetime import datetime
from typing import Optional

from schema import get_conn

# Name suffixes that are not part of the family name for slug purposes
_NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}

# Tank01 specific position → broad group used by player_bio.position_group
_POS_GROUP = {
    "PG": "Guard",   "SG": "Guard",   "G": "Guard",
    "SF": "Forward", "PF": "Forward", "F": "Forward",
    "C":  "Center",
    "G-F": "Guard-Forward", "F-G": "Guard-Forward",
    "F-C": "Forward-Center", "C-F": "Forward-Center",
}


def _norm(s: str) -> str:
    """Lowercase, strip accents to ASCII, drop everything but letters."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z]", "", s.lower())


def _position_group(pos: Optional[str]) -> Optional[str]:
    """Map a Tank01 position (e.g. 'SG', 'G-F') to a broad Guard/Forward/Center group."""
    if not pos:
        return None
    key = pos.upper().strip()
    if key in _POS_GROUP:
        return _POS_GROUP[key]
    if "G" in key:
        return "Guard"
    if "F" in key:
        return "Forward"
    if "C" in key:
        return "Center"
    return None


def _iso_birthdate(bday: Optional[str]) -> Optional[str]:
    """Normalise a Tank01 birthday (usually MM/DD/YYYY) to YYYY-MM-DD, or None."""
    if not bday:
        return None
    s = str(bday).strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except Exception:
            continue
    return None


def generate_br_slug(full_name: str, taken: set) -> Optional[str]:
    """
    Build a Basketball-Reference-style slug from a full name, matching BR's
    convention: first5(lastname) + first2(firstname) + NN, where NN starts at
    01 and increments to avoid collisions with already-taken slugs.

    e.g. 'Victor Wembanyama' -> 'wembavi01', 'Shai Gilgeous-Alexander' ->
    'gilgesh01'. Returns None if the name can't yield a slug.
    """
    tokens = [t for t in (full_name or "").split() if t]
    # Drop a trailing suffix token (Jr., III, ...)
    while len(tokens) > 1 and _norm(tokens[-1]) in _NAME_SUFFIXES:
        tokens.pop()
    if len(tokens) < 2:
        return None
    first = _norm(tokens[0])
    last  = _norm(" ".join(tokens[1:]))  # multi-word surnames collapse to letters
    if not first or not last:
        return None
    base = f"{last[:5]}{first[:2]}"
    for n in range(1, 100):
        slug = f"{base}{n:02d}"
        if slug not in taken:
            return slug
    return None

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

RAPIDAPI_KEY  = os.environ.get("RAPIDAPI_KEY", "")
RAPIDAPI_HOST = "tank01-fantasy-stats.p.rapidapi.com"

# Tank01 team abbreviation -> our players.team value (full upper-case name)
TEAM_ABBREV = {
    "ATL": "ATLANTA HAWKS",        "BOS": "BOSTON CELTICS",
    "BKN": "BROOKLYN NETS",        "CHA": "CHARLOTTE HORNETS",
    "CHI": "CHICAGO BULLS",        "CLE": "CLEVELAND CAVALIERS",
    "DAL": "DALLAS MAVERICKS",     "DEN": "DENVER NUGGETS",
    "DET": "DETROIT PISTONS",      "GS":  "GOLDEN STATE WARRIORS",
    "GSW": "GOLDEN STATE WARRIORS",
    "HOU": "HOUSTON ROCKETS",      "IND": "INDIANA PACERS",
    "LAC": "LOS ANGELES CLIPPERS", "LAL": "LOS ANGELES LAKERS",
    "MEM": "MEMPHIS GRIZZLIES",    "MIA": "MIAMI HEAT",
    "MIL": "MILWAUKEE BUCKS",      "MIN": "MINNESOTA TIMBERWOLVES",
    "NO":  "NEW ORLEANS PELICANS", "NOP": "NEW ORLEANS PELICANS",
    "NY":  "NEW YORK KNICKS",      "NYK": "NEW YORK KNICKS",
    "OKC": "OKLAHOMA CITY THUNDER", "ORL": "ORLANDO MAGIC",
    "PHI": "PHILADELPHIA 76ERS",   "PHO": "PHOENIX SUNS",
    "POR": "PORTLAND TRAIL BLAZERS",
    "SA":  "SAN ANTONIO SPURS",    "SAS": "SAN ANTONIO SPURS",
    "SAC": "SACRAMENTO KINGS",     "TOR": "TORONTO RAPTORS",
    "UTA": "UTAH JAZZ",            "WAS": "WASHINGTON WIZARDS",
}


def _get(endpoint: str, params: dict) -> dict:
    if not RAPIDAPI_KEY:
        raise RuntimeError("RAPIDAPI_KEY env var not set")
    qs  = urllib.parse.urlencode(params)
    url = f"https://{RAPIDAPI_HOST}/{endpoint}?{qs}"
    req = urllib.request.Request(url, headers={
        "X-RapidAPI-Key":  RAPIDAPI_KEY,
        "X-RapidAPI-Host": RAPIDAPI_HOST,
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_current_rosters() -> list:
    """Return a flat list of {slug, name, team, exp} for every current-roster player."""
    data = _get("getNBATeams", {"rosters": "true"})
    body = data.get("body", {})
    teams = list(body.values()) if isinstance(body, dict) else (body or [])

    out = []
    for team in teams:
        tabv = (team.get("teamAbv") or "").upper()
        team_name = TEAM_ABBREV.get(tabv)
        if not team_name:
            log.warning("Unknown Tank01 team abbreviation: %r — skipping", tabv)
            continue
        roster = team.get("Roster", {})
        players = list(roster.values()) if isinstance(roster, dict) else (roster or [])
        for p in players:
            out.append({
                "slug": (p.get("bRefID") or "").strip(),
                "name": (p.get("longName") or p.get("espnName") or "").strip(),
                "team": team_name,
                "exp":  (str(p.get("exp") or "")).strip(),   # "R" or "0" == rookie
                "pos":  (p.get("pos") or "").strip() or None,
                "bday": (p.get("bDay") or p.get("bday") or "").strip() or None,
                "tank01_id": (str(p.get("playerID") or "")).strip() or None,
            })
    return out


def fetch_player_meta() -> dict:
    """
    {tank01_id: {"pos", "bday"}} from Tank01's full player list — the authoritative
    source for position + birthday, used to backfill bio when the roster feed omits it.
    """
    data = _get("getNBAPlayerList", {})
    body = data.get("body", [])
    players = list(body.values()) if isinstance(body, dict) else (body or [])
    out = {}
    for p in players:
        pid = (str(p.get("playerID") or "")).strip()
        if not pid:
            continue
        out[pid] = {
            "pos":  (p.get("pos") or "").strip() or None,
            "bday": (p.get("bDay") or p.get("bday") or "").strip() or None,
        }
    return out


def sync(season: str = None, dry_run: bool = False, conn=None) -> dict:
    """
    Insert current-roster players missing from players(season). Additive only.

    Returns a summary dict: season, roster_total, already_present, added (list),
    unmapped (list of players Tank01 has no bRefID for).
    """
    own_conn = conn is None
    if own_conn:
        conn = get_conn()
    try:
        # Self-heal: ensure the roster_source column exists regardless of whether
        # the schema migration has run yet, so the INSERT below can't fail on it.
        try:
            conn.execute("ALTER TABLE players ADD COLUMN roster_source TEXT")
            conn.commit()
        except Exception:
            pass  # column already exists

        if season is None:
            row = conn.execute("SELECT MAX(season) FROM players").fetchone()
            season = row[0] if row and row[0] else None
        if not season:
            raise RuntimeError("No season found in players table")

        roster = fetch_current_rosters()
        rows = conn.execute(
            "SELECT slug, full_name FROM players WHERE season=?", [season]).fetchall()
        existing_slugs = {r[0] for r in rows}          # this season's roster (dedup)
        existing_names = {_norm(r[1]) for r in rows}   # for name-based idempotency

        # Collision set for GENERATED slugs must span every known player — all
        # seasons + game logs — not just this season's roster. Otherwise a rookie
        # can be handed a retired player's slug (Christian Anderson vs Chris
        # Andersen both -> anderch01) and inherit their entire history.
        taken = {r[0] for r in conn.execute("SELECT DISTINCT slug FROM players").fetchall()}
        taken |= {r[0] for r in conn.execute("SELECT DISTINCT player_slug FROM game_logs").fetchall()}

        added, unmapped, already = [], [], 0
        seen_names = set()            # names already handled this run
        for p in roster:
            slug = p["slug"]
            if slug:
                # Tank01 has a Basketball Reference id — exact match.
                if slug in existing_slugs or slug in taken:
                    already += 1 if slug in existing_slugs else 0
                    continue
                taken.add(slug)
                added.append({**p, "slug": slug, "generated": False})
            else:
                # No BR id yet (unpublished rookie): generate the slug BR will use.
                name_key = _norm(p["name"])
                if not name_key or name_key in existing_names or name_key in seen_names:
                    if name_key:
                        already += 1  # already synced on a prior run
                    else:
                        unmapped.append({"name": p["name"], "team": p["team"], "exp": p["exp"]})
                    continue
                gen = generate_br_slug(p["name"], taken)
                if not gen:
                    unmapped.append({"name": p["name"], "team": p["team"], "exp": p["exp"]})
                    continue
                taken.add(gen)
                seen_names.add(name_key)
                added.append({**p, "slug": gen, "generated": True})

        if not dry_run and added:
            conn.executemany(
                "INSERT OR IGNORE INTO players (slug, full_name, team, season, roster_source) "
                "VALUES (?, ?, ?, ?, ?)",
                [(p["slug"], p["name"], p["team"], season,
                  "tank01_generated" if p["generated"] else "tank01") for p in added],
            )
            conn.commit()

        # ── Backfill position + birthdate for rostered players. Fixes rookies that
        #    otherwise render as "Guard" with no age (they never got a bio / Tank01
        #    position row). Repairs existing rows too; non-destructive (COALESCE). ──
        bio_backfill = {"positions": 0, "bios": 0}
        if not dry_run:
            try:
                conn.execute("ALTER TABLE player_bio ADD COLUMN position_group TEXT")
                conn.commit()
            except Exception:
                pass  # column already exists
            try:
                meta = fetch_player_meta()
            except Exception as e:
                meta = {}
                log.warning("bio backfill: could not fetch player meta: %s", e)

            name_to_slug = {}
            for r in conn.execute("SELECT slug, full_name FROM players WHERE season=?", [season]).fetchall():
                name_to_slug.setdefault(_norm(r[1]), r[0])

            for p in roster:
                slug = p["slug"] or name_to_slug.get(_norm(p["name"]))
                if not slug:
                    continue
                tid  = p.get("tank01_id")
                m    = meta.get(tid, {}) if tid else {}
                pos  = p.get("pos")  or m.get("pos")
                bday = _iso_birthdate(p.get("bday") or m.get("bday"))
                pgrp = _position_group(pos)

                if pos and tid:
                    conn.execute("""
                        INSERT INTO tank01_player_map (br_slug, tank01_id, tank01_name, position)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT(br_slug) DO UPDATE SET
                            tank01_id   = excluded.tank01_id,
                            tank01_name = excluded.tank01_name,
                            position    = COALESCE(excluded.position, tank01_player_map.position)
                    """, [slug, tid, p["name"], pos])
                    bio_backfill["positions"] += 1

                if bday or pgrp:
                    exists = conn.execute("SELECT 1 FROM player_bio WHERE br_slug=?", [slug]).fetchone()
                    if exists:
                        conn.execute(
                            "UPDATE player_bio SET birthdate=COALESCE(?, birthdate), "
                            "position_group=COALESCE(?, position_group) WHERE br_slug=?",
                            [bday, pgrp, slug])
                    else:
                        conn.execute(
                            "INSERT INTO player_bio (br_slug, birthdate, position_group) VALUES (?, ?, ?)",
                            [slug, bday, pgrp])
                    bio_backfill["bios"] += 1
            conn.commit()
            log.info("[%s] bio backfill: %d positions, %d bios",
                     season, bio_backfill["positions"], bio_backfill["bios"])

        gen_n = sum(1 for p in added if p["generated"])
        log.info("[%s] roster=%d, already=%d, %s=%d (%d generated slugs), unmapped=%d",
                 season, len(roster), already,
                 "would_add" if dry_run else "added", len(added), gen_n, len(unmapped))
        return {
            "season":         season,
            "dry_run":        dry_run,
            "roster_total":   len(roster),
            "already_present": already,
            "added":          added,
            "unmapped":       unmapped,
            "bio_backfill":   bio_backfill,
        }
    finally:
        if own_conn:
            conn.close()


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    result = sync(dry_run=dry)
    print(f"\nSeason {result['season']}  (dry_run={result['dry_run']})")
    print(f"  roster players seen : {result['roster_total']}")
    print(f"  already in table    : {result['already_present']}")
    print(f"  {'would add' if dry else 'added':<19} : {len(result['added'])}")
    for p in result["added"]:
        tag = "gen" if p.get("generated") else "brf"
        print(f"      + {p['name']:<26} {p['team']:<24} exp={p['exp']:<2} [{tag}] {p['slug']}")
    if result["unmapped"]:
        print(f"  unmapped (no name): {len(result['unmapped'])} — cannot generate a slug")
        for p in result["unmapped"]:
            print(f"      ? {p['name']:<26} {p['team']:<24} exp={p['exp']}")
