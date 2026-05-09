"""
Daily projections — runs every day at 7pm ET.
Posts overall top 5 + waiver wire top 5 graphics, then category leaders as text.
"""

import hashlib
import logging
from datetime import date

import api_client as api
import claude_gen as claude
import renderer
import db
from publishers import twitter, instagram

log = logging.getLogger(__name__)

CONTENT_TYPE = "daily_projections"

_CAT_LABELS = {
    "pts":   "PTS",
    "reb":   "REB",
    "ast":   "AST",
    "stl":   "STL",
    "blk":   "BLK",
    "fg3m":  "3PM",
    "fg_pct": "FG%",
    "ft_pct": "FT%",
}


def _top_stats_for_player(player: dict, n: int = 2) -> list[dict]:
    """Return the top N projected stat columns for a player with z-scores."""
    cats = ["pts", "reb", "ast", "stl", "blk", "fg3m"]
    scored = []
    for cat in cats:
        val = player.get(cat)
        z   = player.get(f"z_{cat}") or 0
        if val is not None:
            scored.append({"label": _CAT_LABELS[cat], "value": f"{val:.1f}", "z": z, "_val": val})
    scored.sort(key=lambda x: x["_val"], reverse=True)
    return [{"label": s["label"], "value": s["value"], "z": s["z"]} for s in scored[:n]]


def _build_player_rows(players: list[dict]) -> list[dict]:
    rows = []
    for p in players:
        opponent = p.get("opponent", "")
        is_home  = p.get("is_home", True)
        opp_abbr = api.abbrev_team(opponent)
        matchup  = f"vs {opp_abbr}" if is_home else f"@ {opp_abbr}"
        rows.append({
            "name":      p["name"],
            "team":      api.abbrev_team(p.get("team", "")),
            "position":  p.get("position", ""),
            "matchup":   matchup if opp_abbr else "",
            "is_b2b":    p.get("is_b2b", False),
            "is_fa":     p.get("ownership_pct", 100) < 50,
            "top_stats": _top_stats_for_player(p, n=2),
        })
    return rows


def run(preview: bool = False) -> dict:
    if not api.data_freshness_ok():
        db.log_run(CONTENT_TYPE, "skipped", "data stale")
        return {"status": "skipped", "reason": "data stale"}

    if not api.is_season_active():
        db.log_run(CONTENT_TYPE, "skipped", "off-season")
        return {"status": "skipped", "reason": "off-season"}

    try:
        tomorrow     = api.tomorrow_date()
        top_5        = api.top_tomorrow_projections(n=10)
        top_5_fa     = api.top_tomorrow_projections(n=10, fa_only=True)
        cat_leaders  = api.top_category_leaders(tomorrow)

        if not top_5:
            db.log_run(CONTENT_TYPE, "skipped", "no tomorrow data")
            return {"status": "skipped", "reason": "no projection data for tomorrow"}

        date_label = date.today().strftime("%a %b %-d").upper()

        # ── Overall graphic ─────────────────────────────────────────────────
        overall_path = renderer.render_and_screenshot(
            "daily_projections.html",
            {
                "date_label":  date_label,
                "players":     _build_player_rows(top_5),
                "waiver_mode": False,
            },
            f"daily_overall_{tomorrow}",
            format="square",
        )

        # ── Waiver wire graphic ─────────────────────────────────────────────
        wire_path = None
        if top_5_fa:
            wire_path = renderer.render_and_screenshot(
                "daily_projections.html",
                {
                    "date_label":  date_label,
                    "players":     _build_player_rows(top_5_fa),
                    "waiver_mode": True,
                },
                f"daily_wire_{tomorrow}",
                format="square",
            )

        # ── Copy ────────────────────────────────────────────────────────────
        overall_tweet = claude.daily_overall_tweet(top_5)
        wire_tweet    = claude.daily_waiver_tweet(top_5_fa) if top_5_fa else None
        cat_tweet     = claude.daily_category_tweet(cat_leaders) if cat_leaders else None
        ig_caption    = claude.instagram_caption("daily projections", top_5)

        lead_hash = hashlib.sha256(overall_tweet.encode()).hexdigest()[:16]

        result = {
            "status":         "preview" if preview else "published",
            "overall_graphic": overall_path,
            "wire_graphic":   wire_path,
            "overall_tweet":  overall_tweet,
            "wire_tweet":     wire_tweet,
            "cat_tweet":      cat_tweet,
            "ig_caption":     ig_caption,
        }

        if preview:
            return result

        if db.is_duplicate(lead_hash):
            renderer.cleanup(overall_path)
            if wire_path:
                renderer.cleanup(wire_path)
            db.log_run(CONTENT_TYPE, "skipped", "duplicate")
            return {"status": "skipped", "reason": "duplicate"}

        # Twitter thread: overall graphic → wire graphic → category text
        thread_texts  = [overall_tweet]
        thread_images = [overall_path]
        if wire_tweet:
            thread_texts.append(wire_tweet)
            thread_images.append(wire_path)
        if cat_tweet:
            thread_texts.append(cat_tweet)
            thread_images.append(None)

        tweet_ids = twitter.post_thread(thread_texts, image_paths=thread_images)

        db.log_post(CONTENT_TYPE, "twitter", lead_hash,
                    copy_preview=overall_tweet[:120], post_id=tweet_ids[0],
                    template="daily_projections.html",
                    graphic_name=overall_path.split("/")[-1])

        # Instagram — overall graphic only (morning slot)
        try:
            ig_id = instagram.upload_local_image(overall_path, ig_caption)
            db.log_post(CONTENT_TYPE, "instagram", lead_hash,
                        copy_preview=ig_caption[:120], post_id=ig_id,
                        template="daily_projections.html",
                        graphic_name=overall_path.split("/")[-1])
        except NotImplementedError:
            log.warning("[%s] Instagram skipped — no CDN uploader", CONTENT_TYPE)
        except Exception as exc:
            log.error("[%s] Instagram failed: %s", CONTENT_TYPE, exc)

        renderer.cleanup(overall_path)
        if wire_path:
            renderer.cleanup(wire_path)

        db.log_run(CONTENT_TYPE, "success")
        result["tweet_ids"] = tweet_ids
        return result

    except Exception as exc:
        log.exception("[%s] Unhandled error", CONTENT_TYPE)
        db.log_run(CONTENT_TYPE, "error", str(exc))
        return {"status": "error", "detail": str(exc)}
