"""
map_players.py — Build the player_id_map table linking Basketball Reference
slugs to NBA API player IDs.

Matching runs in three tiers:
  1. Exact match on normalised name
  2. Fuzzy match via rapidfuzz (threshold 90)
  3. Manual overrides in MANUAL_OVERRIDES below

Unmatched players are logged to data/unmatched_players.txt for review.

Run from the backend folder:
    python map_players.py
"""

import re
import unicodedata
import logging

from rapidfuzz import process, fuzz
from nba_api.stats.static import players as nba_static_players

from schema import get_conn, init_db

# -----------------------------------------------------------------------
# Manual overrides  {br_slug: nba_id}
# Add entries here for any player the auto-match can't resolve.
# -----------------------------------------------------------------------
MANUAL_OVERRIDES = {
    "hollaro01": 1642260,  # Ron Holland (BR) = Ron Holland Jr. (NBA API)
}

FUZZY_THRESHOLD = 90

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# -----------------------------------------------------------------------
# Name normalisation
# -----------------------------------------------------------------------

SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}

def normalise(name: str) -> str:
    """Lowercase, strip accents, strip punctuation, strip name suffixes."""
    # Decompose accented characters
    name = unicodedata.normalize("NFKD", name)
    name = "".join(c for c in name if not unicodedata.combining(c))
    # Lowercase and strip non-alpha
    name = name.lower()
    name = re.sub(r"[^a-z\s]", "", name)
    # Remove standalone suffixes
    tokens = [t for t in name.split() if t not in SUFFIXES]
    return " ".join(tokens).strip()


# -----------------------------------------------------------------------
# Pull NBA API player list
# -----------------------------------------------------------------------

def fetch_nba_players():
    log.info("Loading NBA player list from static data (no network required)...")
    all_players = nba_static_players.get_players()
    players = {}  # nba_id -> {id, name, norm}
    for p in all_players:
        nba_id = int(p["id"])
        name   = str(p["full_name"]).strip()
        players[nba_id] = {"nba_id": nba_id, "name": name, "norm": normalise(name)}
    log.info(f"  {len(players)} NBA players loaded.")
    return players


# -----------------------------------------------------------------------
# Match
# -----------------------------------------------------------------------

def build_map(conn, nba_players):
    br_players = conn.execute(
        "SELECT DISTINCT slug, full_name FROM players"
    ).fetchall()
    log.info(f"Matching {len(br_players)} BR players...")

    # Build lookup structures
    norm_to_nba = {}  # normalised name -> nba player dict
    for p in nba_players.values():
        norm_to_nba[p["norm"]] = p

    nba_norms   = list(norm_to_nba.keys())
    unmatched   = []
    rows        = []

    exact = fuzzy = manual = 0

    for br in br_players:
        slug    = br["slug"]
        br_name = br["full_name"]
        br_norm = normalise(br_name)

        # Tier 3 — manual override
        if slug in MANUAL_OVERRIDES:
            nba_id   = MANUAL_OVERRIDES[slug]
            nba_name = nba_players.get(nba_id, {}).get("name", "")
            rows.append((slug, nba_id, br_name, nba_name, 3))
            manual += 1
            continue

        # Tier 1 — exact normalised match
        if br_norm in norm_to_nba:
            p = norm_to_nba[br_norm]
            rows.append((slug, p["nba_id"], br_name, p["name"], 1))
            exact += 1
            continue

        # Tier 2 — fuzzy match
        result = process.extractOne(
            br_norm,
            nba_norms,
            scorer=fuzz.token_sort_ratio,
            score_cutoff=FUZZY_THRESHOLD,
        )
        if result:
            matched_norm, score, _ = result
            p = norm_to_nba[matched_norm]
            log.debug(f"  FUZZY {br_name!r} → {p['name']!r} ({score:.0f})")
            rows.append((slug, p["nba_id"], br_name, p["name"], 2))
            fuzzy += 1
            continue

        # Unmatched
        unmatched.append((slug, br_name))

    # Write results
    conn.executemany("""
        INSERT INTO player_id_map (br_slug, nba_id, br_name, nba_name, match_tier)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(br_slug) DO UPDATE SET
            nba_id     = excluded.nba_id,
            br_name    = excluded.br_name,
            nba_name   = excluded.nba_name,
            match_tier = excluded.match_tier
    """, rows)
    conn.commit()

    log.info(f"Matched: {exact} exact, {fuzzy} fuzzy, {manual} manual.")
    log.info(f"Unmatched: {len(unmatched)}")

    if unmatched:
        out_path = "data/unmatched_players.txt"
        with open(out_path, "w") as f:
            f.write("# Unmatched players — add entries to MANUAL_OVERRIDES in map_players.py\n")
            f.write("# Format: br_slug | br_name\n\n")
            for slug, name in unmatched:
                f.write(f"{slug} | {name}\n")
        log.warning(f"Unmatched list written to {out_path}")

    return len(unmatched)


# -----------------------------------------------------------------------
# Entrypoint
# -----------------------------------------------------------------------

if __name__ == "__main__":
    init_db()
    conn        = get_conn()
    nba_players = fetch_nba_players()
    n_unmatched = build_map(conn, nba_players)
    conn.close()
    log.info("Done.")
    if n_unmatched:
        log.warning(
            f"{n_unmatched} players could not be matched. "
            "Review data/unmatched_players.txt and add to MANUAL_OVERRIDES."
        )
