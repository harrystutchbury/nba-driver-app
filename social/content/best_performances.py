"""
Weekly best single-game performances — runs Monday 9:30am ET.
Text-only Twitter thread, no graphic.
"""

import hashlib
import logging

import api_client as api
import claude_gen as claude
import db
from publishers import twitter

log = logging.getLogger(__name__)

CONTENT_TYPE = "best_performances"


def run(preview: bool = False) -> dict:
    if not api.data_freshness_ok():
        db.log_run(CONTENT_TYPE, "skipped", "data stale")
        return {"status": "skipped", "reason": "data stale"}

    if not api.is_season_active():
        db.log_run(CONTENT_TYPE, "skipped", "off-season")
        return {"status": "skipped", "reason": "off-season"}

    try:
        games = api.best_game_performances(n=3)
        if not games:
            db.log_run(CONTENT_TYPE, "skipped", "no game data")
            return {"status": "skipped", "reason": "no game performance data"}

        tweets = claude.best_performances_thread(games)
        if not tweets:
            db.log_run(CONTENT_TYPE, "skipped", "no copy generated")
            return {"status": "skipped", "reason": "no copy generated"}

        lead_hash = hashlib.sha256(tweets[0].encode()).hexdigest()[:16]

        result = {
            "status":  "preview" if preview else "published",
            "tweets":  tweets,
            "games":   games,
        }

        if preview:
            return result

        if db.is_duplicate(lead_hash):
            db.log_run(CONTENT_TYPE, "skipped", "duplicate")
            return {"status": "skipped", "reason": "duplicate"}

        tweet_ids = twitter.post_thread(tweets)

        for i, (t, tid) in enumerate(zip(tweets, tweet_ids)):
            h = hashlib.sha256(t.encode()).hexdigest()[:16]
            db.log_post(CONTENT_TYPE, "twitter", h,
                        copy_preview=t[:120], post_id=tid)

        db.log_run(CONTENT_TYPE, "success")
        result["tweet_ids"] = tweet_ids
        return result

    except Exception as exc:
        log.exception("[%s] Unhandled error", CONTENT_TYPE)
        db.log_run(CONTENT_TYPE, "error", str(exc))
        return {"status": "error", "detail": str(exc)}
