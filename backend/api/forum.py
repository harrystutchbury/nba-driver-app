"""
api/forum.py — Forum endpoints: posts, threaded comments, up/downvotes.
All routes require a valid JWT (auth-gated).
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel

from schema import get_conn

JWT_SECRET    = os.environ.get("JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
_security     = HTTPBearer(auto_error=False)


def _current_user(creds: HTTPAuthorizationCredentials = Depends(_security)) -> str:
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        sub = payload.get("sub")
        if not sub:
            raise HTTPException(status_code=401, detail="Invalid token")
        return sub
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


forum_router = APIRouter(prefix="/api/forum")


# ── Models ─────────────────────────────────────────────────────────────────────

class PostBody(BaseModel):
    title: str
    body:  str

class CommentBody(BaseModel):
    body:      str
    parent_id: Optional[int] = None

class VoteBody(BaseModel):
    vote: int  # 1, -1, or 0 (remove vote)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_display_name(conn, username: str) -> str:
    row = conn.execute("SELECT display_name FROM users WHERE username = ?", (username,)).fetchone()
    if row and row["display_name"]:
        return row["display_name"]
    return username.split("@")[0]


def _build_tree(flat: list) -> list:
    """Convert flat comment list into nested tree sorted by score desc within each level."""
    by_id = {c["id"]: {**c, "replies": []} for c in flat}
    roots = []
    for node in by_id.values():
        pid = node["parent_id"]
        if pid and pid in by_id:
            by_id[pid]["replies"].append(node)
        else:
            roots.append(node)
    return roots


# ── List posts ─────────────────────────────────────────────────────────────────

@forum_router.get("/posts")
def list_posts(user: str = Depends(_current_user)):
    conn = get_conn()
    rows = conn.execute("""
        SELECT
            p.id, p.title, p.body, p.display_name AS author, p.username, p.created_at,
            COALESCE(SUM(v.vote), 0) AS score,
            COUNT(DISTINCT c.id)     AS comment_count
        FROM forum_posts p
        LEFT JOIN forum_post_votes v ON v.post_id = p.id
        LEFT JOIN forum_comments   c ON c.post_id = p.id AND c.is_hidden = 0
        WHERE p.is_hidden = 0
        GROUP BY p.id
        ORDER BY p.created_at DESC
    """).fetchall()

    my_votes = {
        r["post_id"]: r["vote"]
        for r in conn.execute(
            "SELECT post_id, vote FROM forum_post_votes WHERE username = ?", (user,)
        ).fetchall()
    }
    conn.close()

    return [
        {
            "id":            r["id"],
            "title":         r["title"],
            "body":          r["body"],
            "author":        r["author"],
            "is_mine":       r["username"] == user,
            "created_at":    r["created_at"],
            "score":         r["score"],
            "comment_count": r["comment_count"],
            "my_vote":       my_votes.get(r["id"], 0),
        }
        for r in rows
    ]


# ── Create post ────────────────────────────────────────────────────────────────

@forum_router.post("/posts")
def create_post(body: PostBody, user: str = Depends(_current_user)):
    title = body.title.strip()
    text  = body.body.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title required")
    if not text:
        raise HTTPException(status_code=400, detail="Body required")
    if len(title) > 200:
        raise HTTPException(status_code=400, detail="Title too long (max 200 chars)")

    conn = get_conn()
    display = _get_display_name(conn, user)
    cur = conn.execute(
        "INSERT INTO forum_posts (title, body, username, display_name) VALUES (?, ?, ?, ?)",
        (title, text, user, display),
    )
    conn.commit()
    post_id = cur.lastrowid
    conn.close()
    return {"id": post_id}


# ── Get post + nested comments ─────────────────────────────────────────────────

@forum_router.get("/posts/{post_id}")
def get_post(post_id: int, user: str = Depends(_current_user)):
    conn = get_conn()
    post = conn.execute(
        """SELECT id, title, body, display_name AS author, username, created_at
           FROM forum_posts WHERE id = ? AND is_hidden = 0""",
        (post_id,),
    ).fetchone()
    if not post:
        conn.close()
        raise HTTPException(status_code=404, detail="Post not found")

    score = conn.execute(
        "SELECT COALESCE(SUM(vote), 0) AS s FROM forum_post_votes WHERE post_id = ?",
        (post_id,),
    ).fetchone()["s"]

    my_post_vote = (conn.execute(
        "SELECT vote FROM forum_post_votes WHERE post_id = ? AND username = ?",
        (post_id, user),
    ).fetchone() or {"vote": 0})["vote"]

    comments_raw = conn.execute("""
        SELECT c.id, c.parent_id, c.display_name AS author, c.username, c.body, c.created_at,
               COALESCE(SUM(v.vote), 0) AS score
        FROM forum_comments c
        LEFT JOIN forum_comment_votes v ON v.comment_id = c.id
        WHERE c.post_id = ? AND c.is_hidden = 0
        GROUP BY c.id
        ORDER BY c.created_at ASC
    """, (post_id,)).fetchall()

    my_comment_votes = {
        r["comment_id"]: r["vote"]
        for r in conn.execute(
            "SELECT comment_id, vote FROM forum_comment_votes WHERE username = ?", (user,)
        ).fetchall()
    }
    conn.close()

    flat = [
        {
            "id":         c["id"],
            "parent_id":  c["parent_id"],
            "author":     c["author"],
            "is_mine":    c["username"] == user,
            "body":       c["body"],
            "created_at": c["created_at"],
            "score":      c["score"],
            "my_vote":    my_comment_votes.get(c["id"], 0),
        }
        for c in comments_raw
    ]

    return {
        "id":         post["id"],
        "title":      post["title"],
        "body":       post["body"],
        "author":     post["author"],
        "is_mine":    post["username"] == user,
        "created_at": post["created_at"],
        "score":      score,
        "my_vote":    my_post_vote,
        "comments":   _build_tree(flat),
    }


# ── Vote on post ───────────────────────────────────────────────────────────────

@forum_router.post("/posts/{post_id}/vote")
def vote_post(post_id: int, body: VoteBody, user: str = Depends(_current_user)):
    if body.vote not in (-1, 0, 1):
        raise HTTPException(status_code=400, detail="vote must be -1, 0, or 1")
    conn = get_conn()
    if not conn.execute("SELECT 1 FROM forum_posts WHERE id = ?", (post_id,)).fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Post not found")
    if body.vote == 0:
        conn.execute(
            "DELETE FROM forum_post_votes WHERE post_id = ? AND username = ?", (post_id, user)
        )
    else:
        conn.execute("""
            INSERT INTO forum_post_votes (post_id, username, vote) VALUES (?, ?, ?)
            ON CONFLICT(post_id, username) DO UPDATE SET vote = excluded.vote
        """, (post_id, user, body.vote))
    conn.commit()
    score = conn.execute(
        "SELECT COALESCE(SUM(vote), 0) AS s FROM forum_post_votes WHERE post_id = ?", (post_id,)
    ).fetchone()["s"]
    conn.close()
    return {"score": score}


# ── Add comment / reply ────────────────────────────────────────────────────────

@forum_router.post("/posts/{post_id}/comments")
def add_comment(post_id: int, body: CommentBody, user: str = Depends(_current_user)):
    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Body required")
    conn = get_conn()
    if not conn.execute("SELECT 1 FROM forum_posts WHERE id = ?", (post_id,)).fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Post not found")
    if body.parent_id:
        if not conn.execute(
            "SELECT 1 FROM forum_comments WHERE id = ?", (body.parent_id,)
        ).fetchone():
            conn.close()
            raise HTTPException(status_code=404, detail="Parent comment not found")
    display = _get_display_name(conn, user)
    cur = conn.execute(
        "INSERT INTO forum_comments (post_id, parent_id, username, display_name, body) VALUES (?, ?, ?, ?, ?)",
        (post_id, body.parent_id, user, display, text),
    )
    conn.commit()
    cid = cur.lastrowid
    row = conn.execute(
        "SELECT id, parent_id, display_name AS author, body, created_at FROM forum_comments WHERE id = ?",
        (cid,),
    ).fetchone()
    conn.close()
    return {
        "id":         row["id"],
        "parent_id":  row["parent_id"],
        "author":     row["author"],
        "is_mine":    True,
        "body":       row["body"],
        "created_at": row["created_at"],
        "score":      0,
        "my_vote":    0,
        "replies":    [],
    }


# ── Vote on comment ────────────────────────────────────────────────────────────

@forum_router.post("/comments/{comment_id}/vote")
def vote_comment(comment_id: int, body: VoteBody, user: str = Depends(_current_user)):
    if body.vote not in (-1, 0, 1):
        raise HTTPException(status_code=400, detail="vote must be -1, 0, or 1")
    conn = get_conn()
    if not conn.execute("SELECT 1 FROM forum_comments WHERE id = ?", (comment_id,)).fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Comment not found")
    if body.vote == 0:
        conn.execute(
            "DELETE FROM forum_comment_votes WHERE comment_id = ? AND username = ?",
            (comment_id, user),
        )
    else:
        conn.execute("""
            INSERT INTO forum_comment_votes (comment_id, username, vote) VALUES (?, ?, ?)
            ON CONFLICT(comment_id, username) DO UPDATE SET vote = excluded.vote
        """, (comment_id, user, body.vote))
    conn.commit()
    score = conn.execute(
        "SELECT COALESCE(SUM(vote), 0) AS s FROM forum_comment_votes WHERE comment_id = ?",
        (comment_id,),
    ).fetchone()["s"]
    conn.close()
    return {"score": score}


# ── Delete post ────────────────────────────────────────────────────────────────

@forum_router.delete("/posts/{post_id}")
def delete_post(post_id: int, user: str = Depends(_current_user)):
    conn = get_conn()
    post = conn.execute(
        "SELECT username FROM forum_posts WHERE id = ?", (post_id,)
    ).fetchone()
    if not post:
        conn.close()
        raise HTTPException(status_code=404, detail="Post not found")
    is_admin = bool((conn.execute(
        "SELECT is_admin FROM users WHERE username = ?", (user,)
    ).fetchone() or {}).get("is_admin", 0))
    if post["username"] != user and not is_admin:
        conn.close()
        raise HTTPException(status_code=403, detail="Not your post")
    conn.execute("UPDATE forum_posts SET is_hidden = 1 WHERE id = ?", (post_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Delete comment ─────────────────────────────────────────────────────────────

@forum_router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, user: str = Depends(_current_user)):
    conn = get_conn()
    comment = conn.execute(
        "SELECT username FROM forum_comments WHERE id = ?", (comment_id,)
    ).fetchone()
    if not comment:
        conn.close()
        raise HTTPException(status_code=404, detail="Comment not found")
    is_admin = bool((conn.execute(
        "SELECT is_admin FROM users WHERE username = ?", (user,)
    ).fetchone() or {}).get("is_admin", 0))
    if comment["username"] != user and not is_admin:
        conn.close()
        raise HTTPException(status_code=403, detail="Not your comment")
    conn.execute("UPDATE forum_comments SET is_hidden = 1 WHERE id = ?", (comment_id,))
    conn.commit()
    conn.close()
    return {"ok": True}
