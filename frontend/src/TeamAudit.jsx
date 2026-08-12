import { useState, useEffect } from 'react'

const STATS = ['GP', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV']

const STYLES = `
.tsa-page { padding: 24px; background: #0f172a; min-height: 100vh; color: #e2e8f0; font-family: system-ui, sans-serif; }
.tsa-title { font-size: 20px; font-weight: 700; color: #f1f5f9; margin: 0 0 4px; }
.tsa-sub { color: #64748b; font-size: 13px; margin-bottom: 16px; }
.tsa-controls { display: flex; gap: 12px; align-items: center; margin-bottom: 18px; flex-wrap: wrap; }
.tsa-select { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 6px; padding: 8px 12px; font-size: 14px; cursor: pointer; }
.tsa-axis { display: grid; grid-template-columns: 44px 210px 60px 76px 96px 1fr; gap: 14px; margin-bottom: 10px; color: #64748b; font-size: 11px; }
.tsa-row { display: grid; grid-template-columns: 44px 210px 60px 76px 96px 1fr; align-items: center; gap: 14px; padding: 7px 0; border-bottom: 1px solid #1e293b; }
.tsa-row:hover { background: #16202e; }
.tsa-rank { color: #64748b; font-size: 13px; text-align: right; }
.tsa-team { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tsa-ly { color: #64748b; font-size: 13px; text-align: right; font-variant-numeric: tabular-nums; }
.tsa-total { font-variant-numeric: tabular-nums; font-weight: 700; text-align: right; font-size: 13px; color: #e2e8f0; }
.tsa-track { position: relative; height: 12px; background: #1e293b; border-radius: 6px; }
.tsa-fill { height: 100%; border-radius: 6px; transition: width .2s; background: #3b82f6; }
.tsa-tick { position: absolute; top: -3px; bottom: -3px; width: 1px; background: #475569; }
`

function authFetch(url, opts = {}) {
  const token = localStorage.getItem('nba_token')
  return fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } })
}

const fmt = v => v == null ? '—' : (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : (+v).toFixed(1))

export default function TeamStatAuditPage() {
  const [stat, setStat]       = useState('MIN')
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true); setData(null)
    authFetch(`/api/admin/projections/audit-all-teams?stat=${stat}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [stat])

  const lo = data?.league_min, hi = data?.league_max
  const range = (hi != null && lo != null && hi !== lo) ? hi - lo : 1
  const pct = v => v == null ? 0 : Math.max(0, Math.min(100, ((v - lo) / range) * 100))

  const ticks = data ? [
    { v: data.league_min,    label: 'Min' },
    { v: data.league_p25,    label: 'P25' },
    { v: data.league_median, label: 'Med' },
    { v: data.league_p75,    label: 'P75' },
    { v: data.league_max,    label: 'Max' },
  ].filter(t => t.v != null) : []

  return (
    <>
      <style>{STYLES}</style>
      <div className="tsa-page">
        <h2 className="tsa-title">Team Audit</h2>
        <div className="tsa-sub">Every team's projected total for one stat on the shared league bar, alongside last season's rank and total for comparison.</div>

        <div className="tsa-controls">
          <select className="tsa-select" value={stat} onChange={e => setStat(e.target.value)}>
            {STATS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {data && <span style={{ color: '#94a3b8', fontSize: 13 }}>
            Med {fmt(data.league_median)} · P25 {fmt(data.league_p25)} · P75 {fmt(data.league_p75)} · Min {fmt(data.league_min)} · Max {fmt(data.league_max)}
          </span>}
        </div>

        {loading && <div style={{ color: '#64748b', padding: 20 }}>Loading…</div>}

        {data && !loading && (
          <>
            <div className="tsa-axis">
              <div></div><div></div>
              <div style={{ textAlign: 'right' }}>LY Rk</div>
              <div style={{ textAlign: 'right' }}>LY Tot</div>
              <div style={{ textAlign: 'right' }}>Proj</div>
              <div style={{ position: 'relative', height: 14 }}>
                {ticks.map((t, i) => (
                  <div key={t.label} style={{
                    position: 'absolute', left: `${pct(t.v)}%`,
                    transform: i === 0 ? 'translateX(0)' : i === ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                    whiteSpace: 'nowrap',
                  }}>{t.label}</div>
                ))}
              </div>
            </div>

            {data.teams.map(t => (
              <div key={t.team} className="tsa-row">
                <div className="tsa-rank">#{t.rank ?? '—'}</div>
                <div className="tsa-team">{t.team}</div>
                <div className="tsa-ly">{t.last_season_rank != null ? `#${t.last_season_rank}` : '—'}</div>
                <div className="tsa-ly">{fmt(t.last_season_total)}</div>
                <div className="tsa-total">{fmt(t.total)}</div>
                <div className="tsa-track">
                  <div className="tsa-fill" style={{ width: `${pct(t.total)}%` }} />
                  {ticks.map(tk => (
                    <div key={tk.label} className="tsa-tick" style={{ left: `${pct(tk.v)}%` }} />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  )
}
