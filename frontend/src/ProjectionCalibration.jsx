import { useState, useEffect, useCallback } from 'react'

const STYLES = `
.pcal-page { padding: 24px; background: #0f172a; min-height: 100vh; color: #e2e8f0; font-family: system-ui, sans-serif; }
.pcal-controls { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.pcal-select { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 6px; padding: 8px 12px; font-size: 14px; cursor: pointer; }
.pcal-select:focus { outline: 2px solid #3b82f6; }
.pcal-title { font-size: 20px; font-weight: 700; color: #f1f5f9; margin: 0 0 16px; }
.pcal-minutes-bar { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; display: flex; align-items: center; gap: 16px; }
.pcal-minutes-label { font-size: 13px; color: #94a3b8; white-space: nowrap; }
.pcal-minutes-track { flex: 1; height: 8px; background: #334155; border-radius: 4px; overflow: hidden; }
.pcal-minutes-fill { height: 100%; border-radius: 4px; transition: width 0.2s, background 0.2s; }
.pcal-minutes-badge { font-size: 13px; font-weight: 600; padding: 3px 10px; border-radius: 12px; white-space: nowrap; }
.pcal-table-wrap { overflow-x: auto; margin-bottom: 20px; }
.pcal-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 900px; }
.pcal-table th { background: #1e293b; color: #94a3b8; font-weight: 600; padding: 10px 12px; text-align: left; border-bottom: 1px solid #334155; white-space: nowrap; }
.pcal-table td { padding: 10px 12px; border-bottom: 1px solid #1e293b; vertical-align: middle; }
.pcal-table tr:hover td { background: #1e2a3a; }
.pcal-player-name { font-weight: 600; color: #e2e8f0; }
.pcal-pos-tag { font-size: 11px; color: #64748b; margin-left: 6px; }
.pcal-input { background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 4px; padding: 4px 8px; font-size: 13px; width: 72px; text-align: right; }
.pcal-input:focus { outline: 1px solid #3b82f6; border-color: #3b82f6; }
.pcal-input-wide { width: 84px; }
.pcal-projected { color: #e2e8f0; font-weight: 600; }
.pcal-actual { color: #94a3b8; }
.pcal-delta-pos { color: #22c55e; font-weight: 600; }
.pcal-delta-neg { color: #ef4444; font-weight: 600; }
.pcal-delta-neutral { color: #94a3b8; }
.pcal-mini-select { background: #0f172a; color: #94a3b8; border: 1px solid #334155; border-radius: 4px; padding: 3px 6px; font-size: 11px; cursor: pointer; max-width: 110px; }
.pcal-mini-select:focus { outline: 1px solid #3b82f6; }
.pcal-dropdowns { display: flex; gap: 6px; flex-wrap: wrap; }
.pcal-saving-dot { display: inline-block; width: 6px; height: 6px; background: #3b82f6; border-radius: 50%; margin-left: 6px; animation: pcal-pulse 1s infinite; vertical-align: middle; }
@keyframes pcal-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
.pcal-error-inline { font-size: 11px; color: #ef4444; display: block; margin-top: 2px; }
.pcal-validation-panel { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 16px 20px; margin-top: 4px; }
.pcal-validation-title { font-size: 14px; font-weight: 600; color: #e2e8f0; margin: 0 0 12px; }
.pcal-validation-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 24px; margin-bottom: 12px; }
.pcal-validation-item { font-size: 13px; }
.pcal-validation-label { color: #64748b; }
.pcal-validation-value { color: #e2e8f0; font-weight: 600; margin-left: 8px; }
.pcal-status-badge { display: inline-block; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 12px; }
.pcal-loading { color: #64748b; padding: 40px; text-align: center; }
.pcal-rate-pair { display: flex; gap: 8px; align-items: center; }
.pcal-rate-label { font-size: 11px; color: #64748b; white-space: nowrap; }
`

const STATS = ['GP', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', '3PM', 'FG%', 'FT%']

const STAT_RATE_FIELDS = {
  MIN:  [],
  GP:   [],
  PTS:  [
    { key: 'two_pa_rate',   label: '2PA/min', pct: false, step: 0.001 },
    { key: 'two_p_pct',     label: '2P%',     pct: true },
    { key: 'three_pa_rate', label: '3PA/min', pct: false, step: 0.001 },
    { key: 'three_p_pct',   label: '3P%',     pct: true },
    { key: 'fta_rate',      label: 'FTA/min', pct: false, step: 0.001 },
    { key: 'ft_pct',        label: 'FT%',     pct: true },
  ],
  REB:  [{ key: 'reb_rate',      label: 'REB/poss', pct: false, step: 0.0001 }],
  AST:  [{ key: 'ast_rate',      label: 'AST/poss', pct: false, step: 0.0001 }],
  STL:  [{ key: 'steal_rate',    label: 'STL/poss', pct: false, step: 0.0001 }],
  BLK:  [{ key: 'block_rate',    label: 'BLK/poss', pct: false, step: 0.0001 }],
  TOV:  [{ key: 'tov_rate',      label: 'TOV/poss', pct: false, step: 0.0001 }],
  '3PM':[{ key: 'three_pa_rate', label: '3PA/min',  pct: false, step: 0.001 }],
  'FG%':[{ key: 'two_p_pct',    label: '2PT%', pct: true }, { key: 'three_p_pct', label: '3PT%', pct: true }],
  'FT%':[{ key: 'ft_pct',       label: 'FT%',  pct: true }],
}

// Map display stat to projected key (MIN/GP use actual fields only)
const STAT_PROJ_KEY = {
  MIN: null, GP: null,
  PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk',
  TOV: 'tov', '3PM': 'fg3m', 'FG%': 'fg_pct', 'FT%': 'ft_pct',
}

// Age curve stat mapping: display stat → age_curve_lookup stat name
const AGE_CURVE_STAT = {
  PTS: 'PTS', REB: 'REB', AST: 'AST', STL: 'STL', BLK: 'BLK',
  TOV: 'TOV', '3PM': '3PM', 'FG%': 'FG_PCT', 'FT%': 'FT_PCT',
}

// Rate fields affected by each age curve stat
const AGE_CURVE_FIELDS = {
  PTS: ['two_pa_rate', 'two_p_pct', 'three_pa_rate', 'three_p_pct', 'fta_rate', 'ft_pct'],
  REB: ['reb_rate'],
  AST: ['ast_rate'],
  STL: ['steal_rate'],
  BLK: ['block_rate'],
  TOV: ['tov_rate'],
  '3PM': ['three_pa_rate'],
  'FG%': ['two_p_pct', 'three_p_pct'],
  'FT%': ['ft_pct'],
}

function authFetch(url, opts = {}) {
  const token = localStorage.getItem('nba_token')
  return fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
}

function computeProjected(inp, pace = 98) {
  const mpg = inp.minutes_per_game || 0
  const poss = pace * (mpg / 48)
  const three_pa = (inp.three_pa_rate || 0) * mpg
  const three_pm = three_pa * (inp.three_p_pct || 0)
  const two_pa   = (inp.two_pa_rate || 0) * mpg
  const two_pm   = two_pa * (inp.two_p_pct || 0)
  const fta      = (inp.fta_rate || 0) * mpg
  const ftm      = fta * (inp.ft_pct || 0)
  const fga      = three_pa + two_pa
  const fgm      = three_pm + two_pm
  return {
    pts:    +(two_pm * 2 + three_pm * 3 + ftm).toFixed(1),
    reb:    +((inp.reb_rate    || 0) * poss).toFixed(1),
    ast:    +((inp.ast_rate    || 0) * poss).toFixed(1),
    stl:    +((inp.steal_rate  || 0) * poss).toFixed(2),
    blk:    +((inp.block_rate  || 0) * poss).toFixed(2),
    tov:    +((inp.tov_rate    || 0) * (inp.usage_rate || 0) * poss).toFixed(1),
    fg3m:   +three_pm.toFixed(1),
    fg_pct: fga > 0 ? +(fgm / fga).toFixed(3) : null,
    ft_pct: +(inp.ft_pct || 0).toFixed(3),
  }
}

const SEASON_MINUTES_TARGET = 82 * 240  // 19,680

function minutesColor(total) {
  const diff = Math.abs(total - SEASON_MINUTES_TARGET)
  if (total > SEASON_MINUTES_TARGET || diff > 1000) return '#ef4444'
  if (diff > 400) return '#f59e0b'
  return '#22c55e'
}

function minutesBadge(total) {
  const diff = total - SEASON_MINUTES_TARGET
  if (Math.abs(diff) <= 400) return { text: 'On target', color: '#22c55e', bg: '#052e16' }
  if (diff > 0) return { text: `OVER by ${Math.round(diff)}`, color: '#ef4444', bg: '#2d0000' }
  return { text: `Under by ${Math.round(Math.abs(diff))}`, color: diff < -1000 ? '#ef4444' : '#f59e0b', bg: diff < -1000 ? '#2d0000' : '#271900' }
}

function validationStatus(projected, lastSeason, p25, p75) {
  if (!projected || !lastSeason) return { label: 'No data', color: '#94a3b8', bg: '#1e293b' }
  const pctDiff = Math.abs((projected - lastSeason) / lastSeason) * 100
  const outsideIQR = p25 != null && p75 != null && (projected < p25 || projected > p75)
  if (pctDiff > 15 || outsideIQR) return { label: `${pctDiff > 0 ? '+' : ''}${((projected - lastSeason) / lastSeason * 100).toFixed(1)}% vs last yr`, color: '#ef4444', bg: '#2d0000' }
  if (pctDiff > 5) return { label: `${((projected - lastSeason) / lastSeason * 100).toFixed(1)}% vs last yr`, color: '#f59e0b', bg: '#271900' }
  return { label: 'Within range', color: '#22c55e', bg: '#052e16' }
}

function fmt(val, decimals = 1) {
  if (val == null) return '—'
  return (+val).toFixed(decimals)
}

function fmtPct(val) {
  if (val == null) return '—'
  return (val * 100).toFixed(1) + '%'
}

export default function ProjectionCalibrationPage() {
  const [teams, setTeams]           = useState([])
  const [team, setTeam]             = useState('')
  const [stat, setStat]             = useState('GP')
  const [data, setData]             = useState(null)
  const [loading, setLoading]       = useState(false)
  const [saving, setSaving]         = useState({})
  const [errors, setErrors]         = useState({})
  const [ageCurves, setAgeCurves]   = useState([])
  const [localInputs, setLocalInputs] = useState({})
  // Store previous values for revert on error
  const prevInputsRef = { current: {} }

  // Load teams + age curves on mount
  useEffect(() => {
    authFetch('/api/admin/projections/teams')
      .then(r => r.ok ? r.json() : [])
      .then(ts => { setTeams(ts); if (ts.length) setTeam(ts[0]) })
      .catch(() => {})

    authFetch('/api/admin/projections/age-curves')
      .then(r => r.ok ? r.json() : [])
      .then(setAgeCurves)
      .catch(() => {})
  }, [])

  // Load team data when team or stat changes
  useEffect(() => {
    if (!team) return
    setLoading(true)
    setData(null)
    authFetch(`/api/admin/projections/team/${team}?stat=${stat}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        setData(d)
        if (d?.players) {
          const li = {}
          d.players.forEach(p => { li[p.player_id] = { ...p.inputs } })
          setLocalInputs(li)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [team, stat])

  const teamPace = data?.pace || 98

  // Live season minutes total: Σ(projected_gp × mpg) across roster
  const minutesTotal = data?.players
    ? data.players.reduce((sum, p) => {
        const inp = localInputs[p.player_id] || p.inputs
        return sum + (inp.projected_gp || 0) * (inp.minutes_per_game || 0)
      }, 0)
    : 0

  function getProjected(p) {
    const inp = localInputs[p.player_id]
    if (!inp) return p.projected
    return computeProjected(inp, teamPace)
  }

  function setField(playerId, field, value) {
    setLocalInputs(prev => ({
      ...prev,
      [playerId]: { ...(prev[playerId] || {}), [field]: value },
    }))
  }

  async function saveField(playerId, field, value, previousValue, season) {
    setSaving(s => ({ ...s, [playerId]: true }))
    setErrors(e => ({ ...e, [playerId]: null }))
    try {
      const res = await authFetch(`/api/admin/projections/player/${playerId}`, {
        method: 'PATCH',
        body: JSON.stringify({ season, source_view: 'team_calibration', [field]: value }),
      })
      if (!res.ok) throw new Error(`Save failed (${res.status})`)
      const body = await res.json()
      if (body.updated) {
        setLocalInputs(prev => ({ ...prev, [playerId]: { ...prev[playerId], ...body.updated } }))
      }
    } catch (err) {
      // Revert
      setLocalInputs(prev => ({ ...prev, [playerId]: { ...(prev[playerId] || {}), [field]: previousValue } }))
      setErrors(e => ({ ...e, [playerId]: err.message }))
    } finally {
      setSaving(s => ({ ...s, [playerId]: false }))
    }
  }

  async function saveMultipleFields(playerId, fields, season) {
    setSaving(s => ({ ...s, [playerId]: true }))
    setErrors(e => ({ ...e, [playerId]: null }))
    try {
      const res = await authFetch(`/api/admin/projections/player/${playerId}`, {
        method: 'PATCH',
        body: JSON.stringify({ season, source_view: 'team_calibration', ...fields }),
      })
      if (!res.ok) throw new Error(`Save failed (${res.status})`)
      const body = await res.json()
      if (body.updated) {
        setLocalInputs(prev => ({ ...prev, [playerId]: { ...prev[playerId], ...body.updated } }))
      }
    } catch (err) {
      setErrors(e => ({ ...e, [playerId]: err.message }))
    } finally {
      setSaving(s => ({ ...s, [playerId]: false }))
    }
  }

  async function handleBaseYearChange(playerId, newBaseYear, season) {
    await saveField(playerId, 'base_year', newBaseYear, localInputs[playerId]?.base_year, season)
    // Reload team data to get fresh rates from backend
    if (team) {
      authFetch(`/api/admin/projections/team/${team}?stat=${stat}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          setData(d)
          if (d?.players) {
            setLocalInputs(prev => {
              const next = { ...prev }
              d.players.forEach(p => {
                if (p.player_id === playerId) next[p.player_id] = { ...p.inputs }
              })
              return next
            })
          }
        })
        .catch(() => {})
    }
  }

  function handleAgeCurveAction(player, action) {
    const curveStatKey = AGE_CURVE_STAT[stat]
    const age = player.age
    const curveRow = ageCurves.find(c => c.age === age && c.stat === curveStatKey)
    const inp = localInputs[player.player_id] || player.inputs
    const season = data?.season || '2025-26'

    if (action === 'reset') {
      handleBaseYearChange(player.player_id, inp.base_year || '2024-25', season)
      return
    }

    const multiplierKey = action === 'base' ? 'base_case_multiplier'
      : action === 'optimistic' ? 'optimistic_multiplier'
      : 'pessimistic_multiplier'

    if (!curveRow || curveRow[multiplierKey] == null) return

    const mult = curveRow[multiplierKey]
    const fields = AGE_CURVE_FIELDS[stat] || []
    const updated = {}
    fields.forEach(f => {
      if (inp[f] != null) updated[f] = +(inp[f] * mult).toFixed(5)
    })
    setLocalInputs(prev => ({ ...prev, [player.player_id]: { ...prev[player.player_id], ...updated } }))
    saveMultipleFields(player.player_id, updated, season)
  }

  // Team projected total for selected stat (from localInputs) — GP-weighted season totals
  const projKey = STAT_PROJ_KEY[stat]
  const teamProjectedTotal = data?.players
    ? stat === 'MIN'
      ? minutesTotal
      : stat === 'GP'
        ? data.players.reduce((sum, p) => {
            const inp = localInputs[p.player_id] || p.inputs
            return sum + (inp.projected_gp || 0)
          }, 0)
        : data.players.reduce((sum, p) => {
            const proj = getProjected(p)
            const inp = localInputs[p.player_id] || p.inputs
            return sum + (inp.projected_gp || 0) * (proj?.[projKey] || 0)
          }, 0)
    : null

  const mBar = minutesBadge(minutesTotal)
  const mColor = minutesColor(minutesTotal)
  const fillPct = Math.min((minutesTotal / SEASON_MINUTES_TARGET) * 100, 100)

  const valStatus = data ? validationStatus(
    teamProjectedTotal,
    data.last_season_team_total,
    data.league_p25,
    data.league_p75,
  ) : null

  const rateFields = STAT_RATE_FIELDS[stat] || []

  return (
    <>
      <style>{STYLES}</style>
      <div className="pcal-page">
        <h2 className="pcal-title">Team Calibration</h2>

        <div className="pcal-controls">
          <select className="pcal-select" value={team} onChange={e => setTeam(e.target.value)}>
            {!team && <option value="">Select team…</option>}
            {teams.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <select className="pcal-select" value={stat} onChange={e => setStat(e.target.value)}>
            {STATS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Minutes status bar — always shown (useful context for all stat views) */}
        {data && stat !== 'GP' && (
          <div className="pcal-minutes-bar">
            <span className="pcal-minutes-label">Season minutes: {Math.round(minutesTotal).toLocaleString()} / 19,680</span>
            <div className="pcal-minutes-track">
              <div className="pcal-minutes-fill" style={{ width: `${fillPct}%`, background: mColor }} />
            </div>
            <span className="pcal-minutes-badge" style={{ color: mBar.color, background: mBar.bg }}>
              {mBar.text}
            </span>
          </div>
        )}

        {loading && <div className="pcal-loading">Loading…</div>}

        {data && !loading && (
          <>
            <div className="pcal-table-wrap">
              <table className="pcal-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Age</th>
                    {stat === 'MIN' ? (
                      <>
                        <th>Min/G ✎</th>
                        <th style={{ color: '#64748b' }}>Last yr MIN</th>
                        <th style={{ color: '#64748b' }}>2 yrs ago</th>
                      </>
                    ) : stat === 'GP' ? (
                      <>
                        <th>Proj GP ✎</th>
                        <th style={{ color: '#64748b' }}>Last yr GP</th>
                        <th style={{ color: '#64748b' }}>2 yrs ago</th>
                        <th style={{ color: '#64748b' }}>3yr avg</th>
                        <th style={{ color: '#64748b' }}>Career avg</th>
                      </>
                    ) : (
                      <>
                        <th style={{ color: '#64748b' }}>Min/G</th>
                        <th style={{ color: '#64748b' }}>GP</th>
                        {rateFields.map(f => <th key={f.key}>{f.label}</th>)}
                        <th>Proj {stat}</th>
                        <th>Actual {stat}</th>
                        <th>Δ%</th>
                        <th>Base year</th>
                        <th>Scenario</th>
                        <th>Age curve</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.players.map(p => {
                    const inp    = localInputs[p.player_id] || p.inputs
                    const proj   = getProjected(p)
                    const season = data.season || '2025-26'
                    const isSaving = saving[p.player_id]

                    // MIN/GP: projected = input value, actual = actuals
                    const projV = stat === 'MIN' ? (inp.minutes_per_game ?? null)
                      : stat === 'GP'  ? (inp.projected_gp ?? null)
                      : proj?.[projKey]
                    const actV  = stat === 'MIN' ? (p.actual?.min ?? null)
                      : stat === 'GP'  ? (p.actual?.gp ?? null)
                      : p.actual?.[projKey]
                    const delta = projV != null && actV != null && actV !== 0
                      ? ((projV - actV) / actV) * 100
                      : null
                    const deltaClass = delta == null ? 'pcal-delta-neutral'
                      : delta > 5 ? 'pcal-delta-neg'
                      : delta < -5 ? 'pcal-delta-pos'
                      : 'pcal-delta-neutral'

                    return (
                      <tr key={p.player_id}>
                        {/* Player name */}
                        <td>
                          <span className="pcal-player-name">{p.full_name}</span>
                          {isSaving && <span className="pcal-saving-dot" />}
                          <span className="pcal-pos-tag">· {p.position || '—'}</span>
                          {errors[p.player_id] && <span className="pcal-error-inline">{errors[p.player_id]}</span>}
                        </td>

                        {/* Age */}
                        <td style={{ color: '#94a3b8' }}>{p.age}</td>

                        {/* MIN view: editable Min/G + historical reference columns */}
                        {stat === 'MIN' && (() => {
                          const refs = p.min_references || {}
                          return (
                            <>
                              <td>
                                <input
                                  className="pcal-input"
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  max="48"
                                  value={inp.minutes_per_game ?? ''}
                                  onChange={e => setField(p.player_id, 'minutes_per_game', parseFloat(e.target.value) || 0)}
                                  onBlur={e => {
                                    const val = parseFloat(e.target.value) || 0
                                    saveField(p.player_id, 'minutes_per_game', val, p.inputs.minutes_per_game, season)
                                  }}
                                />
                              </td>
                              <td className="pcal-actual">{refs.last_yr ?? '—'}</td>
                              <td className="pcal-actual">{refs.prev_yr ?? '—'}</td>
                            </>
                          )
                        })()}

                        {/* GP view: editable projected GP + historical reference columns */}
                        {stat === 'GP' && (() => {
                          const refs = p.gp_references || {}
                          return (
                            <>
                              <td>
                                <input
                                  className="pcal-input"
                                  type="number"
                                  step="1"
                                  min="0"
                                  max="82"
                                  value={inp.projected_gp ?? ''}
                                  onChange={e => setField(p.player_id, 'projected_gp', parseFloat(e.target.value) || 0)}
                                  onBlur={e => {
                                    const val = parseFloat(e.target.value) || 0
                                    saveField(p.player_id, 'projected_gp', val, p.inputs.projected_gp, season)
                                  }}
                                />
                              </td>
                              <td className="pcal-actual">{refs.last_yr ?? '—'}</td>
                              <td className="pcal-actual">{refs.prev_yr ?? '—'}</td>
                              <td className="pcal-actual">{refs.three_avg ?? '—'}</td>
                              <td className="pcal-actual">{refs.career ?? '—'}</td>
                            </>
                          )
                        })()}

                        {/* Other stats: Min/G and GP as read-only reference columns, then full calibration */}
                        {stat !== 'MIN' && stat !== 'GP' && (
                          <>
                            <td className="pcal-actual">{fmt(inp.minutes_per_game)}</td>
                            <td className="pcal-actual">{inp.projected_gp ?? '—'}</td>

                            {/* Rate field(s) editable */}
                            {rateFields.map(f => (
                              <td key={f.key}>
                                {f.pct ? (
                                  <input
                                    className="pcal-input"
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="100"
                                    value={inp[f.key] != null ? +(inp[f.key] * 100).toFixed(2) : ''}
                                    onChange={e => setField(p.player_id, f.key, (parseFloat(e.target.value) || 0) / 100)}
                                    onBlur={e => {
                                      const val = (parseFloat(e.target.value) || 0) / 100
                                      saveField(p.player_id, f.key, val, p.inputs[f.key], season)
                                    }}
                                  />
                                ) : (
                                  <input
                                    className="pcal-input pcal-input-wide"
                                    type="number"
                                    step={f.step || 0.0001}
                                    min="0"
                                    value={inp[f.key] ?? ''}
                                    onChange={e => setField(p.player_id, f.key, parseFloat(e.target.value) || 0)}
                                    onBlur={e => {
                                      const val = parseFloat(e.target.value) || 0
                                      saveField(p.player_id, f.key, val, p.inputs[f.key], season)
                                    }}
                                  />
                                )}
                              </td>
                            ))}

                            {/* Proj / Actual / Δ% */}
                            <td className="pcal-projected">
                              {projKey === 'fg_pct' || projKey === 'ft_pct'
                                ? fmtPct(projV)
                                : fmt(projV)}
                            </td>
                            <td className="pcal-actual">
                              {projKey === 'fg_pct' || projKey === 'ft_pct'
                                ? fmtPct(actV)
                                : fmt(actV)}
                            </td>
                            <td className={deltaClass}>
                              {delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%` : '—'}
                            </td>

                            {/* Base year dropdown */}
                            <td>
                              <select
                                className="pcal-mini-select"
                                value={inp.base_year || ''}
                                onChange={e => handleBaseYearChange(p.player_id, e.target.value, season)}
                              >
                                {(p.available_seasons || []).map(s => (
                                  <option key={s} value={s}>{s}</option>
                                ))}
                              </select>
                            </td>

                            {/* Scenario dropdown */}
                            <td>
                              <select
                                className="pcal-mini-select"
                                value={inp.scenario || 'base_case'}
                                onChange={e => saveField(p.player_id, 'scenario', e.target.value, inp.scenario, season)}
                              >
                                <option value="base_case">Base case</option>
                                <option value="optimistic">Optimistic</option>
                                <option value="pessimistic">Pessimistic</option>
                              </select>
                            </td>

                            {/* Age curve action dropdown */}
                            <td>
                              <select
                                className="pcal-mini-select"
                                value=""
                                onChange={e => {
                                  if (e.target.value) handleAgeCurveAction(p, e.target.value)
                                  e.target.value = ''
                                }}
                              >
                                <option value="">Apply curve…</option>
                                <option value="base">Apply base curve</option>
                                <option value="optimistic">Apply optimistic</option>
                                <option value="pessimistic">Apply pessimistic</option>
                                <option value="reset">Reset to base year</option>
                              </select>
                            </td>
                          </>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Team stat validation panel */}
            {valStatus && (
              <div className="pcal-validation-panel">
                <p className="pcal-validation-title">Team {stat} audit</p>
                <div className="pcal-validation-grid">
                  <div className="pcal-validation-item">
                    <span className="pcal-validation-label">Projected total:</span>
                    <span className="pcal-validation-value">
                      {projKey === 'fg_pct' || projKey === 'ft_pct'
                        ? fmtPct(teamProjectedTotal / (data.players?.length || 1))
                        : fmt(teamProjectedTotal)}
                    </span>
                  </div>
                  <div className="pcal-validation-item">
                    <span className="pcal-validation-label">Last season:</span>
                    <span className="pcal-validation-value">{fmt(data.last_season_team_total)}</span>
                  </div>
                  <div className="pcal-validation-item">
                    <span className="pcal-validation-label">League median:</span>
                    <span className="pcal-validation-value">{fmt(data.league_median)}</span>
                  </div>
                  <div className="pcal-validation-item">
                    <span className="pcal-validation-label">League max:</span>
                    <span className="pcal-validation-value">{fmt(data.league_max)}</span>
                  </div>
                  <div className="pcal-validation-item">
                    <span className="pcal-validation-label">League min:</span>
                    <span className="pcal-validation-value">{fmt(data.league_min)}</span>
                  </div>
                  <div className="pcal-validation-item">
                    <span className="pcal-validation-label">75th pct:</span>
                    <span className="pcal-validation-value">{fmt(data.league_p75)}</span>
                  </div>
                  <div className="pcal-validation-item">
                    <span className="pcal-validation-label">25th pct:</span>
                    <span className="pcal-validation-value">{fmt(data.league_p25)}</span>
                  </div>
                </div>
                <span
                  className="pcal-status-badge"
                  style={{ color: valStatus.color, background: valStatus.bg }}
                >
                  {valStatus.label}
                </span>
              </div>
            )}
          </>
        )}

        {!team && !loading && (
          <div className="pcal-loading">Select a team to begin calibration.</div>
        )}
      </div>
    </>
  )
}
