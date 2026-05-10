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
from publishers import twitter, instagram

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

        usage_stats = [
            {"label": "MIN/G", "delta": min_delta, "fmt": f"{min_delta:+.1f}"},
            {"label": "FGA/G", "delta": fga_delta, "fmt": f"{fga_delta:+.1f}"},
            {"label": "FG%",   "delta": fgp_delta, "fmt": f"{fgp_delta:+.1f}%"},
        ]

        # Dominant signal determines label; normalize each to comparable scale
        min_sig = abs(min_delta) / 2.0
        fga_sig = abs(fga_delta) / 1.5
        fgp_sig = abs(fgp_delta) / 4.0
        dominant = max([("min", min_sig, min_delta), ("fga", fga_sig, fga_delta), ("fgp", fgp_sig, fgp_delta)], key=lambda x: x[1])
        kind, _, val = dominant
        if kind == "min":
            diagnosis = "role increase" if val > 0 else "role decrease"
        elif kind == "fga":
            diagnosis = "usage increase" if val > 0 else "usage decrease"
        else:
            diagnosis = "hot streak" if val > 0 else "cold stretch"

        rows.append({
            "name":        p["name"],
            "team":        api.abbrev_team(p.get("team", "")),
            "z_delta_fmt": f"{z_delta:+.1f}",
            "drivers":     drivers,
            "usage_stats": usage_stats,
            "diagnosis":   diagnosis,
        })
    return rows


def _deepdive_data(player: dict) -> dict:
    """Build template data for the player deep dive graphic."""
    cats = ["pts", "reb", "ast", "stl", "blk", "fg3m"]
    drivers = []
    for cat in cats:
        z_now  = player.get(f"z_{cat}") or 0
        z_base = player.get("z_base", 0)
        drivers.append({"label": _CAT_LABELS.get(cat, cat.upper()), "value": round(z_now - (z_base / len(cats)), 2)})

    drivers_sorted = sorted(drivers, key=lambda d: abs(d["value"]), reverse=True)[:4]
    max_driver = max((abs(d["value"]) for d in drivers_sorted), default=1) or 1
    for d in drivers_sorted:
        d["bar_pct"] = round(max(min(abs(d["value"]) / max_driver * 100, 100), 4), 1)

    stat_rows = []
    for cat in cats[:5]:
        baseline = round((player.get("z_base") or 0) * 0.3 + (player.get(cat) or 0) * 0.7, 1)
        current  = player.get(cat) or 0
        stat_rows.append({
            "label":    cat.upper(),
            "baseline": baseline,
            "current":  current,
        })

    return {
        "player": {
            "name":        player["name"],
            "team":        player.get("team", ""),
            "position":    player.get("position", ""),
            "trending_up": (player.get("z_delta") or 0) > 0,
        },
        "drivers":    drivers_sorted,
        "max_driver": max_driver,
        "stat_rows":  stat_rows,
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

        # Post risers/fallers
        rf_tweet_id = twitter.tweet(rf_tweet, image_path=rf_path)
        db.log_post(CONTENT_TYPE, "twitter", rf_hash,
                    copy_preview=rf_tweet[:120], post_id=rf_tweet_id,
                    template="risers_fallers.html",
                    graphic_name=rf_path.split("/")[-1])

        # Instagram
        try:
            ig_id = instagram.upload_local_image(rf_path, rf_caption)
            db.log_post(CONTENT_TYPE, "instagram", rf_hash,
                        copy_preview=rf_caption[:120], post_id=ig_id,
                        template="risers_fallers.html",
                        graphic_name=rf_path.split("/")[-1])
        except NotImplementedError:
            log.warning("[%s] Instagram skipped — no CDN uploader", CONTENT_TYPE)
        except Exception as exc:
            log.error("[%s] Instagram failed: %s", CONTENT_TYPE, exc)

        renderer.cleanup(rf_path)

        # Post deep dive as reply 30 minutes later (or immediately in preview)
        if dd_tweet and dd_path:
            log.info("[%s] Waiting 30 min before deep dive reply…", CONTENT_TYPE)
            if not preview:
                time.sleep(1800)
            dd_hash   = hashlib.sha256(dd_tweet.encode()).hexdigest()[:16]
            dd_tweet_id = twitter.tweet(dd_tweet, image_path=dd_path,
                                        reply_to_id=rf_tweet_id)
            db.log_post(CONTENT_TYPE + "_deepdive", "twitter", dd_hash,
                        copy_preview=dd_tweet[:120], post_id=dd_tweet_id,
                        template="player_deepdive.html",
                        graphic_name=dd_path.split("/")[-1])
            renderer.cleanup(dd_path)
            result["dd_tweet_id"] = dd_tweet_id

        db.log_run(CONTENT_TYPE, "success")
        result["rf_tweet_id"] = rf_tweet_id
        return result

    except Exception as exc:
        log.exception("[%s] Unhandled error", CONTENT_TYPE)
        db.log_run(CONTENT_TYPE, "error", str(exc))
        return {"status": "error", "detail": str(exc)}
