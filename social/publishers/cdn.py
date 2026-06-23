"""Cloudinary CDN uploader — hosts local PNGs as public URLs for Buffer."""

import os
import logging
import cloudinary
import cloudinary.uploader

log = logging.getLogger(__name__)

_configured = False


def _configure():
    global _configured
    if not _configured:
        cloudinary.config(
            cloud_name=os.environ["CLOUDINARY_CLOUD_NAME"],
            api_key=os.environ["CLOUDINARY_API_KEY"],
            api_secret=os.environ["CLOUDINARY_API_SECRET"],
        )
        _configured = True


def upload(image_path: str, public_id: str = None) -> str:
    """Upload a local image to Cloudinary and return the secure public URL."""
    _configure()
    result = cloudinary.uploader.upload(
        image_path,
        folder="roto-intel/social",
        public_id=public_id,
        overwrite=True,
        resource_type="image",
    )
    url = result["secure_url"]
    log.info("Uploaded to Cloudinary: %s", url)
    return url
