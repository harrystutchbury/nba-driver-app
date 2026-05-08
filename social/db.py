"""SQLite post history and deduplication for the social pipeline."""

import sqlite3
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "social.db")


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS posts (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at      TEXT    NOT NULL,
            content_type    TEXT    NOT NULL,
            platform        TEXT    NOT NULL,
            post_id         TEXT,
            copy_hash       TEXT    NOT NULL,
            copy_preview    TEXT,
            template        TEXT,
            graphic_name    TEXT,
            status          TEXT    NOT NULL DEFAULT 'published',
            error_msg       TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_posts_hash ON posts(copy_hash);
        CREATE INDEX IF NOT EXISTS idx_posts_type ON posts(content_type, created_at);

        CREATE TABLE IF NOT EXISTS run_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            run_at          TEXT    NOT NULL,
            content_type    TEXT    NOT NULL,
            status          TEXT    NOT NULL,
            detail          TEXT
        );
    """)
    conn.commit()
    conn.close()


def is_duplicate(copy_hash: str) -> bool:
    conn = get_conn()
    row = conn.execute(
        "SELECT 1 FROM posts WHERE copy_hash = ? AND status = 'published'",
        (copy_hash,)
    ).fetchone()
    conn.close()
    return row is not None


def log_post(
    content_type: str,
    platform: str,
    copy_hash: str,
    copy_preview: str = None,
    post_id: str = None,
    template: str = None,
    graphic_name: str = None,
    status: str = "published",
    error_msg: str = None,
):
    conn = get_conn()
    conn.execute(
        """INSERT INTO posts
           (created_at, content_type, platform, post_id, copy_hash, copy_preview,
            template, graphic_name, status, error_msg)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            datetime.utcnow().isoformat(),
            content_type, platform, post_id, copy_hash,
            copy_preview, template, graphic_name, status, error_msg,
        ),
    )
    conn.commit()
    conn.close()


def log_run(content_type: str, status: str, detail: str = None):
    conn = get_conn()
    conn.execute(
        "INSERT INTO run_log (run_at, content_type, status, detail) VALUES (?, ?, ?, ?)",
        (datetime.utcnow().isoformat(), content_type, status, detail),
    )
    conn.commit()
    conn.close()


def last_runs(limit: int = 20) -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM run_log ORDER BY run_at DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def recent_posts(limit: int = 50) -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM posts ORDER BY created_at DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
