"""
Weekly risers and fallers — runs Monday 9am ET.
Posts risers/fallers graphic + deep dive on the biggest mover 30 min later.
"""

import hashlib
import logging
import time
from datetime import date

import api_client as api
import claude_gen as claude
import renderer
import db
from publishers import twitter, instagram

log = logging.getLogger(__name__)

CONTENT_TYPE = "risers_fallers"

_DRIVER_LABELS = {
    "pts":   "Scoring",
    "reb":   "Rebounding",
    "ast":   "Assists",
    "stl":   "Steals",
    "blk":   "Blocks",
    "fg3m":  "3-Pointers",
    "tov":   "Turnovers",
    "fg_pct": "FG%",
}

_DRIVER_TAGS = ["rate change", "role", "pace", "schedule", "matchup"]


def _top_stat_change(player: dict) -> tuple[str, str]:
    """Return (stat_label, driver_tag) for the player's most notable change."""
    cats  = ["pts", "reb", "ast", "stl", "blk", "fg3m"]
    z_now = {c: abs(player.get(f"z_{c}") or 0) for c in cats}
    top_cat = max(z_now, key=z_now.get, default="pts")
    delta   = player.get("z_delta", 0)
    val     = player.get(top_cat) or 0
    sign    = "+" if delta >= 0 else ""
    label   = f"{top_cat.upper()} {sign}{delta:+.1f}z"
    # Simple heuristic for driver tag
    if abs(delta) > 1.5:
        tag = "rate change"
    elif player.get(f"z_{top_cat}", 0) > 1.0:
        tag = "role"
    else:
        tag = "matchup"
    return label, tag


def _build_mover_rows(movers: list[dict]) -> list[dict]:
    rows = []
    for p in movers:
        stat_label, driver = _top_stat_change(p)
        rows.append({
            "name":       p["name"],
            "team":       p.get("team", ""),
            "stat_label": stat_label,
            "driver":     driver,
        })
    return rows


def _deepdive_data(player: dict) -> dict:
    """Build template data for the player deep dive graphic."""
    cats = ["pts", "reb", "ast", "stl", "blk", "fg3m"]
    drivers = []
    for cat in cats:
        z_now  = player.get(f"z_{cat}") or 0
        z_base = player.get("z_base", 0)
        drivers.append({"label": _DRIVER_LABELS.get(cat, cat.upper()), "value": round(z_now - (z_base / len(cats)), 2)})

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
        risers, fallers = api.risers_and_fallers(n=3)
        if not risers and not fallers:
            db.log_run(CONTENT_TYPE, "skipped", "no mover data")
            return {"status": "skipped", "reason": "no mover data"}

        # ── Risers/Fallers graphic ──────────────────────────────────────────
        riser_rows  = _build_mover_rows(risers)
        faller_rows = _build_mover_rows(fallers)

        rf_path = renderer.render_and_screenshot(
            "risers_fallers.html",
            {"risers": riser_rows, "fallers": faller_rows},
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
