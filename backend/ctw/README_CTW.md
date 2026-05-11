# CTW — Contribution To Winning

CTW measures how much a player's statistical output contributes to winning fantasy matchups, accounting for league context (team size, roster size, scarcity).

---

## How it works

### 1. Monte Carlo simulation

We build the win-probability curves by simulating fantasy leagues from real game log data:

1. **Player pool** — every player with 20+ games and 10+ min/g.
2. **Weekly distributions** — for each player, randomly sample 3 or 4 actual game logs (equal probability, with replacement) to produce a simulated week. Repeat 2,000 times → a realistic distribution of weekly outputs.
3. **Snake draft** — for each of 500 simulated leagues, players are drafted in snake order using Yahoo ADP + Gaussian noise (σ=8 picks) so rosters vary across leagues.
4. **Head-to-head matchups** — every team pair plays every simulated week. For each category in each week we record the winning team total, losing team total, and margin.
5. **Win probability curve** — for a given CTW%, the player's expected weekly contribution is `(CTW% / 100) × avg_winning_total`. P(win) = fraction of historical matchups where the winning margin was ≤ that contribution (i.e., the CDF of the margin distribution).

TOV is inverted: a higher TOV contribution hurts your team, so P(win) = 1 − CDF.

### 2. CTW% per player per category

**Counting stats** (PTS, REB, AST, STL, BLK, TOV, 3PM):

```
CTW% = (player_per_game_avg × 3.5) / avg_winning_weekly_total × 100
```

**FG% and FT%** (non-additive, so we measure marginal impact):

```
delta = (team_FGM + player_FGM) / (team_FGA + player_FGA)
      - team_FGM / team_FGA
CTW% = delta / avg_winning_rate × 100
```

This correctly measures how much a player moves the team's shooting percentage — not a down-weighting.

### 3. Expected wins

Each CTW% maps to a win probability via the pre-built curve. Sum across all 9 categories → `total_expected_wins`.

### 4. Scarcity adjustment

Replacement level = mean expected wins of the top 10 undrafted players for this league size. For each player:

```
ratio = base_ew / replacement_ew
adjusted = base_ew × log(ratio + 1)
```

This compresses the scale and rewards players who outperform what you'd pick up off the wire.

### 5. Variance adjustment

Togglable, off by default. When enabled, more consistent players receive a small upward adjustment. Pending empirical validation.

---

## Running the simulation

From the `backend/` directory:

```bash
# Full pipeline (simulation + scores + scarcity + validation)
python -m ctw.run --season 2024-25

# Quick test run
python -m ctw.run --season 2024-25 --n-leagues 50 --n-weeks 100

# Specific league sizes only
python -m ctw.run --season 2024-25 --league-sizes 10 12

# Recalculate player scores only (curves already exist)
python -m ctw.run --season 2024-25 --scores-only
```

---

## API endpoints

All endpoints are prefixed `/api/ctw`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/rankings` | Ranked player list. Params: `season`, `league_size`, `period`, `position`, `use_scarcity`, `limit` |
| GET | `/player/{slug}` | All-period CTW for one player. Params: `season`, `league_size` |
| GET | `/curves` | Full win-probability curve. Params: `category`, `league_size` |
| POST | `/personalised` | CTW for a custom roster. Body: `{season, league_size, roster: [slug,...]}` |
| POST | `/recalculate` | Recalculate scores (no sim). Body: `{season, league_sizes, periods}` |
| GET | `/validation` | Latest validation results. Params: `season` |

---

## Database tables

| Table | Purpose |
|-------|---------|
| `ctw_curves` | Win probability curve rows: `(category, league_size, ctw_pct) → win_probability` |
| `ctw_league_baselines` | Per-(league_size, category) averages for winning/losing totals + team FGM/FGA/FTM/FTA |
| `ctw_player_scores` | Per-(player, season, league_size, period) CTW%, expected wins, scarcity-adjusted wins |
| `ctw_validation_log` | Post-simulation validation check results |

---

## Known limitations

- Simulation uses season-to-date game logs; early-season results have high variance.
- ADP file must be updated manually (BBM_PlayerRankings.xls in `data/`).
- Variance adjustment is a stub pending empirical validation.
- FG%/FT% marginal delta uses average team baseline; actual roster composition matters.
