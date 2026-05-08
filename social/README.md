# Roto Intel Social Pipeline

Automated social media content for [@RotoIntel](https://twitter.com/rotointel) — scheduled posts to Twitter/X and Instagram using real-time fantasy basketball data, Claude-generated copy, and Playwright-rendered branded graphics.

---

## Architecture

```
social/
├── main.py                  # APScheduler + FastAPI admin endpoints
├── api_client.py            # Roto Intel API wrapper
├── claude_gen.py            # Claude Sonnet copy generation
├── renderer.py              # Playwright HTML→PNG pipeline
├── db.py                    # SQLite post history + deduplication
├── publishers/
│   ├── twitter.py           # Tweepy v2 publisher
│   └── instagram.py        # Instagram Graph API publisher
├── content/
│   ├── weekly_performers.py # Monday 8am — top projected week
│   ├── risers_fallers.py    # Monday 9am — movers + deep dive
│   ├── best_performances.py # Monday 9:30am — standout games
│   └── daily_projections.py # Daily 7pm — tomorrow's slate
└── templates/               # Jinja2 HTML templates (1080×1080)
    ├── weekly_performers.html
    ├── daily_projections.html
    ├── risers_fallers.html
    └── player_deepdive.html
```

---

## Setup

### 1. Install dependencies

```bash
cd social
pip install -r requirements.txt
playwright install chromium
```

> **Note:** `playwright install chromium` must be run after `pip install` — it downloads the browser binary that Playwright uses for rendering.

### 2. Environment variables

Set these before running. Never hardcode them.

| Variable | Description |
|---|---|
| `TWITTER_API_KEY` | From Twitter Developer Portal — App → Keys and tokens |
| `TWITTER_API_SECRET` | Same location |
| `TWITTER_ACCESS_TOKEN` | OAuth 1.0a user token (Read + Write permission) |
| `TWITTER_ACCESS_SECRET` | Same location |
| `ANTHROPIC_API_KEY` | From console.anthropic.com |
| `INSTAGRAM_ACCESS_TOKEN` | Long-lived Instagram Graph API token |
| `INSTAGRAM_ACCOUNT_ID` | Your Instagram Business account ID |
| `ROTO_INTEL_API_BASE_URL` | e.g. `https://your-backend.onrender.com` |
| `ROTO_INTEL_API_KEY` | JWT or bearer token accepted by the Roto Intel backend |

### 3. Getting API keys

**Twitter/X:**
1. Apply for a developer account at developer.twitter.com
2. Create a project + app
3. Set app permissions to **Read and Write**
4. Generate OAuth 1.0a access tokens — these are the four `TWITTER_*` vars
5. The app needs **Elevated access** or **Basic** tier to post tweets with media

**Anthropic:**
1. Sign in at console.anthropic.com
2. Create an API key under API Keys
3. The pipeline uses `claude-sonnet-4-20250514`

**Instagram Graph API:**
1. Create a Meta Developer account at developers.facebook.com
2. Create an app → Add Instagram Graph API product
3. Connect an Instagram Business or Creator account
4. Generate a long-lived access token (valid ~60 days — you'll need to refresh it)
5. Get your Instagram account ID via: `GET https://graph.facebook.com/v19.0/me/accounts`

**Note on Instagram image hosting:** Instagram's Graph API requires a *publicly accessible* image URL — it cannot accept a local file path. You need to host the generated PNG somewhere accessible (e.g. an S3 bucket, Cloudflare R2, or any CDN) and pass a `cdn_uploader` function to `instagram.upload_local_image()`. See `publishers/instagram.py` for the interface.

### 4. Start the service

```bash
uvicorn main:app --host 0.0.0.0 --port 8001
```

On Render, set the start command to the above and point environment variables in the dashboard.

---

## Schedule

| Job | Schedule (ET) | Posts |
|---|---|---|
| Weekly best performers | Monday 8:00am | Twitter thread + Instagram |
| Risers & fallers | Monday 9:00am | Twitter + deep dive reply at 9:30 + Instagram |
| Best game performances | Monday 9:30am | Twitter text thread only |
| Daily projections | Every day 7:00pm | Twitter thread + Instagram |

---

## Admin endpoints

Start the service then hit these endpoints:

| Endpoint | Method | Description |
|---|---|---|
| `/status` | GET | Last run per content type + next scheduled run |
| `/trigger/{content_type}` | POST | Fire a content type immediately (publishes) |
| `/preview/{content_type}` | GET | Generate copy + graphic but do NOT publish |
| `/posts` | GET | Recent post history from SQLite |
| `/healthz` | GET | Health check |

**Content type names:** `weekly_performers`, `risers_fallers`, `best_performances`, `daily_projections`

**Example — preview without posting:**
```bash
curl http://localhost:8001/preview/weekly_performers
```

**Example — fire immediately:**
```bash
curl -X POST http://localhost:8001/trigger/daily_projections
```

---

## Previewing templates locally

Render any template with sample data without publishing:

```python
import sys
sys.path.insert(0, '.')
import renderer

html = renderer.render_template('weekly_performers.html', {
    'week_label': 'MAY 12',
    'players': [
        {
            'name': 'Nikola Jokic',
            'team': 'DEN',
            'period_value': 42.3,
            'top_cats': 'PTS 28.5 · REB 13.2 · AST 10.1',
            'is_fa': False,
        },
        # ... add up to 5 players
    ]
})

path = renderer.html_to_image(html, 'preview_weekly', format='square')
print('Saved to:', path)
```

Open `social/temp/preview_weekly.png` to inspect the output.

---

## Off-season behaviour

`api_client.is_season_active()` checks whether any NBA games are scheduled in the next 7 days by querying the Roto Intel projections endpoint. If no games are found:

- All daily game-based posts (`daily_projections`, `weekly_performers`, `risers_fallers`, `best_performances`) are skipped
- Each skip is logged to the run_log table with `"off-season"` as the detail
- The scheduler continues running — it will automatically resume when games reappear in the data

---

## Adding a new content type

1. Create `content/my_new_type.py` — implement a `run(preview=False) -> dict` function following the pattern in existing handlers
2. Add it to `_CONTENT_HANDLERS` in `main.py`
3. Register a new `_scheduler.add_job(...)` call in `main.py` with the desired cron trigger
4. If it needs a new template, add an HTML file to `templates/` using the existing design system variables

---

## Data freshness

Before every post, the pipeline calls `api_client.data_freshness_ok()` which hits the `/api/rankings` endpoint. If the call fails or returns empty results, the post is skipped and a warning is logged. A stale data condition that persists for more than 48 hours should be investigated at the backend level.

---

## Deployment on Render

Add to `render.yaml` alongside the existing backend service:

```yaml
- type: web
  name: roto-intel-social
  env: python
  buildCommand: pip install -r social/requirements.txt && playwright install chromium
  startCommand: uvicorn social.main:app --host 0.0.0.0 --port 8001
  rootDir: .
  envVars:
    - key: TWITTER_API_KEY
      sync: false
    - key: TWITTER_API_SECRET
      sync: false
    - key: TWITTER_ACCESS_TOKEN
      sync: false
    - key: TWITTER_ACCESS_SECRET
      sync: false
    - key: ANTHROPIC_API_KEY
      sync: false
    - key: INSTAGRAM_ACCESS_TOKEN
      sync: false
    - key: INSTAGRAM_ACCOUNT_ID
      sync: false
    - key: ROTO_INTEL_API_BASE_URL
      value: https://your-backend.onrender.com
    - key: ROTO_INTEL_API_KEY
      sync: false
```

> **Important:** Playwright on Render requires the `chromium` install step in `buildCommand`. The `playwright install chromium` command downloads ~130MB — account for this in build time.
