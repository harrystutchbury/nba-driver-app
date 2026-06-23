"""
Weekly best performers content — runs Monday 8am ET.
Pulls top 10 l14-period players by z-score, renders graphic, posts to Twitter + Instagram.
"""

import hashlib
import logging
from datetime import date, timedelta

import api_client as api
import claude_gen as claude
import renderer
import db
from publishers import buffer, cdn

log = logging.getLogger(__name__)

CONTENT_TYPE = "weekly_performers"

_CAT_LABELS = {
    "pts":    "PTS",
    "reb":    "REB",
    "ast":    "AST",
    "stl":    "STL",
    "blk":    "BLK",
    "fg3m":   "3PM",
    "fg_pct": "FG%",
}


def _top_stats_for_player(player: dict, n: int = 3) -> list[dict]:
    cats = ["pts", "reb", "ast", "stl", "blk", "fg3m"]
    scored = []
    for cat in cats:
        val = player.get(cat)
        z   = player.get(f"z_{cat}") or 0
        if val is not None:
            scored.append({"label": _CAT_LABELS[cat], "value": f"{val:.1f}", "z": z})
    scored.sort(key=lambda x: x["z"], reverse=True)
    return scored[:n]


def _build_player_rows(players: list[dict]) -> list[dict]:
    rows = []
    for p in players:
        rows.append({
            "name":     p["name"],
            "team":     api.abbrev_team(p.get("team", "")),
            "position": p.get("position", ""),
            "pts":      p.get("pts"),   "z_pts":  p.get("z_pts")  or 0,
            "reb":      p.get("reb"),   "z_reb":  p.get("z_reb")  or 0,
            "ast":      p.get("ast"),   "z_ast":  p.get("z_ast")  or 0,
            "stl":      p.get("stl"),   "z_stl":  p.get("z_stl")  or 0,
            "blk":      p.get("blk"),   "z_blk":  p.get("z_blk")  or 0,
            "fg3m":     p.get("fg3m"),  "z_fg3m": p.get("z_fg3m") or 0,
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
        top_players = api.season_rankings("l14")[:10]
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

        # Upload graphic, post to X + Instagram via Buffer
        graphic_url = cdn.upload(graphic_path, public_id=f"weekly_performers_{graphic_path.split('/')[-1].replace('.png','')}")
        update_ids  = buffer.post(lead_tweet, image_url=graphic_url)
        db.log_post(
            CONTENT_TYPE, "buffer", copy_hash,
            copy_preview=lead_tweet[:120],
            post_id=update_ids[0] if update_ids else None,
            template="weekly_performers.html",
            graphic_name=graphic_path.split("/")[-1],
        )

        # Thread follow-ups — X only, text only
        for tweet_text in thread_tweets:
            buffer.post(tweet_text, channel_ids=buffer._x_channels())

        renderer.cleanup(graphic_path)
        db.log_run(CONTENT_TYPE, "success")
        result["update_ids"] = update_ids
        return result

    except Exception as exc:
        log.exception("[%s] Unhandled error", CONTENT_TYPE)
        db.log_run(CONTENT_TYPE, "error", str(exc))
        return {"status": "error", "detail": str(exc)}
