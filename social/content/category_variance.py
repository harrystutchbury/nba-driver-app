"""
Category variance analysis — generates a static HTML chart showing:
  1. Week-to-week volatility (CV of per-game averages across weeks)
  2. Season-to-season consistency (median absolute % change YoY)

Run: python category_variance.py [--seasons 2022-23+]
Output: ../templates/category_variance.html (viewable / screenshot-ready)
"""

import sqlite3, statistics, os, json, argparse
from collections import defaultdict
from datetime import datetime
from jinja2 import Environment, FileSystemLoader

DB_PATH  = os.path.join(os.path.dirname(__file__), "../../backend/data/nba.db")
TPL_DIR  = os.path.join(os.path.dirname(__file__), "../templates")
OUT_FILE = os.path.join(TPL_DIR, "category_variance.html")

CATS     = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m"]
PCT_CATS = ["fg_pct", "ft_pct"]
ALL_CATS = CATS + PCT_CATS

CAT_LABELS = {
    "pts": "PTS", "reb": "REB", "ast": "AST", "stl": "STL",
    "blk": "BLK", "tov": "TOV", "fg3m": "3PM",
    "fg_pct": "FG%", "ft_pct": "FT%",
}


def _cv(vals):
    if len(vals) < 3:
        return None
    mean = sum(vals) / len(vals)
    if mean < 0.01:
        return None
    return statistics.stdev(vals) / mean * 100


def week_cv(conn, min_season="2022-23"):
    rows = conn.execute("""
        SELECT player_slug, season,
               strftime('%Y-%W', game_date) AS week,
               pts, reb, ast, stl, blk, tov, fg3m,
               fgm, fga, ftm, fta
        FROM game_logs
        WHERE min >= 10 AND season >= ?
    """, (min_season,)).fetchall()

    player_weeks = defaultdict(lambda: defaultdict(list))
    for r in rows:
        player_weeks[(r["player_slug"], r["season"])][r["week"]].append(r)

    cat_cvs = defaultdict(list)
    for (slug, season), weeks in player_weeks.items():
        if len(weeks) < 8:
            continue
        week_vals = defaultdict(list)
        for games in weeks.values():
            n = len(games)
            for cat in CATS:
                week_vals[cat].append(sum(g[cat] or 0 for g in games) / n)
            fga = sum(g["fga"] or 0 for g in games)
            fgm = sum(g["fgm"] or 0 for g in games)
            fta = sum(g["fta"] or 0 for g in games)
            ftm = sum(g["ftm"] or 0 for g in games)
            if fga >= 2:
                week_vals["fg_pct"].append(fgm / fga * 100)
            if fta >= 1:
                week_vals["ft_pct"].append(ftm / fta * 100)

        for cat, vals in week_vals.items():
            if len(vals) < 6:
                continue
            cv = _cv(vals)
            if cv is not None:
                cat_cvs[cat].append(cv)

    return {cat: statistics.median(v) for cat, v in cat_cvs.items() if v}


def season_cv(conn):
    rows = conn.execute("""
        SELECT player_slug, season,
               AVG(pts) pts, AVG(reb) reb, AVG(ast) ast,
               AVG(stl) stl, AVG(blk) blk, AVG(tov) tov, AVG(fg3m) fg3m,
               SUM(fgm)*100.0/NULLIF(SUM(fga),0) fg_pct,
               SUM(ftm)*100.0/NULLIF(SUM(fta),0) ft_pct,
               COUNT(*) gp
        FROM game_logs
        WHERE min >= 10
        GROUP BY player_slug, season
        HAVING gp >= 20
        ORDER BY player_slug, season
    """).fetchall()

    by_player = defaultdict(list)
    for r in rows:
        by_player[r["player_slug"]].append(r)

    cat_changes = defaultdict(list)
    for seasons in by_player.values():
        if len(seasons) < 2:
            continue
        for i in range(len(seasons) - 1):
            a, b = seasons[i], seasons[i + 1]
            for cat in CATS:
                v1, v2 = a[cat], b[cat]
                if v1 and v1 > 0.05 and v2 is not None:
                    pct = abs(v2 - v1) / v1 * 100
                    if pct < 300:
                        cat_changes[cat].append(pct)
            for cat in PCT_CATS:
                v1, v2 = a[cat], b[cat]
                if v1 and v2:
                    # Express as % of baseline so it's on same scale
                    pct = abs(v2 - v1) / v1 * 100
                    if pct < 300:
                        cat_changes[cat].append(pct)

    return {cat: statistics.median(v) for cat, v in cat_changes.items() if v}


def _rank_color(rank, total):
    """Red for most volatile, green for least."""
    pct = rank / total
    if pct <= 0.33:
        return "#ff5252"
    if pct <= 0.66:
        return "#f5a623"
    return "#00e676"


def build_rows(data, reverse_sort=True):
    """Return sorted list of row dicts with bar widths + colors."""
    items = [(cat, data[cat]) for cat in ALL_CATS if cat in data]
    items.sort(key=lambda x: x[1], reverse=reverse_sort)
    max_val = items[0][1] if items else 1
    total = len(items)
    rows = []
    for rank, (cat, val) in enumerate(items, 1):
        rows.append({
            "cat":    CAT_LABELS[cat],
            "val":    round(val, 1),
            "width":  round(val / max_val * 100, 1),
            "color":  _rank_color(rank, total),
        })
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seasons", default="2022-23",
                        help="Min season for week-to-week analysis")
    args = parser.parse_args()

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    print("Computing week-to-week variance…")
    ww = week_cv(conn, args.seasons)
    print("Computing season-to-season variance…")
    ss = season_cv(conn)
    conn.close()

    ww_rows = build_rows(ww)
    ss_rows = build_rows(ss)

    season_label = datetime.now().strftime("%Y")

    env = Environment(loader=FileSystemLoader(TPL_DIR))
    tpl = env.get_template("category_variance.html")
    html = tpl.render(
        ww_rows=ww_rows,
        ss_rows=ss_rows,
        season_label=season_label,
        generated=datetime.now().strftime("%b %d, %Y"),
    )

    with open(OUT_FILE, "w") as f:
        f.write(html)
    print(f"Written → {OUT_FILE}")

    # Also print data summary
    print("\nWeek-to-week CV (median):")
    for r in ww_rows:
        print(f"  {r['cat']:5s}: {r['val']:.1f}%")
    print("\nSeason-to-season median % change:")
    for r in ss_rows:
        print(f"  {r['cat']:5s}: {r['val']:.1f}%")


if __name__ == "__main__":
    main()
