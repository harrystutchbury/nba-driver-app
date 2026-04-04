# NBA Stat Driver App

## Structure
```
nba-driver-app/
├── backend/
│   ├── data/
│   │   └── nba.db              # SQLite database (git-ignored)
│   ├── api/
│   │   └── main.py             # FastAPI app
│   ├── engine/
│   │   └── decompose.py        # Driver decomposition logic
│   ├── refresh.py              # Nightly data ingestion script
│   ├── schema.py               # DB schema + setup
│   └── requirements.txt
├── frontend/
│   └── src/                    # React app (scaffolded later)
├── scripts/
│   └── init_db.py              # One-time DB initialisation
└── README.md
```

## Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python scripts/init_db.py      # create tables
python refresh.py              # pull data (takes ~20 mins first run)
uvicorn api.main:app --reload  # start API
```
