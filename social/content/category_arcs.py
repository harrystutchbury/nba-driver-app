"""
Career arc analysis — per-30 min stats by age.
Every player's arc as a faint line; median + 25th/75th percentile in green.
"""

import sqlite3, os, base64
from io import BytesIO
from datetime import date, datetime
from collections import defaultdict

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

from jinja2 import Environment, FileSystemLoader

DB_PATH  = os.path.join(os.path.dirname(__file__), "../../backend/data/nba.db")
TPL_DIR  = os.path.join(os.path.dirname(__file__), "../templates")
OUT_FILE = os.path.join(TPL_DIR, "category_arcs.html")

CATS = [
    {"key": "pts",    "label": "PTS / 30",  "per30": True,  "cap": 60,  "ymin": 0},
    {"key": "reb",    "label": "REB / 30",  "per30": True,  "cap": 25,  "ymin": 0},
    {"key": "ast",    "label": "AST / 30",  "per30": True,  "cap": 20,  "ymin": 0},
    {"key": "stl",    "label": "STL / 30",  "per30": True,  "cap":  6,  "ymin": 0},
    {"key": "blk",    "label": "BLK / 30",  "per30": True,  "cap":  6,  "ymin": 0},
    {"key": "tov",    "label": "TOV / 30",  "per30": True,  "cap": 12,  "ymin": 0},
    {"key": "fg3m",   "label": "3PM / 30",  "per30": True,  "cap":  8,  "ymin": 0},
    {"key": "fg_pct", "label": "FG %",      "per30": False, "cap": 75,  "ymin": 30},
    {"key": "ft_pct", "label": "FT %",      "per30": False, "cap": 100, "ymin": 50},
]

BG      = "#0a0e1a"
SURFACE = "#141824"
BORDER  = "#1e2740"
GREEN   = "#00e676"
MUTED   = "#8892a4"
WHITE   = "#ffffff"

MIN_AGE = 19
MAX_AGE = 38
MIN_GP  = 20
MIN_MPG = 10


def load_arcs(conn):
    rows = conn.execute("""
        SELECT gl.player_slug,
               gl.season,
               MIN(gl.game_date) AS season_start,
               pb.birthdate,
               SUM(gl.min)  total_min,
               SUM(gl.pts)  total_pts,
               SUM(gl.reb)  total_reb,
               SUM(gl.ast)  total_ast,
               SUM(gl.stl)  total_stl,
               SUM(gl.blk)  total_blk,
               SUM(gl.tov)  total_tov,
               SUM(gl.fg3m) total_fg3m,
               SUM(gl.fgm)  total_fgm,
               SUM(gl.fga)  total_fga,
               SUM(gl.ftm)  total_ftm,
               SUM(gl.fta)  total_fta,
               COUNT(*)     gp
        FROM game_logs gl
        JOIN player_id_map pm ON gl.player_slug = pm.br_slug
        JOIN player_bio pb ON pb.nba_id = pm.nba_id
        WHERE pb.birthdate IS NOT NULL AND gl.min >= :min_mpg
        GROUP BY gl.player_slug, gl.season
        HAVING gp >= :min_gp
    """, {"min_mpg": MIN_MPG, "min_gp": MIN_GP}).fetchall()

    player_seasons = defaultdict(list)

    for r in rows:
        try:
            bd = date.fromisoformat(r["birthdate"])
            sd = date.fromisoformat(r["season_start"])
        except (TypeError, ValueError):
            continue

        age = (sd - bd).days // 365
        if not (MIN_AGE <= age <= MAX_AGE):
            continue

        total_min = r["total_min"] or 0
        if total_min < 1:
            continue

        scale = 30.0 / total_min
        stats = {}
        for key in ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m"]:
            val = r[f"total_{key}"]
            stats[key] = (val or 0) * scale

        fga = r["total_fga"] or 0
        fgm = r["total_fgm"] or 0
        fta = r["total_fta"] or 0
        ftm = r["total_ftm"] or 0
        stats["fg_pct"] = fgm / fga * 100 if fga >= 20 else None
        stats["ft_pct"] = ftm / fta * 100 if fta >= 10 else None

        player_seasons[r["player_slug"]].append((age, stats))

    result = {}
    for slug, seasons in player_seasons.items():
        seasons.sort(key=lambda x: x[0])
        if len(seasons) >= 2:
            result[slug] = seasons

    return result


def make_figure(arcs):
    age_pools   = {c["key"]: defaultdict(list) for c in CATS}
    player_lines = {c["key"]: [] for c in CATS}

    for slug, seasons in arcs.items():
        for cat in CATS:
            ckey = cat["key"]
            xs, ys = [], []
            for age, stats in seasons:
                v = stats.get(ckey)
                if v is not None and cat["ymin"] <= v <= cat["cap"]:
                    xs.append(age)
                    ys.append(v)
                    age_pools[ckey][age].append(v)
            if len(xs) >= 2:
                player_lines[ckey].append((xs, ys))

    plt.rcParams.update({
        "font.family":     "sans-serif",
        "font.sans-serif": ["Helvetica Neue", "Helvetica", "Arial", "DejaVu Sans"],
        "axes.facecolor":  SURFACE,
        "figure.facecolor": BG,
        "text.color":      WHITE,
        "axes.labelcolor": MUTED,
        "xtick.color":     MUTED,
        "ytick.color":     MUTED,
        "axes.edgecolor":  BORDER,
        "grid.color":      BORDER,
        "grid.linewidth":  0.4,
        "axes.grid":       True,
        "axes.grid.axis":  "y",
    })

    fig, axes = plt.subplots(
        3, 3,
        figsize=(10.8, 11.4),
        dpi=100,
        gridspec_kw={"hspace": 0.58, "wspace": 0.40},
    )
    fig.patch.set_facecolor(BG)

    for ax, cat in zip(axes.flat, CATS):
        ckey = cat["key"]

        # Individual player arcs — very faint
        for xs, ys in player_lines[ckey]:
            ax.plot(xs, ys, color=MUTED, alpha=0.045, linewidth=0.5,
                    solid_capstyle="round", zorder=1)

        # Aggregate at each age
        valid_ages = sorted(
            a for a in age_pools[ckey]
            if MIN_AGE <= a <= MAX_AGE and len(age_pools[ckey][a]) >= 10
        )
        if valid_ages:
            medians = [float(np.median(age_pools[ckey][a])) for a in valid_ages]
            p25     = [float(np.percentile(age_pools[ckey][a], 25)) for a in valid_ages]
            p75     = [float(np.percentile(age_pools[ckey][a], 75)) for a in valid_ages]

            # IQR band
            ax.fill_between(valid_ages, p25, p75, color=GREEN, alpha=0.10, zorder=2)
            # 25th / 75th lines
            ax.plot(valid_ages, p25, color=GREEN, alpha=0.50, linewidth=1.1,
                    linestyle="--", zorder=3)
            ax.plot(valid_ages, p75, color=GREEN, alpha=0.50, linewidth=1.1,
                    linestyle="--", zorder=3)
            # Median
            ax.plot(valid_ages, medians, color=GREEN, linewidth=2.3,
                    solid_capstyle="round", zorder=4)

        ax.set_title(cat["label"], color=WHITE, fontsize=10, fontweight="bold",
                     loc="left", pad=7)
        ax.set_xlim(MIN_AGE - 0.5, MAX_AGE + 0.5)
        ax.set_ylim(bottom=cat["ymin"])
        ax.set_xticks(range(20, MAX_AGE + 1, 5))
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["left"].set_color(BORDER)
        ax.spines["bottom"].set_color(BORDER)
        ax.tick_params(labelsize=7.5, length=2, pad=3)

    # Legend
    handles = [
        Line2D([0], [0], color=MUTED, alpha=0.5, linewidth=1.0,
               label="Individual player season"),
        Line2D([0], [0], color=GREEN, linewidth=2.2, label="Median"),
        Line2D([0], [0], color=GREEN, alpha=0.6, linewidth=1.1, linestyle="--",
               label="25th / 75th %ile"),
        Patch(facecolor=GREEN, alpha=0.18, edgecolor="none", label="IQR band"),
    ]
    fig.legend(
        handles=handles, loc="lower center", ncol=4, frameon=False,
        labelcolor=MUTED, fontsize=8.5, bbox_to_anchor=(0.5, 0.005),
    )

    buf = BytesIO()
    fig.savefig(buf, format="png", dpi=100, bbox_inches="tight",
                facecolor=BG, pad_inches=0.3)
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode()


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    print("Loading player arcs…")
    arcs = load_arcs(conn)
    conn.close()
    print(f"  {len(arcs)} qualifying careers loaded")

    print("Building figure…")
    chart_b64 = make_figure(arcs)

    env = Environment(loader=FileSystemLoader(TPL_DIR))
    tpl = env.get_template("category_arcs.html")
    html = tpl.render(
        chart_b64=chart_b64,
        generated=datetime.now().strftime("%b %d, %Y"),
    )

    with open(OUT_FILE, "w") as f:
        f.write(html)
    print(f"Written → {OUT_FILE}")


if __name__ == "__main__":
    main()
