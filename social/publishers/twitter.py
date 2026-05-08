"""Twitter/X API v2 publisher via Tweepy."""

import os
import time
import logging
import tweepy

log = logging.getLogger(__name__)

_CLIENT: tweepy.Client | None = None
_API_V1: tweepy.API | None = None  # v1.1 needed for media upload


def _client() -> tweepy.Client:
    global _CLIENT
    if _CLIENT is None:
        _CLIENT = tweepy.Client(
            consumer_key=os.environ["TWITTER_API_KEY"],
            consumer_secret=os.environ["TWITTER_API_SECRET"],
            access_token=os.environ["TWITTER_ACCESS_TOKEN"],
            access_token_secret=os.environ["TWITTER_ACCESS_SECRET"],
            wait_on_rate_limit=True,
        )
    return _CLIENT


def _api_v1() -> tweepy.API:
    global _API_V1
    if _API_V1 is None:
        auth = tweepy.OAuth1UserHandler(
            consumer_key=os.environ["TWITTER_API_KEY"],
            consumer_secret=os.environ["TWITTER_API_SECRET"],
            access_token=os.environ["TWITTER_ACCESS_TOKEN"],
            access_token_secret=os.environ["TWITTER_ACCESS_SECRET"],
        )
        _API_V1 = tweepy.API(auth)
    return _API_V1


def upload_media(image_path: str) -> str:
    """Upload an image via v1.1 media endpoint, return media_id string."""
    media = _api_v1().media_upload(image_path)
    return str(media.media_id)


def tweet(
    text: str,
    image_path: str = None,
    reply_to_id: str = None,
) -> str:
    """
    Post a tweet. Returns the tweet ID string.
    Retries once after 15 minutes on rate limit (429).
    """
    media_ids = None
    if image_path:
        media_ids = [upload_media(image_path)]

    kwargs: dict = {"text": text[:240]}
    if media_ids:
        kwargs["media_ids"] = media_ids
    if reply_to_id:
        kwargs["in_reply_to_tweet_id"] = reply_to_id

    for attempt in range(2):
        try:
            resp = _client().create_tweet(**kwargs)
            tweet_id = str(resp.data["id"])
            log.info("Tweet posted: %s", tweet_id)
            return tweet_id
        except tweepy.errors.TooManyRequests:
            if attempt == 0:
                log.warning("Twitter rate limited — waiting 15 min and retrying")
                time.sleep(900)
            else:
                raise


def post_thread(
    tweets: list[str],
    image_paths: list[str] = None,
) -> list[str]:
    """
    Post a thread of tweets. First tweet may have an image; rest are replies.
    Returns list of tweet IDs.
    """
    ids = []
    reply_to = None

    for i, text in enumerate(tweets):
        img = None
        if image_paths and i < len(image_paths):
            img = image_paths[i]

        tweet_id = tweet(text, image_path=img, reply_to_id=reply_to)
        ids.append(tweet_id)
        reply_to = tweet_id
        if i < len(tweets) - 1:
            time.sleep(2)  # small pause between thread tweets

    return ids
