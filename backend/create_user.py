"""
create_user.py — add or update a user in the NBA driver app database.

Usage:
    python create_user.py <username> <password>

Examples:
    python create_user.py harry mysecretpassword
    python create_user.py alice anotherpassword
"""

import sys
import os
import hashlib
import secrets

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from schema import get_conn, init_db


def _hash_password(password: str, salt: str) -> str:
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return dk.hex()


def _make_password_hash(password: str) -> str:
    salt = secrets.token_hex(16)
    return f"{salt}${_hash_password(password, salt)}"


def create_user(username: str, password: str):
    init_db()
    conn = get_conn()
    hashed = _make_password_hash(password)
    existing = conn.execute(
        "SELECT id FROM users WHERE username = ?", [username]
    ).fetchone()
    if existing:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE username = ?",
            [hashed, username],
        )
        print(f"Updated password for user '{username}'")
    else:
        conn.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            [username, hashed],
        )
        print(f"Created user '{username}'")
    conn.commit()
    conn.close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    create_user(sys.argv[1], sys.argv[2])
