"""
Weekly risers and fallers — runs Monday 9am ET.
Posts risers/fallers graphic + deep dive on the biggest mover 30 min later.
"""

import hashlib
import logging
import time
from datetime import date, timedelta

import api_client as api
import claude_gen as claude
import renderer
import db
from publishers import buffer, cdn

log = logging.getLogger(__name__)

CONTENT_TYPE = "risers_fallers"

def _week_range_label() -> str:
    today  = date.today()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    if monday.month == sunday.month:
        return f"{monday.strftime('%b %-d').upper()}–{sunday.day}"
    return f"{monday.strftime('%b %-d').upper()}–{sunday.strftime('%b %-d').upper()}"


_CAT_LABELS = {
    "pts":  "PTS", "reb":  "REB", "ast":  "AST",
    "stl":  "STL", "blk":  "BLK", "fg3m": "3PM",
}


def _build_mover_rows(movers: list[dict]) -> list[dict]:
    cats = ["pts", "reb", "ast", "stl", "blk", "fg3m"]
    rows = []
    for p in movers:
        z_delta   = p.get("z_delta", 0)
        min_delta = p.get("min_pg_delta") or 0
        fga_delta = p.get("fga_pg_delta") or 0
        fgp_delta = p.get("fg_pct_delta") or 0

        cat_deltas = [(c, p.get(f"z_{c}_delta") or 0) for c in cats]
        top_cats   = sorted(cat_deltas, key=lambda x: abs(x[1]), reverse=True)[:3]
        drivers    = [f"{_CAT_LABELS.get(c, c.upper())} {v:+.1f}z" for c, v in top_cats]

        drivers_grid = [
            {
                "stat_label": "MIN/G",
                "stat_fmt":   f"{min_delta:+.1f}",
                "delta":      min_delta,
                "label":      "ROLE INCREASE" if min_delta > 0 else "ROLE DECREASE",
                "active":     abs(min_delta) >= 2.0,
            },
            {
                "stat_label": "FGA/G",
                "stat_fmt":   f"{fga_delta:+.1f}",
                "delta":      fga_delta,
                "label":      "USAGE INCREASE" if fga_delta > 0 else "USAGE DECREASE",
                "active":     abs(fga_delta) >= 1.5,
            },
            {
                "stat_label": "FG%",
                "stat_fmt":   f"{fgp_delta:+.1f}%",
                "delta":      fgp_delta,
                "label":      "HOT STREAK" if fgp_delta > 0 else "COLD STRETCH",
                "active":     abs(fgp_delta) >= 4.0,
            },
        ]

        rows.append({
            "name":         p["name"],
            "team":         api.abbrev_team(p.get("team", "")),
            "z_delta_fmt":  f"{z_delta:+.1f}",
            "drivers":      drivers,
            "drivers_grid": drivers_grid,
        })
    return rows


def _deepdive_data(player: dict) -> dict:
    """Build template data for the player deep dive graphic."""
    cats = ["pts", "reb", "ast", "stl", "blk", "fg3m"]

    z_delta    = player.get("z_delta") or 0
    min_window = player.get("min_pg") or 0
    fga_window = player.get("fga_pg") or 0
    fg_window  = player.get("fg_pct") or 0
    min_delta  = player.get("min_pg_delta") or 0
    fga_delta  = player.get("fga_pg_delta") or 0
    fg_delta   = player.get("fg_pct_delta") or 0
    min_season = round(min_window - min_delta, 1)
    fga_season = round(fga_window - fga_delta, 1)
    fg_season  = round(fg_window - fg_delta, 1)

    drivers = []
    for cat in cats:
        contribution = player.get(f"z_{cat}_delta") or 0
        drivers.append({
            "stat":         cat,
            "label":        _CAT_LABELS.get(cat, cat.upper()),
            "contribution": contribution,
        })
    drivers = sorted(drivers, key=lambda d: abs(d["contribution"]), reverse=True)[:5]
    max_abs = max((abs(d["contribution"]) for d in drivers), default=1) or 1
    for d in drivers:
        d["bar_pct"] = round(max(abs(d["contribution"]) / max_abs * 100, 2), 1)

    # Sustainability verdict driven by strongest usage signal
    role_active  = abs(min_delta) >= 2.0
    usage_active = abs(fga_delta) >= 1.5
    fg_active    = abs(fg_delta)  >= 4.0
    if role_active:
        verdict_label  = "ROLE INCREASE" if min_delta > 0 else "ROLE DECREASE"
        verdict_reason = f"{'Extra' if min_delta > 0 else 'Fewer'} {abs(min_delta):.1f} min/g vs season baseline"
        level = "strong" if z_delta > 0 else "warn"
    elif usage_active:
        verdict_label  = "USAGE INCREASE" if fga_delta > 0 else "USAGE DECREASE"
        verdict_reason = f"{'More' if fga_delta > 0 else 'Fewer'} shot attempts ({fga_delta:+.1f} FGA/g)"
        level = "moderate" if z_delta > 0 else "warn"
    elif fg_active:
        verdict_label  = "HOT STREAK" if fg_delta > 0 else "COLD STRETCH"
        verdict_reason = f"Shooting {fg_delta:+.1f}% vs season average — efficiency driven"
        level = "weak" if z_delta > 0 else "warn"
    else:
        verdict_label  = "MIXED SIGNALS"
        verdict_reason = "No dominant driver — trend may normalize"
        level = "weak"

    return {
        "player": {
            "name":        player["name"],
            "team":        api.abbrev_team(player.get("team", "")),
            "trending_up": z_delta > 0,
            "z_delta_fmt": f"{z_delta:+.2f}",
        },
        "usage_grid": [
            {
                "stat_label": "MIN/G",
                "stat_fmt":   f"{min_delta:+.1f}",
                "delta":      min_delta,
                "label":      "ROLE INCREASE" if min_delta > 0 else "ROLE DECREASE",
                "active":     abs(min_delta) >= 2.0,
            },
            {
                "stat_label": "FGA/G",
                "stat_fmt":   f"{fga_delta:+.1f}",
                "delta":      fga_delta,
                "label":      "USAGE INCREASE" if fga_delta > 0 else "USAGE DECREASE",
                "active":     abs(fga_delta) >= 1.5,
            },
            {
                "stat_label": "FG%",
                "stat_fmt":   f"{fg_delta:+.1f}%",
                "delta":      fg_delta,
                "label":      "HOT STREAK" if fg_delta > 0 else "COLD STRETCH",
                "active":     abs(fg_delta) >= 4.0,
            },
        ],
        "season_z": round(player.get("z_base") or 0, 2),
        "window_z": round(player.get("z_total") or 0, 2),
        "drivers":  drivers,
        "verdict":  {"label": verdict_label, "reason": verdict_reason, "level": level},
    }


def run(preview: bool = False) -> dict:
    if not api.data_freshness_ok():
        db.log_run(CONTENT_TYPE, "skipped", "data stale")
        return {"status": "skipped", "reason": "data stale"}

    if not api.is_season_active():
        db.log_run(CONTENT_TYPE, "skipped", "off-season")
        return {"status": "skipped", "reason": "off-season"}

    try:
        risers, fallers = api.risers_and_fallers(n=5)
        if not risers and not fallers:
            db.log_run(CONTENT_TYPE, "skipped", "no mover data")
            return {"status": "skipped", "reason": "no mover data"}

        # ── Risers/Fallers graphic ──────────────────────────────────────────
        riser_rows  = _build_mover_rows(risers)
        faller_rows = _build_mover_rows(fallers)

        rf_path = renderer.render_and_screenshot(
            "risers_fallers.html",
            {"risers": riser_rows, "fallers": faller_rows, "date_range": _week_range_label()},
            f"risers_fallers_{date.today().isoformat()}",
            format="square",
        )

        rf_tweet  = claude.risers_fallers_tweet(risers, fallers)
        rf_caption = claude.instagram_caption("weekly movers", risers + fallers)
        rf_hash   = hashlib.sha256(rf_tweet.encode()).hexdigest()[:16]

        result = {
            "status":     "preview" if preview else "published",
            "rf_graphic": rf_path,
            "rf_tweet":   rf_tweet,
            "rf_caption": rf_caption,
        }

        # ── Biggest mover deep dive ─────────────────────────────────────────
        biggest_mover = (
            max(risers + fallers, key=lambda p: abs(p.get("z_delta", 0)), default=None)
        )
        dd_path = None
        dd_tweet = None
        if biggest_mover:
            dd_data = _deepdive_data(biggest_mover)
            dd_path = renderer.render_and_screenshot(
                "player_deepdive.html",
                dd_data,
                f"deepdive_{biggest_mover['slug']}_{date.today().isoformat()}",
                format="square",
            )
            dd_tweet = claude.deepdive_tweet(biggest_mover)
            result["dd_graphic"] = dd_path
            result["dd_tweet"]   = dd_tweet
            result["mover"]      = biggest_mover["name"]

        if preview:
            return result

        if db.is_duplicate(rf_hash):
            log.info("[%s] Duplicate — skipping", CONTENT_TYPE)
            renderer.cleanup(rf_path)
            if dd_path:
                renderer.cleanup(dd_path)
            db.log_run(CONTENT_TYPE, "skipped", "duplicate")
            return {"status": "skipped", "reason": "duplicate"}

        # Post risers/fallers to X + Instagram via Buffer
        rf_url       = cdn.upload(rf_path, public_id=f"risers_fallers_{rf_path.split('/')[-1].replace('.png','')}")
        rf_update_ids = buffer.post(rf_tweet, image_url=rf_url)
        db.log_post(CONTENT_TYPE, "buffer", rf_hash,
                    copy_preview=rf_tweet[:120], post_id=rf_update_ids[0] if rf_update_ids else None,
                    template="risers_fallers.html",
                    graphic_name=rf_path.split("/")[-1])
        renderer.cleanup(rf_path)

        # Deep dive — X only, posted 30 min later as a separate post (Buffer doesn't support replies)
        if dd_tweet and dd_path:
            log.info("[%s] Waiting 30 min before deep dive post…", CONTENT_TYPE)
            if not preview:
                time.sleep(1800)
            dd_hash      = hashlib.sha256(dd_tweet.encode()).hexdigest()[:16]
            dd_url       = cdn.upload(dd_path, public_id=f"deepdive_{dd_path.split('/')[-1].replace('.png','')}")
            dd_update_ids = buffer.post(dd_tweet, image_url=dd_url, channel_ids=buffer._x_channels())
            db.log_post(CONTENT_TYPE + "_deepdive", "buffer", dd_hash,
                        copy_preview=dd_tweet[:120], post_id=dd_update_ids[0] if dd_update_ids else None,
                        template="player_deepdive.html",
                        graphic_name=dd_path.split("/")[-1])
            renderer.cleanup(dd_path)
            result["dd_update_ids"] = dd_update_ids

        db.log_run(CONTENT_TYPE, "success")
        result["rf_update_ids"] = rf_update_ids
        return result

    except Exception as exc:
        log.exception("[%s] Unhandled error", CONTENT_TYPE)
        db.log_run(CONTENT_TYPE, "error", str(exc))
        return {"status": "error", "detail": str(exc)}
