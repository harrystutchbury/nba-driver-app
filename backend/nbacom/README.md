# NBA.com Tracking & Hustle Stats Pipeline

Secondary data pipeline that pulls tracking and hustle stats from the NBA.com
unofficial API using the `nba_api` Python library. These stats are not available
from Tank01.

---

## How the data pull works

`leaguedashptstats` from `nba_api` returns **cumulative stats for the specified
date range**. Querying with `date_from=yesterday, date_to=yesterday` and
`per_mode_simple=PerGame` gives single-game per-game figures for that day
directly — no delta arithmetic needed.

This approach works correctly for all stat types:
- **Counting stats** (drives, deflections, touches): returned as the per-game
  value for that game (which equals the actual count since GP=1).
- **Rate/percentage stats** (avg_speed, FG%, PIE): returned as the value for
  that game day.

### Why not the delta approach?

The spec originally described a delta (cumulative through yesterday minus
cumulative through the day before). This works for counting stats with `Totals`
mode but breaks for rate stats — the difference between two season averages is
not the single-game value. The single-day query is simpler and correct for all
stat types.

### Season averages

Season averages in `nbacom_stats_season_avg` are computed from the stored
`nbacom_stats_game_log` rows (arithmetic mean across games), **not** by
re-querying the API. This avoids 36 extra API calls per night.

**Caveat**: Percentage stats (drive_fg_pct, catch_shoot_efg_pct, etc.) are
arithmetically averaged across games, which can differ slightly from the true
weighted season average. For exact weighted percentages, query the API
directly with the full date range and `per_mode_simple=PerGame`.

---

## Nightly schedule

Run `python -m nbacom.pipeline` at **06:00 ET** (cron or APScheduler).
Games are typically final well before then.

```
# crontab example (ET = UTC-5 / UTC-4 in daylight saving)
0 11 * * * cd /app/backend && python -m nbacom.pipeline >> /var/log/nbacom.log 2>&1
```

The pipeline:
1. Pulls all 12 measure types for yesterday
2. Maps NBA.com player IDs to our player slugs
3. Inserts/upserts rows into `nbacom_stats_game_log`
4. Recomputes `nbacom_stats_season_avg` for full_season / last_30 / last_14

---

## Running the backfill

The backfill populates the full 2025-26 season history. **Estimated runtime:
several hours** — design it to run overnight.

```bash
cd backend

# Full season (Oct 22 2025 → yesterday)
python -m nbacom.backfill

# Resume from a specific date (if interrupted)
python -m nbacom.backfill --from 2026-01-15

# Process a specific month only
python -m nbacom.backfill --from 2026-01-01 --to 2026-01-31

# Force-reprocess dates already in the database
python -m nbacom.backfill --force
```

### How resume works

The backfill checks which game dates already have all 12 measure types in
`nbacom_stats_game_log`. Dates where all 12 are present are skipped.
If a date was partially processed (some measure types failed), it will be
reprocessed. Use `--force` to reprocess fully-complete dates too.

### Rate limiting during backfill

- 3-second delay between every API call (vs 2s for nightly)
- 30-second pause between calendar months
- If a measure type fails after 3 retries, it's logged and skipped
- If 3+ measure types fail in one day, that day is marked failed and the
  backfill continues with the next day

---

## Adding a new measure type

1. Add the measure type string to `MEASURE_TYPES` in `client.py`
2. Add its `{API_COL: 'db_col'}` mapping to `MEASURE_COL_MAP` in `client.py`
3. Add the new DB columns to `_STAT_COLS_DDL` in `schema.py`
4. Run `python -m nbacom.schema` to add the columns to the live database
   (SQLite `ALTER TABLE ADD COLUMN` — safe on existing data)
5. Run the backfill for the date range you want

---

## Known fragility points

### NBA.com blocks rapid requests
The unofficial API rate-limits aggressively. If you see `JSONDecodeError` or
`ConnectionError`, it's usually a rate-limit block. The pipeline enforces a
2-second inter-call delay and exponential backoff (3 attempts), but if the
block persists:
- Wait 10–15 minutes before retrying
- Increase `INTER_CALL_DELAY` in `client.py`
- Check `nbacom_pipeline_log` for failure patterns

### Column name changes
NBA.com occasionally renames columns between seasons. If `fetch_measure`
returns no data for a measure type, check that the `MEASURE_COL_MAP` column
names still match the API response. Use:
```python
from nba_api.stats.endpoints import leaguedashptstats
r = leaguedashptstats.LeagueDashPtStats(pt_measure_type='Defense', ...)
print(r.get_data_frames()[0].columns.tolist())
```

### Season label
`CURRENT_SEASON` in `client.py` is hardcoded to `"2025-26"`. Update it each
season, along with `SEASON_START` in `pipeline.py` and `backfill.py`.

### Player ID mapping failures
NBA.com uses different player IDs from Tank01. New players (rookies, two-way
contracts, trade acquisitions) may not be in our `players` table yet. They
land in `nbacom_unmatched_players` and are reported by `/nbacom-stats/pipeline-status`.

To manually add a mapping:
```sql
INSERT INTO nbacom_player_id_mapping
    (our_player_id, nba_com_player_id, player_name, team_abbreviation, last_verified)
VALUES ('player-slug', 1234567, 'Player Name', 'LAL', date('now'));
```

---

## API endpoints

| Endpoint | Description |
|---|---|
| `GET /api/nbacom-stats/player/{slug}?period=full_season` | All tracking stats for a player |
| `GET /api/nbacom-stats/leaders?measure_type=Defense&stat=DEFLECTIONS&period=last_14` | Leaderboard for any stat |
| `GET /api/nbacom-stats/pipeline-status` | Last run, failures, unmatched players |

Valid `period` values: `full_season`, `last_30`, `last_14`

Stat names accept either `UPPER_CASE` (NBA.com convention) or `snake_case`
(our DB convention).

---

## Database tables

| Table | Purpose |
|---|---|
| `nbacom_stats_game_log` | Per-game stats; one row per player × game_date × measure_type |
| `nbacom_stats_season_avg` | Rolling averages; one row per player × season × period × measure_type |
| `nbacom_player_id_mapping` | NBA.com ID ↔ our player slug |
| `nbacom_unmatched_players` | NBA.com players that couldn't be matched |
| `nbacom_pipeline_log` | Audit log for every pipeline run |
