"""Shared constants for the CTW module."""

# Categories
COUNTING_CATS = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m"]
PCT_CATS      = ["fg", "ft"]
ALL_CATS      = COUNTING_CATS + PCT_CATS

# Categories where lower is better (curve inverted)
INVERTED_CATS = {"tov"}

# Roster config matching ESPN/Yahoo standard 9-cat H2H
ROSTER_SIZE   = 13   # total players per team
ACTIVE_SIZE   = 10   # starters counted each week (approximation)

# Simulation defaults
# 500 leagues × 100 weeks gives ~6M matchup samples per category at ls=16 —
# enough for a smooth CDF. 1000 weeks causes OOM at larger league sizes.
DEFAULT_N_LEAGUES       = 500
DEFAULT_N_WEEKS         = 100
DEFAULT_N_WEEK_SAMPLES  = 2000   # pre-sampled weekly distributions per player

# Draft
ADP_NOISE_SIGMA = 8.0   # Gaussian noise added to ADP to vary leagues

# CTW% range stored in curves table
CTW_PCT_MIN  = -50
CTW_PCT_MAX  = 200

# Minimum games played to enter player pool
MIN_GAMES    = 20
MIN_MIN_PG   = 10.0   # minutes per game threshold

# Scarcity: replacement pool = league_size × roster_size × 1.5
REPLACEMENT_MULTIPLIER = 1.5
