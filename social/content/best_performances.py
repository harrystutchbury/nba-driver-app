"""
Weekly best single-game performances — runs Monday 9:30am ET.
Renders a graphic of the top 5 game performances, then posts a Twitter thread.
"""

import hashlib
import logging
from datetime import date, datetime, timedelta

import api_client as api
import claude_gen as claude
import renderer
import db
from publishers import buffer, cdn

log = logging.getLogger(__name__)

CONTENT_TYPE = "best_performances"

_CAT_LABELS = {"pts": "PTS", "reb": "REB", "ast": "AST", "stl": "STL", "blk": "BLK", "fg3m": "3PM"}


def _previous_week_label() -> str:
    today  = date.today()
    monday = today - timedelta(days=today.weekday() + 7)
    sunday = monday + timedelta(days=6)
    if monday.month == sunday.month:
        return f"{monday.strftime('%b %-d').upper()}–{sunday.day}"
    return f"{monday.strftime('%b %-d').upper()}–{sunday.strftime('%b %-d').upper()}"


def _build_game_rows(games: list[dict]) -> list[dict]:
    rows = []
    for g in games:
        opp      = g.get("opponent", "")
        is_home  = g.get("is_home", True)
        opp_abbr = api.abbrev_team(opp)
        matchup  = f"vs {opp_abbr}" if is_home else f"@ {opp_abbr}"
        pts      = g.get("pts")
        game_date = g.get("game_date", "")
        try:
            game_date_fmt = datetime.strptime(game_date, "%Y-%m-%d").strftime("%-b %-d")
        except Exception:
            game_date_fmt = ""

        rows.append({
            "name":          g["name"],
            "team":          api.abbrev_team(g.get("team", "")),
            "position":      g.get("position", ""),
            "matchup":       matchup if opp_abbr else "",
            "game_date_fmt": game_date_fmt,
            "z_total":       g.get("z_total") or 0,
            "pts":      pts,
            "pts_hi":   pts is not None and pts >= 30,
            "reb":      g.get("reb"),
            "ast":      g.get("ast"),
            "stl":      g.get("stl"),
            "blk":      g.get("blk"),
            "fg3m":     g.get("fg3m"),
            "fg_pct":   g.get("fg_pct"),
            "ft_pct":   g.get("ft_pct"),
            "tov":      g.get("tov"),
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
        games = api.best_game_performances(n=10)
        if not games:
            db.log_run(CONTENT_TYPE, "skipped", "no game data")
            return {"status": "skipped", "reason": "no game performance data"}

        date_range  = _previous_week_label()
        game_rows   = _build_game_rows(games)

        graphic_path = renderer.render_and_screenshot(
            "weekly_performances.html",
            {"date_range": date_range, "games": game_rows},
            f"best_performances_{date.today().isoformat()}",
            format="square",
        )

        tweets     = claude.best_performances_thread(games)
        ig_caption = claude.instagram_caption("best game performances", games)

        if not tweets:
            db.log_run(CONTENT_TYPE, "skipped", "no copy generated")
            return {"status": "skipped", "reason": "no copy generated"}

        lead_hash = hashlib.sha256(tweets[0].encode()).hexdigest()[:16]

        result = {
            "status":  "preview" if preview else "published",
            "graphic": graphic_path,
            "tweets":  tweets,
            "games":   game_rows,
        }

        if preview:
            return result

        if db.is_duplicate(lead_hash):
            renderer.cleanup(graphic_path)
            db.log_run(CONTENT_TYPE, "skipped", "duplicate")
            return {"status": "skipped", "reason": "duplicate"}

        graphic_url = cdn.upload(graphic_path, public_id=f"best_performances_{graphic_path.split('/')[-1].replace('.png','')}")
        update_ids  = buffer.post(tweets[0], image_url=graphic_url)
        db.log_post(CONTENT_TYPE, "buffer", lead_hash,
                    copy_preview=tweets[0][:120], post_id=update_ids[0] if update_ids else None,
                    template="weekly_performances.html",
                    graphic_name=graphic_path.split("/")[-1])

        # Follow-up tweets (rankings) — X only, text only
        for tweet_text in tweets[1:]:
            buffer.post(tweet_text, channel_ids=buffer._x_channels())

        renderer.cleanup(graphic_path)
        db.log_run(CONTENT_TYPE, "success")
        result["update_ids"] = update_ids
        return result

    except Exception as exc:
        log.exception("[%s] Unhandled error", CONTENT_TYPE)
        db.log_run(CONTENT_TYPE, "error", str(exc))
        return {"status": "error", "detail": str(exc)}
