"""Buffer Publishing API client (GraphQL)."""

import os
import logging
import requests

log = logging.getLogger(__name__)

_GQL_URL = "https://api.buffer.com"

_CREATE_POST = """
mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess {
      post { id status }
    }
    ... on MutationError {
      message
    }
  }
}
"""


def _token() -> str:
    return os.environ["BUFFER_ACCESS_TOKEN"]


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {_token()}",
        "Content-Type": "application/json",
    }


def _x_channels() -> list[str]:
    c = os.environ.get("BUFFER_CHANNEL_X", "")
    return [c] if c else []


def _ig_channels() -> list[str]:
    c = os.environ.get("BUFFER_CHANNEL_IG", "")
    return [c] if c else []


def _bsky_channels() -> list[str]:
    c = os.environ.get("BUFFER_CHANNEL_BSKY", "")
    return [c] if c else []


def all_channels() -> list[str]:
    return _x_channels() + _ig_channels() + _bsky_channels()


def _gql(query: str, variables: dict = None) -> dict:
    resp = requests.post(
        _GQL_URL,
        headers=_headers(),
        json={"query": query, "variables": variables or {}},
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    if "errors" in data:
        raise RuntimeError(f"Buffer GraphQL error: {data['errors']}")
    return data["data"]


def get_channels() -> list[dict]:
    """List all connected Buffer channels (useful for finding IDs)."""
    org_id = os.environ["BUFFER_ORG_ID"]
    data = _gql(
        '{ channels(input: { organizationId: "%s" }) { id name service displayName } }' % org_id
    )
    return data["channels"]


def post(
    text: str,
    image_url: str = None,
    channel_ids: list[str] = None,
    now: bool = True,
) -> list[str]:
    """
    Create a Buffer post across the given channels.
    Returns list of Buffer post IDs.
    """
    if channel_ids is None:
        channel_ids = all_channels()

    if not channel_ids:
        raise ValueError("No Buffer channel IDs configured.")

    mode = "shareNow" if now else "addToQueue"
    update_ids = []

    for channel_id in channel_ids:
        variables = {
            "input": {
                "channelId": channel_id,
                "text": text,
                "schedulingType": "automatic",
                "mode": mode,
            }
        }
        if image_url:
            variables["input"]["assets"] = [{"image": {"url": image_url}}]

        try:
            data = _gql(_CREATE_POST, variables)
            result = data.get("createPost", {})
            if "message" in result:
                raise RuntimeError(result["message"])
            post_id = result.get("post", {}).get("id")
            if post_id:
                update_ids.append(post_id)
                log.info("Buffer post created on %s: %s", channel_id, post_id)
        except Exception as exc:
            log.error("Buffer post failed for channel %s: %s", channel_id, exc)
            raise

    return update_ids
