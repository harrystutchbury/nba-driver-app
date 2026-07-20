"""
Upload nbacom_dump.sql.gz to the Render backend.
Usage:
    ADMIN_TOKEN=your_secret python upload_nbacom.py
"""
import os, sys
import requests

TOKEN   = os.environ.get("ADMIN_TOKEN", "")
BASE    = os.environ.get("API_BASE", "https://app.rotointel.com")
DUMP    = os.path.join(os.path.dirname(__file__), "nbacom_dump.sql.gz")

if not TOKEN:
    sys.exit("Set ADMIN_TOKEN env var")

with open(DUMP, "rb") as f:
    data = f.read()

print(f"Uploading {len(data)/1024/1024:.1f} MB to {BASE} ...")
r = requests.post(
    f"{BASE}/api/admin/import-nbacom",
    data=data,
    headers={
        "Content-Type": "application/octet-stream",
        "X-Admin-Token": TOKEN,
    },
    timeout=300,
)
print(r.status_code, r.json())
