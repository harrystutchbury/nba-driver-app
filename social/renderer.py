"""Playwright HTML-to-PNG renderer for social graphics."""

import os
import logging
import tempfile
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

log = logging.getLogger(__name__)

TEMPLATES_DIR = Path(__file__).parent / "templates"
TEMP_DIR      = Path(__file__).parent / "temp"

TEMP_DIR.mkdir(exist_ok=True)

_jinja_env = Environment(
    loader=FileSystemLoader(str(TEMPLATES_DIR)),
    autoescape=select_autoescape(["html"]),
)

# Viewport sizes per format
VIEWPORTS = {
    "square":    {"width": 1080, "height": 1080},  # Instagram
    "landscape": {"width": 1200, "height": 675},   # Twitter
}


def render_template(template_name: str, data: dict) -> str:
    """Render a Jinja2 HTML template with data and return the HTML string."""
    tmpl = _jinja_env.get_template(template_name)
    return tmpl.render(**data)


def html_to_image(
    html: str,
    output_name: str,
    format: str = "square",
) -> str:
    """
    Render HTML to a PNG file via Playwright.
    Returns the absolute path to the saved PNG.
    """
    from playwright.sync_api import sync_playwright

    viewport = VIEWPORTS.get(format, VIEWPORTS["square"])
    out_path  = str(TEMP_DIR / f"{output_name}.png")

    # Write HTML to a temp file so Playwright can load it via file:// URL
    with tempfile.NamedTemporaryFile(
        suffix=".html", delete=False, mode="w", encoding="utf-8"
    ) as f:
        f.write(html)
        tmp_html_path = f.name

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page    = browser.new_page(viewport=viewport)
            page.goto(f"file://{tmp_html_path}")
            page.wait_for_load_state("networkidle")
            page.screenshot(path=out_path, full_page=False)
            browser.close()
    finally:
        os.unlink(tmp_html_path)

    log.info("Rendered graphic: %s", out_path)
    return out_path


def render_and_screenshot(
    template_name: str,
    data: dict,
    output_name: str,
    format: str = "square",
) -> str:
    """Convenience wrapper: render template then screenshot to PNG. Returns PNG path."""
    html = render_template(template_name, data)
    return html_to_image(html, output_name, format)


def cleanup(path: str):
    """Delete a temporary graphic file after publishing."""
    try:
        os.unlink(path)
        log.debug("Deleted temp graphic: %s", path)
    except FileNotFoundError:
        pass
