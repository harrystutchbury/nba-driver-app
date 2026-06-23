"""Buffer Publishing API client."""

import os
import logging
import requests

log = logging.getLogger(__name__)

_BASE = "https://api.bufferapp.com/1"


def _token() -> str:
    return os.environ["BUFFER_ACCESS_TOKEN"]


def _x_profiles() -> list[str]:
    pid = os.environ.get("BUFFER_PROFILE_X", "")
    return [pid] if pid else []


def _ig_profiles() -> list[str]:
    pid = os.environ.get("BUFFER_PROFILE_IG", "")
    return [pid] if pid else []


def all_profiles() -> list[str]:
    return _x_profiles() + _ig_profiles()


def get_profiles() -> list[dict]:
    """Return connected Buffer profiles (useful for finding profile IDs)."""
    resp = requests.get(
        f"{_BASE}/profiles.json",
        params={"access_token": _token()},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def post(
    text: str,
    image_url: str = None,
    profile_ids: list[str] = None,
    now: bool = True,
) -> list[str]:
    """
    Create a Buffer update across the given profiles.
    Returns list of Buffer update IDs.
    """
    if profile_ids is None:
        profile_ids = all_profiles()

    if not profile_ids:
        raise ValueError("No Buffer profile IDs configured.")

    data: dict = {
        "access_token": _token(),
        "text": text,
        "now": "true" if now else "false",
    }
    for i, pid in enumerate(profile_ids):
        data[f"profile_ids[{i}]"] = pid

    if image_url:
        data["media[picture]"] = image_url
        data["media[thumbnail]"] = image_url

    resp = requests.post(
        f"{_BASE}/updates/create.json",
        data=data,
        timeout=20,
    )
    resp.raise_for_status()
    result = resp.json()

    if not result.get("success"):
        raise RuntimeError(f"Buffer rejected the update: {result}")

    update_ids = [u["id"] for u in result.get("updates", [])]
    log.info("Buffer updates created: %s", update_ids)
    return update_ids
