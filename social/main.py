"""
Roto Intel social media content pipeline.

Scheduler + FastAPI admin endpoints.
Run with: uvicorn main:app --host 0.0.0.0 --port 8001
"""

import sys
import os
import logging
from datetime import datetime
from pathlib import Path

# Load .env from the social/ directory if present
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

# Ensure local imports work regardless of cwd
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

import db
from content import (
    weekly_performers,
    risers_fallers,
    best_performances,
    daily_projections,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("social")

# ── DB init ────────────────────────────────────────────────────────────────
db.init_db()

# ── FastAPI app ────────────────────────────────────────────────────────────
app = FastAPI(title="Roto Intel Social Pipeline", version="1.0")

_TEMP_DIR = os.path.join(os.path.dirname(__file__), "temp")
os.makedirs(_TEMP_DIR, exist_ok=True)
app.mount("/temp", StaticFiles(directory=_TEMP_DIR), name="temp")

# ── Scheduler ─────────────────────────────────────────────────────────────
_scheduler = BackgroundScheduler(timezone="America/New_York")

# 1. Weekly best performers — Monday 8am ET
_scheduler.add_job(
    weekly_performers.run,
    CronTrigger(day_of_week="mon", hour=8, minute=0),
    id="weekly_performers",
    replace_existing=True,
)

# 2. Risers and fallers — Monday 9am ET
_scheduler.add_job(
    risers_fallers.run,
    CronTrigger(day_of_week="mon", hour=9, minute=0),
    id="risers_fallers",
    replace_existing=True,
)

# 3. Best performances — Monday 9:30am ET
_scheduler.add_job(
    best_performances.run,
    CronTrigger(day_of_week="mon", hour=9, minute=30),
    id="best_performances",
    replace_existing=True,
)

# 4. Daily projections — every day 7pm ET
_scheduler.add_job(
    daily_projections.run,
    CronTrigger(hour=19, minute=0),
    id="daily_projections",
    replace_existing=True,
)

_scheduler.start()
log.info("Scheduler started — jobs: %s", [j.id for j in _scheduler.get_jobs()])


# ── Admin endpoints ────────────────────────────────────────────────────────

_CONTENT_HANDLERS = {
    "weekly_performers": weekly_performers,
    "risers_fallers":    risers_fallers,
    "best_performances": best_performances,
    "daily_projections": daily_projections,
}


@app.get("/status")
def status():
    """Last run time and success/failure for each content type."""
    runs = db.last_runs(limit=100)
    by_type: dict = {}
    for r in runs:
        ct = r["content_type"]
        if ct not in by_type:
            by_type[ct] = r
    return {
        "now":         datetime.utcnow().isoformat() + "Z",
        "last_runs":   by_type,
        "jobs": [
            {
                "id":       j.id,
                "next_run": j.next_run_time.isoformat() if j.next_run_time else None,
            }
            for j in _scheduler.get_jobs()
        ],
    }


@app.post("/trigger/{content_type}")
def trigger(content_type: str):
    """Manually fire a content type immediately (does publish)."""
    handler = _CONTENT_HANDLERS.get(content_type)
    if not handler:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown content type '{content_type}'. "
                   f"Valid: {list(_CONTENT_HANDLERS)}",
        )
    log.info("Manual trigger: %s", content_type)
    result = handler.run(preview=False)
    return result


@app.get("/preview/{content_type}")
def preview(content_type: str):
    """Generate graphics and copy for a content type but do NOT publish."""
    handler = _CONTENT_HANDLERS.get(content_type)
    if not handler:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown content type '{content_type}'. "
                   f"Valid: {list(_CONTENT_HANDLERS)}",
        )
    log.info("Preview: %s", content_type)
    result = handler.run(preview=True)
    # Strip local file paths from response — return just names
    for key in list(result.keys()):
        if key.endswith("_graphic") or key.endswith("_path"):
            val = result[key]
            if val:
                result[key] = os.path.basename(val)
    return result


@app.get("/posts")
def posts(limit: int = 50):
    """Recent post history."""
    return db.recent_posts(limit=limit)


@app.get("/images")
def list_images():
    """List all PNG previews currently in the temp directory."""
    files = sorted(
        f for f in os.listdir(_TEMP_DIR) if f.endswith(".png")
    )
    return [
        {"filename": f, "url": f"/temp/{f}"}
        for f in files
    ]


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.post("/test-post")
def test_post():
    """
    End-to-end pipeline test: renders a daily projections graphic (bypassing
    off-season check), uploads to Cloudinary, and posts to X only via Buffer.
    """
    import renderer
    from publishers import cdn, buffer
    from datetime import date

    # Render a minimal test graphic using the daily projections template
    graphic_path = renderer.render_and_screenshot(
        "daily_projections.html",
        {
            "date_label": "PIPELINE TEST",
            "players": [
                {
                    "name": "Pipeline Test",
                    "team": "RIT",
                    "position": "G",
                    "matchup": "vs TEST",
                    "is_b2b": False,
                    "ease": "112.0",
                    "ease_val": 112.0,
                    "top_stats": [
                        {"label": "PTS", "value": "28.0", "z": 2.1},
                        {"label": "AST", "value": "8.5", "z": 1.8},
                        {"label": "REB", "value": "6.0", "z": 1.2},
                    ],
                }
            ],
            "waiver_mode": False,
        },
        f"test_post_{date.today().isoformat()}",
        format="square",
    )

    image_url = cdn.upload(graphic_path, public_id="pipeline_test")
    update_ids = buffer.post(
        "🏀 Roto Intel pipeline test — ignore this post",
        image_url=image_url,
        channel_ids=buffer._x_channels(),
    )

    return {
        "status": "ok",
        "image_url": image_url,
        "buffer_update_ids": update_ids,
    }
