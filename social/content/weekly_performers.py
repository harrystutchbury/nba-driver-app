"""
Weekly best performers content — runs Monday 8am ET.
Pulls top 10 projected players for the week, renders graphic, posts to Twitter + Instagram.
"""

import hashlib
import logging
from datetime import date, timedelta

import api_client as api
import claude_gen as claude
import renderer
import db
from publishers import twitter, instagram

log = logging.getLogger(__name__)

CONTENT_TYPE = "weekly_performers"


def _build_player_rows(players: list[dict]) -> list[dict]:
    cats = ["pts", "reb", "ast", "stl", "blk", "fg3m"]
    rows = []
    for p in players:
        scored = sorted(
            [(c, p.get(c) or 0) for c in cats if p.get(c) is not None],
            key=lambda x: x[1],
            reverse=True,
        )
        stats = [
            {"label": c.upper(), "value": f"{v:.1f}"}
            for c, v in scored[:3]
        ]
        rows.append({
            "name":  p["name"],
            "team":  api.abbrev_team(p.get("team", "")),
            "games": p.get("gp") or 0,
            "stats": stats,
        })
    return rows


def _date_range_label() -> str:
    today  = date.today()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    # e.g. "MAY 12–19"
    if monday.month == sunday.month:
        return f"{monday.strftime('%b %-d').upper()}–{sunday.day}"
    return f"{monday.strftime('%b %-d').upper()}–{sunday.strftime('%b %-d').upper()}"


def run(preview: bool = False) -> dict:
    """
    Execute the weekly performers post.
    If preview=True, generate graphics and copy but do not publish.
    Returns a result dict with paths and copy.
    """
    if not api.data_freshness_ok():
        log.warning("[%s] Data stale — skipping post", CONTENT_TYPE)
        db.log_run(CONTENT_TYPE, "skipped", "data stale")
        return {"status": "skipped", "reason": "data stale"}

    if not api.is_season_active():
        log.info("[%s] Off-season mode — skipping", CONTENT_TYPE)
        db.log_run(CONTENT_TYPE, "skipped", "off-season")
        return {"status": "skipped", "reason": "off-season"}

    try:
        top_players = api.top_week_projections(n=10)
        if not top_players:
            db.log_run(CONTENT_TYPE, "skipped", "no players")
            return {"status": "skipped", "reason": "no projection data"}

        # Build template data
        player_rows = _build_player_rows(top_players)

        template_data = {
            "date_range": _date_range_label(),
            "players":    player_rows,
        }

        # Render graphic
        graphic_path = renderer.render_and_screenshot(
            "weekly_performers.html",
            template_data,
            f"weekly_performers_{date.today().isoformat()}",
            format="square",
        )

        # Generate copy
        lead_tweet   = claude.weekly_performers_tweet(top_players)
        thread_tweets = claude.weekly_performers_thread(top_players)
        ig_caption   = claude.instagram_caption("weekly best performers", top_players)

        copy_hash = hashlib.sha256(lead_tweet.encode()).hexdigest()[:16]

        result = {
            "status":       "preview" if preview else "published",
            "graphic":      graphic_path,
            "lead_tweet":   lead_tweet,
            "thread":       thread_tweets,
            "ig_caption":   ig_caption,
            "copy_hash":    copy_hash,
            "players":      player_rows,
        }

        if preview:
            return result

        # Deduplication check
        if db.is_duplicate(copy_hash):
            log.info("[%s] Duplicate detected — skipping", CONTENT_TYPE)
            renderer.cleanup(graphic_path)
            db.log_run(CONTENT_TYPE, "skipped", "duplicate")
            return {"status": "skipped", "reason": "duplicate"}

        # Post to Twitter — thread: lead tweet with graphic, then per-player follow-ups
        all_tweets = [lead_tweet] + thread_tweets
        img_paths  = [graphic_path] + [None] * len(thread_tweets)
        tweet_ids  = twitter.post_thread(all_tweets, image_paths=img_paths)

        db.log_post(
            CONTENT_TYPE, "twitter", copy_hash,
            copy_preview=lead_tweet[:120],
            post_id=tweet_ids[0],
            template="weekly_performers.html",
            graphic_name=graphic_path.split("/")[-1],
        )

        # Post to Instagram
        try:
            ig_id = instagram.upload_local_image(graphic_path, ig_caption)
            db.log_post(
                CONTENT_TYPE, "instagram", copy_hash,
                copy_preview=ig_caption[:120],
                post_id=ig_id,
                template="weekly_performers.html",
                graphic_name=graphic_path.split("/")[-1],
            )
        except NotImplementedError:
            log.warning("[%s] Instagram skipped — no CDN uploader configured", CONTENT_TYPE)
        except Exception as exc:
            log.error("[%s] Instagram failed: %s", CONTENT_TYPE, exc)
            db.log_post(CONTENT_TYPE, "instagram", copy_hash, status="failed", error_msg=str(exc))

        renderer.cleanup(graphic_path)
        db.log_run(CONTENT_TYPE, "success")
        result["tweet_ids"] = tweet_ids
        return result

    except Exception as exc:
        log.exception("[%s] Unhandled error", CONTENT_TYPE)
        db.log_run(CONTENT_TYPE, "error", str(exc))
        return {"status": "error", "detail": str(exc)}
