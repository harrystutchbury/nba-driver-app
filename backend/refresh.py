"""
refresh.py — Pull data from Basketball Reference and upsert into SQLite.

Run manually:      python refresh.py
Run for a season:  python refresh.py --season 2024
Run multi-season:  python refresh.py --season 2023 --season 2024

NOTE: season argument is the END year — 2024 means the 2023-24 season.
"""

import argparse
import time
import logging
from datetime import date, timedelta

from basketball_reference_web_scraper import client

from schema import get_conn, init_db

# -----------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------

REQUEST_DELAY   = 8.0
DEFAULT_SEASONS = [2024, 2025, 2026]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# -----------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------

def sleep():
    time.sleep(REQUEST_DELAY)


def upsert(conn, table, rows, conflict_cols):
    if not rows:
        return
    cols         = list(rows[0].keys())
    placeholders = ", ".join("?" * len(cols))
    conflict     = ", ".join(conflict_cols)
    updates      = ", ".join(
        f"{c}=excluded.{c}" for c in cols if c not in conflict_cols
    )
    sql = (
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT({conflict}) DO UPDATE SET {updates}"
    )
    conn.executemany(sql, [list(r.values()) for r in rows])


def season_label(season_end_year):
    return f"{season_end_year - 1}-{str(season_end_year)[2:]}"


def team_str(team):
    return team.value if hasattr(team, "value") else str(team)


def location_str(loc):
    return str(loc.value).upper() if hasattr(loc, "value") else str(loc).upper()


def compute_possessions(fga, oreb, tov, fta):
    """Standard Hollinger possession estimate."""
    return fga - oreb + tov + (0.44 * fta)


def compute_pace(team_poss, opp_poss, minutes):
    """pace = 48 * ((team_poss + opp_poss) / (2 * minutes / 5))"""
    if minutes <= 0:
        return 0.0
    game_minutes = minutes / 5
    return 48 * ((team_poss + opp_poss) / (2 * game_minutes))


def compute_dreb_pct(dreb, opp_fga, opp_fg_pct, opp_fta, opp_ft_pct, min_, team_min):
    """
    DREB% = dreb / available_defensive_rebounds

    Available defensive rebounds = opponent missed field goals
                                  + opponent missed reboundable free throws

    Opponent missed FGs   = opp_fga * (1 - opp_fg_pct)
    Opponent missed FTs   = 0.44 * opp_fta * (1 - opp_ft_pct)
      (0.44 is the Hollinger constant for reboundable FT attempts)

    Scaled by the player's share of team minutes so we're measuring
    the rebounds available while this player was on the court.
    """
    if team_min <= 0 or min_ <= 0:
        return 0.0
    min_share = min_ / team_min
    opp_missed_fg = opp_fga * (1 - opp_fg_pct)
    opp_missed_ft = 0.44 * opp_fta * (1 - opp_ft_pct)
    available = (opp_missed_fg + opp_missed_ft) * min_share
    return (dreb / available) if available > 0 else 0.0


def compute_oreb_pct(oreb, team_fga, team_fg_pct, team_fta, team_ft_pct, min_, team_min):
    """
    OREB% = oreb / available_offensive_rebounds

    Available offensive rebounds = team missed field goals
                                  + team missed reboundable free throws
    """
    if team_min <= 0 or min_ <= 0:
        return 0.0
    min_share = min_ / team_min
    team_missed_fg = team_fga * (1 - team_fg_pct)
    team_missed_ft = 0.44 * team_fta * (1 - team_ft_pct)
    available = (team_missed_fg + team_missed_ft) * min_share
    return (oreb / available) if available > 0 else 0.0


# -----------------------------------------------------------------------
# Step 1 — Players
# -----------------------------------------------------------------------

def refresh_players(conn, season_end_year):
    label = season_label(season_end_year)
    log.info(f"[{label}] Pulling player season totals...")
    sleep()

    rows_basic = client.players_season_totals(season_end_year=season_end_year)

    players = []
    for r in rows_basic:
        slug = r.get("slug", "")
        if not slug:
            continue
        players.append({
            "slug":      slug,
            "full_name": r.get("name", ""),
            "team":      team_str(r.get("team", "")),
            "season":    label,
        })

    upsert(conn, "players", players, ["slug", "season"])
    conn.commit()
    log.info(f"[{label}] {len(players)} players upserted.")
    return [p["slug"] for p in players]


# -----------------------------------------------------------------------
# Step 2 — Player game logs
# dreb_pct and oreb_pct are computed here per game using that game's
# team_games data so they are independent of period-level averages.
# -----------------------------------------------------------------------

def refresh_player_game_logs(conn, season_end_year, slugs):
    label = season_label(season_end_year)
    log.info(f"[{label}] Pulling game logs for {len(slugs)} players...")

    # latest game date we have in team_games for this season
    latest_team_date = (conn.execute(
        "SELECT MAX(game_date) FROM team_games WHERE season=?", (label,)
    ).fetchone()[0] or "")

    # per-player latest game date already in game_logs
    player_latest = {
        r[0]: r[1] for r in conn.execute(
            "SELECT player_slug, MAX(game_date) FROM game_logs WHERE season=? GROUP BY player_slug",
            (label,),
        )
    }

    pulled  = 0
    skipped = 0

    for i, slug in enumerate(slugs):
        if i % 50 == 0:
            log.info(f"  {i}/{len(slugs)} players processed...")

        # skip only if the player's data is already up to the latest team date
        if player_latest.get(slug, "") >= latest_team_date and latest_team_date:
            skipped += 1
            continue

        games = None
        for attempt in range(4):
            sleep()
            try:
                games = client.regular_season_player_box_scores(
                    player_identifier=slug,
                    season_end_year=season_end_year,
                )
                break
            except Exception as e:
                msg = str(e)
                if "429" in msg:
                    wait = 60 * (attempt + 1)
                    log.warning(f"  {slug} — 429, waiting {wait}s before retry {attempt + 1}/3...")
                    time.sleep(wait)
                else:
                    log.warning(f"  {slug} failed: {e}")
                    break
        if games is None:
            continue

        rows = []
        for g in games:
            if not g.get("active", True):
                continue

            seconds = g.get("seconds_played", 0) or 0
            minutes = seconds / 60
            if minutes < 1:
                continue

            game_date = g.get("date")
            if hasattr(game_date, "strftime"):
                game_date = game_date.strftime("%Y-%m-%d")

            team = team_str(g.get("team", ""))

            fga  = float(g.get("attempted_field_goals",             0) or 0)
            fg3a = float(g.get("attempted_three_point_field_goals",  0) or 0)
            fg3m = float(g.get("made_three_point_field_goals",       0) or 0)
            fgm  = float(g.get("made_field_goals",                   0) or 0)
            fta  = float(g.get("attempted_free_throws",              0) or 0)
            ftm  = float(g.get("made_free_throws",                   0) or 0)
            oreb = float(g.get("offensive_rebounds",                 0) or 0)
            dreb = float(g.get("defensive_rebounds",                 0) or 0)

            # Look up this game's team context from team_games
            # to compute per-game dreb_pct and oreb_pct
            team_game = conn.execute("""
                SELECT team_fga, team_fg_pct, team_fta, team_ft_pct,
                       opp_fga,  opp_fg_pct,  opp_fta,  opp_ft_pct,
                       minutes
                FROM team_games
                WHERE team = ? AND game_date = ?
            """, (team, game_date)).fetchone()

            if team_game and team_game["minutes"] and team_game["minutes"] > 0:
                tm = dict(team_game)
                dreb_pct = compute_dreb_pct(
                    dreb,
                    tm["opp_fga"],  tm["opp_fg_pct"],
                    tm["opp_fta"],  tm["opp_ft_pct"],
                    minutes, tm["minutes"]
                )
                oreb_pct = compute_oreb_pct(
                    oreb,
                    tm["team_fga"], tm["team_fg_pct"],
                    tm["team_fta"], tm["team_ft_pct"],
                    minutes, tm["minutes"]
                )
            else:
                dreb_pct = 0.0
                oreb_pct = 0.0

            rows.append({
                "player_slug": slug,
                "game_date":   game_date,
                "season":      label,
                "team":        team,
                "opponent":    team_str(g.get("opponent", "")),
                "home_away":   "H" if "HOME" in location_str(g.get("location", "")) else "A",
                "min":         round(minutes, 2),
                "pts":         float(g.get("points_scored", 0) or 0),
                "reb":         oreb + dreb,
                "oreb":        oreb,
                "dreb":        dreb,
                "ast":         float(g.get("assists",   0) or 0),
                "stl":         float(g.get("steals",    0) or 0),
                "blk":         float(g.get("blocks",    0) or 0),
                "tov":         float(g.get("turnovers", 0) or 0),
                "fgm":         fgm,
                "fga":         fga,
                "fg3m":        fg3m,
                "fg3a":        fg3a,
                "ftm":         ftm,
                "fta":         fta,
                "dreb_pct":    round(dreb_pct, 4),
                "oreb_pct":    round(oreb_pct, 4),
            })

        upsert(conn, "game_logs", rows, ["player_slug", "game_date", "team"])
        conn.commit()
        pulled += len(rows)

    log.info(f"[{label}] Game logs done. {pulled} new rows, {skipped} already existed.")


# -----------------------------------------------------------------------
# Step 3 — Team game logs + pace
# Must run BEFORE player game logs so dreb_pct/oreb_pct can be computed.
# -----------------------------------------------------------------------

def season_dates(season_end_year):
    start   = date(season_end_year - 1, 10, 1)
    end     = date(season_end_year, 6, 30)
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def refresh_team_game_logs(conn, season_end_year):
    label = season_label(season_end_year)
    log.info(f"[{label}] Pulling team game logs by date...")

    existing_dates = set(
        r[0] for r in conn.execute(
            "SELECT DISTINCT game_date FROM team_games WHERE season=?", (label,)
        )
    )

    pulled = 0
    for i, game_date in enumerate(season_dates(season_end_year)):
        date_str = game_date.strftime("%Y-%m-%d")
        if date_str in existing_dates:
            continue

        sleep()
        try:
            teams = client.team_box_scores(
                day=game_date.day,
                month=game_date.month,
                year=game_date.year,
            )
        except Exception:
            continue

        if not teams:
            continue

        if i % 30 == 0:
            log.info(f"  {date_str} — {len(teams)} team box scores")

        rows = []
        for t in teams:
            fga  = float(t.get("attempted_field_goals",       0) or 0)
            fgm  = float(t.get("made_field_goals",            0) or 0)
            fta  = float(t.get("attempted_free_throws",       0) or 0)
            ftm  = float(t.get("made_free_throws",            0) or 0)
            oreb = float(t.get("offensive_rebounds",          0) or 0)
            dreb = float(t.get("defensive_rebounds",          0) or 0)
            tov  = float(t.get("turnovers",                   0) or 0)
            mins = float(t.get("minutes_played",            240) or 240)

            fg_pct = (fgm / fga) if fga > 0 else 0.0
            ft_pct = (ftm / fta) if fta > 0 else 0.0

            rows.append({
                "team":        team_str(t.get("team", "")),
                "game_date":   date_str,
                "season":      label,
                "team_fga":    fga,
                "team_fgm":    fgm,
                "team_fg_pct": fg_pct,
                "team_fta":    fta,
                "team_ftm":    ftm,
                "team_ft_pct": ft_pct,
                "team_oreb":   oreb,
                "team_dreb":   dreb,
                "team_tov":    tov,
                "opp_fga":     0.0,
                "opp_fgm":     0.0,
                "opp_fg_pct":  0.0,
                "opp_fta":     0.0,
                "opp_ftm":     0.0,
                "opp_ft_pct":  0.0,
                "opp_oreb":    0.0,
                "opp_dreb":    0.0,
                "opp_tov":     0.0,
                "minutes":     mins,
                "pace":        0.0,
            })

        upsert(conn, "team_games", rows, ["team", "game_date"])
        conn.commit()
        pulled += len(rows)

    log.info(f"[{label}] Team game logs done. {pulled} rows upserted.")

    # Enrich opponent columns
    log.info(f"[{label}] Enriching opponent stats...")
    conn.execute("""
        UPDATE team_games AS t
        SET
            opp_fga     = (SELECT o.team_fga     FROM team_games o WHERE o.game_date = t.game_date AND o.team != t.team LIMIT 1),
            opp_fgm     = (SELECT o.team_fgm     FROM team_games o WHERE o.game_date = t.game_date AND o.team != t.team LIMIT 1),
            opp_fg_pct  = (SELECT o.team_fg_pct  FROM team_games o WHERE o.game_date = t.game_date AND o.team != t.team LIMIT 1),
            opp_fta     = (SELECT o.team_fta     FROM team_games o WHERE o.game_date = t.game_date AND o.team != t.team LIMIT 1),
            opp_ftm     = (SELECT o.team_ftm     FROM team_games o WHERE o.game_date = t.game_date AND o.team != t.team LIMIT 1),
            opp_ft_pct  = (SELECT o.team_ft_pct  FROM team_games o WHERE o.game_date = t.game_date AND o.team != t.team LIMIT 1),
            opp_oreb    = (SELECT o.team_oreb    FROM team_games o WHERE o.game_date = t.game_date AND o.team != t.team LIMIT 1),
            opp_dreb    = (SELECT o.team_dreb    FROM team_games o WHERE o.game_date = t.game_date AND o.team != t.team LIMIT 1),
            opp_tov     = (SELECT o.team_tov     FROM team_games o WHERE o.game_date = t.game_date AND o.team != t.team LIMIT 1)
        WHERE season = ?
    """, (label,))
    conn.commit()

    # Compute pace
    log.info(f"[{label}] Computing pace...")
    rows_to_update = conn.execute("""
        SELECT rowid AS rid, team_fga, team_oreb, team_tov, team_fta,
               opp_fga,  opp_oreb,  opp_tov,  opp_fta, minutes
        FROM team_games WHERE season = ?
    """, (label,)).fetchall()

    pace_updates = []
    for r in rows_to_update:
        team_poss = compute_possessions(r["team_fga"], r["team_oreb"], r["team_tov"], r["team_fta"])
        opp_poss  = compute_possessions(r["opp_fga"],  r["opp_oreb"],  r["opp_tov"],  r["opp_fta"])
        pace      = compute_pace(team_poss, opp_poss, r["minutes"])
        pace_updates.append((round(pace, 2), r["rid"]))

    conn.executemany("UPDATE team_games SET pace = ? WHERE rowid = ?", pace_updates)
    conn.commit()
    log.info(f"[{label}] Pace computed for {len(pace_updates)} rows.")


# -----------------------------------------------------------------------
# Entrypoint
# -----------------------------------------------------------------------

def needs_player_refresh(conn, label):
    """Only pull player roster if we have fewer than 100 players — i.e. first run."""
    count = conn.execute(
        "SELECT COUNT(*) FROM players WHERE season=?", (label,)
    ).fetchone()[0]
    return count < 100


def get_or_refresh_players(conn, season_end_year):
    label = season_label(season_end_year)
    if needs_player_refresh(conn, label):
        return refresh_players(conn, season_end_year)
    else:
        log.info(f"[{label}] Player roster already complete, skipping.")
        return [r[0] for r in conn.execute(
            "SELECT slug FROM players WHERE season=?", (label,)
        )]


def refresh_schedule(conn, season_end_year):
    """Fetch the full season schedule and store upcoming games in nba_schedule."""
    log.info(f"Refreshing schedule for {season_end_year}...")
    try:
        games = client.season_schedule(season_end_year=season_end_year)
    except Exception as e:
        log.warning(f"Schedule fetch failed: {e}")
        return
    today = date.today()
    rows = [
        (
            g["start_time"].date().isoformat(),
            g["home_team"].value,
            g["away_team"].value,
            season_end_year,
        )
        for g in games
        if g["start_time"].date() >= today
    ]
    conn.execute("DELETE FROM nba_schedule WHERE season = ?", (season_end_year,))
    conn.executemany(
        "INSERT OR IGNORE INTO nba_schedule (game_date, home_team, away_team, season) VALUES (?,?,?,?)",
        rows,
    )
    conn.commit()
    log.info(f"Stored {len(rows)} upcoming games in nba_schedule.")


def run(seasons):
    init_db()
    conn = get_conn()

    for season_end_year in seasons:
        log.info("=" * 50)
        log.info(f"Starting refresh for season: {season_label(season_end_year)}")
        log.info("=" * 50)

        slugs = get_or_refresh_players(conn, season_end_year)

        # Always refresh team game logs — the function skips dates already in the DB
        refresh_team_game_logs(conn, season_end_year)

        refresh_player_game_logs(conn, season_end_year, slugs)

        refresh_schedule(conn, season_end_year)

        log.info(f"[{season_label(season_end_year)}] Refresh complete.")

    conn.close()
    log.info("All done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--season",
        action="append",
        dest="seasons",
        type=int,
        help="Season end year e.g. 2024 for 2023-24.",
    )
    args    = parser.parse_args()
    seasons = args.seasons or DEFAULT_SEASONS
    run(seasons)
