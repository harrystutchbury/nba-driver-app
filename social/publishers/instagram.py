"""Instagram Graph API publisher."""

import os
import time
import logging
import requests

log = logging.getLogger(__name__)

GRAPH_URL = "https://graph.facebook.com/v19.0"


def _account_id() -> str:
    return os.environ["INSTAGRAM_ACCOUNT_ID"]


def _token() -> str:
    return os.environ["INSTAGRAM_ACCESS_TOKEN"]


def _post(path: str, data: dict) -> dict:
    resp = requests.post(f"{GRAPH_URL}{path}", data=data, timeout=30)
    resp.raise_for_status()
    return resp.json()


def upload_image_url(image_url: str, caption: str) -> str:
    """
    Step 1 of Instagram publish flow: create a container from a public image URL.
    Returns container ID.
    """
    result = _post(
        f"/{_account_id()}/media",
        {
            "image_url":   image_url,
            "caption":     caption,
            "access_token": _token(),
        },
    )
    return result["id"]


def publish_container(container_id: str) -> str:
    """Step 2: publish the container. Returns the published media ID."""
    result = _post(
        f"/{_account_id()}/media_publish",
        {
            "creation_id":  container_id,
            "access_token": _token(),
        },
    )
    return result["id"]


def post_image_from_url(image_url: str, caption: str) -> str:
    """
    Full Instagram publish flow using a publicly accessible image URL.
    Returns the published media ID.
    """
    container_id = upload_image_url(image_url, caption)
    time.sleep(5)  # Instagram recommends a brief delay before publishing
    media_id = publish_container(container_id)
    log.info("Instagram post published: %s", media_id)
    return media_id


def upload_local_image(image_path: str, caption: str, cdn_uploader=None) -> str:
    """
    Upload a local image to Instagram. Requires a cdn_uploader callable that
    takes a file path and returns a public URL (implement per your hosting setup).

    If no cdn_uploader is provided, raises NotImplementedError — Instagram
    requires a public URL so the image must first be hosted somewhere.
    """
    if cdn_uploader is None:
        raise NotImplementedError(
            "Instagram requires a public image URL. "
            "Provide a cdn_uploader(path) -> url callable or host images externally."
        )
    public_url = cdn_uploader(image_path)
    return post_image_from_url(public_url, caption)
