"""
test_decompose.py — Sanity check once refresh.py has finished.

Run from the backend folder:
    python test_decompose.py
"""

from schema import get_conn
from engine.decompose import decompose

conn = get_conn()

# Test with Luka Doncic — first half vs second half of 2023-24
result = decompose(
    conn        = conn,
    player_slug = "doncilu01",
    stat        = "reb",
    period_a    = ("2023-10-01", "2024-01-15"),
    period_b    = ("2024-01-16", "2024-04-15"),
)

if result is None:
    print("No data found — check the slug and date range.")
else:
    print(f"\nLuka Doncic — rebounds/g")
    print(f"  Period A: {result.stat_a}")
    print(f"  Period B: {result.stat_b}")
    print(f"  Delta:    {result.delta:+.3f}")
    print(f"\nDriver contributions:")
    for d in result.drivers:
        bar = ("+" * int(abs(d.contribution) * 20)) if d.contribution >= 0 else ("-" * int(abs(d.contribution) * 20))
        print(f"  {d.label:<30} {d.contribution:+.3f}  [{d.category:<8}]  {bar}")

    total = sum(d.contribution for d in result.drivers)
    print(f"\n  Sum of drivers: {total:+.3f}")
    print(f"  Actual delta:   {result.delta:+.3f}")
    print(f"  Residual:       {abs(result.delta - total):.6f}  (should be ~0)")

conn.close()
