import { useState, useEffect, useCallback, useRef } from 'react'

const COLORS = {
  bg: '#0f172a',
  card: '#1e293b',
  border: '#334155',
  text: '#e2e8f0',
  muted: '#94a3b8',
  red: '#ef4444',
  green: '#22c55e',
  amber: '#f59e0b',
  blue: '#3b82f6',
  inputBg: '#0f172a',
}

const STATS = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', '3PM', 'FG%', 'FT%']
const PERIODS = [
  { label: 'Last 7',      value: 'last_7' },
  { label: 'Last 14',     value: 'last_14' },
  { label: 'Last 30',     value: 'last_30' },
  { label: 'Full Season', value: 'full_season' },
]

// Diagnostic field definitions per stat
const DIAG_FIELDS = {
  PTS: [
    { key: 'projected_min',    label: 'Proj MIN',   title: 'Projected Minutes/G', editable: 'minutes_per_game', fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'actual_min',       label: 'Act MIN',    title: 'Actual Minutes/G',    fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'projected_usage',  label: 'Proj USG',   title: 'Projected Usage Rate', editable: 'usage_rate', fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'actual_usage',     label: 'Act USG',    title: 'Actual Usage Rate',   fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'two_pa_proj',      label: '2PA Proj',   title: 'Projected 2PT Attempts/G', fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'two_pa_actual',    label: '2PA Act',    title: 'Actual 2PT Attempts/G',    fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'two_pct_proj',     label: '2P% Proj',   title: 'Projected 2PT%', editable: 'two_p_pct', fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'two_pct_actual',   label: '2P% Act',    title: 'Actual 2PT%',    fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'three_pa_proj',    label: '3PA Proj',   title: 'Projected 3PT Attempts/G', fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'three_pa_actual',  label: '3PA Act',    title: 'Actual 3PT Attempts/G',    fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'three_pct_proj',   label: '3P% Proj',   title: 'Projected 3PT%', editable: 'three_p_pct', fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'three_pct_actual', label: '3P% Act',    title: 'Actual 3PT%',    fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'fta_proj',         label: 'FTA Proj',   title: 'Projected FTA/G', fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'fta_actual',       label: 'FTA Act',    title: 'Actual FTA/G',    fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'ft_pct_proj',      label: 'FT% Proj',   title: 'Projected FT%', editable: 'ft_pct', fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'ft_pct_actual',    label: 'FT% Act',    title: 'Actual FT%',    fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'drive_frequency',  label: 'Drives/G',   title: 'Drives per Game',         fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'paint_touches_pg', label: 'Paint/G',    title: 'Paint Touches per Game',   fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'opp_def_rating',   label: 'Opp DRtg',   title: 'Opponent Defensive Rating', fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'pace',             label: 'Pace',        title: 'Team Pace',               fmt: v => v?.toFixed(1) ?? '-' },
  ],
  REB: [
    { key: 'projected_min',    label: 'Proj MIN',    title: 'Projected Minutes/G', editable: 'minutes_per_game', fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'actual_min',       label: 'Act MIN',     title: 'Actual Minutes/G',    fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'oreb_pct_proj',    label: 'OREB% Proj',  title: 'Projected OREB%', editable: 'reb_rate', fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'oreb_pct_actual',  label: 'OREB% Act',   title: 'Actual OREB%',    fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'dreb_pct_proj',    label: 'DREB% Proj',  title: 'Projected DREB%', fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'dreb_pct_actual',  label: 'DREB% Act',   title: 'Actual DREB%',    fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'reb_chance_pg',    label: 'RebChance/G', title: 'Rebound Chance per Game',     fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'contested_reb_pg', label: 'ContReb/G',   title: 'Contested Rebounds per Game', fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'opp_reb_rate',     label: 'Opp REB%',    title: 'Opponent Rebound Rate',       fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'pace',             label: 'Pace',         title: 'Team Pace',                  fmt: v => v?.toFixed(1) ?? '-' },
  ],
  AST: [
    { key: 'projected_min',    label: 'Proj MIN',   title: 'Projected Minutes/G', editable: 'minutes_per_game', fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'actual_min',       label: 'Act MIN',    title: 'Actual Minutes/G',    fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'projected_usage',  label: 'Proj USG',   title: 'Projected Usage Rate', editable: 'usage_rate', fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'actual_usage',     label: 'Act USG',    title: 'Actual Usage Rate',   fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'potential_ast_pg', label: 'PotAST/G',   title: 'Potential Assists per Game', fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'ast_conv_rate',    label: 'AST Conv%',  title: 'Assist Conversion Rate',     fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'passes_made_pg',   label: 'Passes/G',   title: 'Passes Made per Game',       fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'teammate_fg_pct',  label: 'TM FG%',     title: 'Teammate FG%',               fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'opp_def_rating',   label: 'Opp DRtg',   title: 'Opponent Defensive Rating',  fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'pace',             label: 'Pace',        title: 'Team Pace',                  fmt: v => v?.toFixed(1) ?? '-' },
  ],
  STL: [
    { key: 'projected_min',    label: 'Proj MIN',      title: 'Projected Minutes/G',  editable: 'minutes_per_game', fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'actual_min',       label: 'Act MIN',       title: 'Actual Minutes/G',     fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'stl_rate_proj',    label: 'STL Rate Proj', title: 'Projected Steal Rate', editable: 'steal_rate', fmt: v => v?.toFixed(4) ?? '-' },
    { key: 'stl_rate_actual',  label: 'STL Rate Act',  title: 'Actual Steal Rate',    fmt: v => v?.toFixed(4) ?? '-' },
    { key: 'deflections_pg',   label: 'Deflect/G',     title: 'Deflections per Game', fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'defl_to_stl_rate', label: 'Defl→STL%',     title: 'Deflection to Steal %', fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'opp_pace',         label: 'Opp Pace',       title: 'Opponent Pace',        fmt: v => v?.toFixed(1) ?? '-' },
  ],
  BLK: [
    { key: 'projected_min',      label: 'Proj MIN',      title: 'Projected Minutes/G',     editable: 'minutes_per_game', fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'actual_min',         label: 'Act MIN',       title: 'Actual Minutes/G',        fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'blk_rate_proj',      label: 'BLK Rate Proj', title: 'Projected Block Rate',    editable: 'block_rate', fmt: v => v?.toFixed(4) ?? '-' },
    { key: 'blk_rate_actual',    label: 'BLK Rate Act',  title: 'Actual Block Rate',       fmt: v => v?.toFixed(4) ?? '-' },
    { key: 'contested_shots_pg', label: 'ContShots/G',   title: 'Contested Shots per Game',     fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'contested_2pt_pg',   label: 'ContRim/G',     title: 'Contested Shots at Rim/G',     fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'rim_to_blk_rate',    label: 'Rim→BLK%',      title: 'Rim Contest to Block Rate',    fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'opp_pace',           label: 'Opp Pace',       title: 'Opponent Pace',               fmt: v => v?.toFixed(1) ?? '-' },
  ],
  TOV: [
    { key: 'projected_min',         label: 'Proj MIN',      title: 'Projected Minutes/G',  editable: 'minutes_per_game', fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'actual_min',            label: 'Act MIN',       title: 'Actual Minutes/G',     fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'tov_rate_proj',         label: 'TOV Rate Proj', title: 'Projected TOV Rate',   editable: 'tov_rate', fmt: v => v?.toFixed(4) ?? '-' },
    { key: 'tov_rate_actual',       label: 'TOV Rate Act',  title: 'Actual TOV Rate',      fmt: v => v?.toFixed(4) ?? '-' },
    { key: 'actual_usage',          label: 'USG Act',        title: 'Actual Usage Rate',   fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'passes_made_pg',        label: 'Passes/G',       title: 'Passes Made per Game',        fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'time_of_poss_per_touch',label: 'ToP/Touch',      title: 'Time of Possession per Touch', fmt: v => v?.toFixed(2) ?? '-' },
    { key: 'opp_stl_rate',          label: 'Opp STL Rate',   title: 'Opponent Steal Rate',         fmt: v => v?.toFixed(4) ?? '-' },
    { key: 'pace',                   label: 'Pace',           title: 'Team Pace',                  fmt: v => v?.toFixed(1) ?? '-' },
  ],
  '3PM': [
    { key: 'projected_min',        label: 'Proj MIN',       title: 'Projected Minutes/G',     editable: 'minutes_per_game', fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'actual_min',           label: 'Act MIN',        title: 'Actual Minutes/G',        fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'three_pa_rate_proj',   label: '3PA Rate Proj',  title: 'Projected 3PA per Minute', editable: 'three_pa_rate', fmt: v => v?.toFixed(3) ?? '-' },
    { key: 'three_pa_rate_actual', label: '3PA Rate Act',   title: 'Actual 3PA per Minute',   fmt: v => v?.toFixed(3) ?? '-' },
    { key: 'three_pct_proj',       label: '3P% Proj',       title: 'Projected 3PT%', editable: 'three_p_pct', fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'three_pct_actual',     label: '3P% Act',        title: 'Actual 3PT%',    fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'catch_shoot_fga_pg',   label: 'C&S FGA/G',      title: 'Catch & Shoot FGA per Game', fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'pull_up_fga_pg',       label: 'PullUp/G',       title: 'Pull-Up FGA per Game',        fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'opp_3pt_def_rating',   label: 'Opp 3DRtg',      title: 'Opponent 3PT Defense Rating', fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'pace',                  label: 'Pace',           title: 'Team Pace',                  fmt: v => v?.toFixed(1) ?? '-' },
  ],
  'FG%': [
    { key: 'fga_proj',           label: 'Proj FGA',  title: 'Projected FGA/G', editable: 'two_pa_rate', fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'fga_actual',         label: 'Act FGA',   title: 'Actual FGA/G',    fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'fg_pct_proj',        label: 'Proj FG%',  title: 'Projected FG%',   fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'fg_pct_actual',      label: 'Act FG%',   title: 'Actual FG%',      fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'drive_fg_pct',       label: 'Drive FG%', title: 'Drive FG%',         fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'catch_shoot_fg_pct', label: 'C&S FG%',   title: 'Catch & Shoot FG%', fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'pull_up_fg_pct',     label: 'PullUp FG%',title: 'Pull-Up FG%',        fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'opp_fg_pct_allowed', label: 'Opp FG%',   title: 'Opponent FG% Allowed', fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
  ],
  'FT%': [
    { key: 'fta_proj',       label: 'Proj FTA',   title: 'Projected FTA/G', editable: 'fta_rate', fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'fta_actual',     label: 'Act FTA',    title: 'Actual FTA/G',    fmt: v => v?.toFixed(1) ?? '-' },
    { key: 'ft_pct_proj',    label: 'Proj FT%',   title: 'Projected FT%', editable: 'ft_pct', fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'ft_pct_actual',  label: 'Act FT%',    title: 'Actual FT%',    fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'fta_rate',       label: 'FTA Rate',   title: 'FTA per Minute', fmt: v => v?.toFixed(3) ?? '-' },
    { key: 'career_ft_pct',  label: 'Career FT%', title: 'Career FT% Average', fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'ft_pct_2yr_ago', label: 'FT% -2yr',   title: 'FT% Two Seasons Ago',  fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'ft_pct_1yr_ago', label: 'FT% -1yr',   title: 'FT% Last Season',      fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
    { key: 'opp_foul_rate',  label: 'Opp Foul%',  title: 'Opponent Foul Rate',   fmt: v => v != null ? (v*100).toFixed(1)+'%' : '-' },
  ],
}

function authFetch(url, opts = {}) {
  const token = localStorage.getItem('nba_token')
  return fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
}

function fmtPct(v) {
  if (v == null) return '-'
  const s = v.toFixed(1)
  return v > 0 ? `+${s}%` : `${s}%`
}

function deltaColor(pct) {
  if (pct == null) return COLORS.muted
  if (pct > 5) return COLORS.red    // over-projected
  if (pct < -5) return COLORS.green // under-projected
  return COLORS.muted
}

export default function ProjectionAuditPage() {
  const [stat,          setStat]          = useState('PTS')
  const [period,        setPeriod]        = useState('last_14')
  const [threshold,     setThreshold]     = useState(20)
  const [normalisation, setNormalisation] = useState('player_historical')
  const [rows,          setRows]          = useState([])
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState(null)
  const [saving,        setSaving]        = useState({})
  const [editLog,       setEditLog]       = useState([])
  const [showLog,       setShowLog]       = useState(false)
  const [sortKey,       setSortKey]       = useState('delta_pct')
  const [sortDir,       setSortDir]       = useState(-1)
  const [localEdits,    setLocalEdits]    = useState({})  // { player_id: { field: value } }
  const [season,        setSeason]        = useState('2025-26')

  // Load audit data whenever stat/period/threshold changes
  useEffect(() => {
    setLoading(true)
    setError(null)
    setLocalEdits({})
    const params = new URLSearchParams({ stat, period, threshold })
    authFetch(`/api/admin/projections/audit?${params}`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
      .then(data => {
        setRows(data.players || [])
        setSeason(data.season || '2025-26')
        setLoading(false)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [stat, period, threshold])

  function loadEditLog() {
    authFetch('/api/admin/projections/edit-log?limit=100')
      .then(r => r.json())
      .then(data => setEditLog(Array.isArray(data) ? data : []))
      .catch(() => {})
  }

  function toggleLog() {
    if (!showLog) loadEditLog()
    setShowLog(s => !s)
  }

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d * -1)
    else { setSortKey(key); setSortDir(-1) }
  }

  // Get local input value for a player field, falling back to server value
  function getInputVal(playerId, field, serverInputs) {
    if (localEdits[playerId]?.[field] !== undefined) return localEdits[playerId][field]
    return serverInputs?.[field]
  }

  function setLocalEdit(playerId, field, value) {
    setLocalEdits(prev => ({
      ...prev,
      [playerId]: { ...(prev[playerId] || {}), [field]: value },
    }))
  }

  async function saveField(playerId, field, value, serverInputs) {
    const key = `${playerId}_${field}`
    const oldVal = serverInputs?.[field]
    setSaving(s => ({ ...s, [key]: true }))
    try {
      const res = await authFetch(`/api/admin/projections/player/${playerId}`, {
        method: 'PATCH',
        body: JSON.stringify({ season, source_view: 'audit', [field]: parseFloat(value) }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      // Update the row in state with new server inputs
      setRows(prev => prev.map(r => {
        if (r.player_id !== playerId) return r
        return { ...r, inputs: data.updated || r.inputs }
      }))
      // Clear local edit since server accepted it
      setLocalEdits(prev => {
        const next = { ...prev }
        if (next[playerId]) {
          const { [field]: _, ...rest } = next[playerId]
          next[playerId] = rest
        }
        return next
      })
    } catch {
      // Revert on error
      setLocalEdits(prev => ({
        ...prev,
        [playerId]: { ...(prev[playerId] || {}), [field]: oldVal },
      }))
    } finally {
      setSaving(s => { const n = { ...s }; delete n[key]; return n })
    }
  }

  // Sort rows
  const sorted = [...rows]
    .filter(r => Math.abs(r.delta_pct ?? 0) >= threshold)
    .sort((a, b) => {
      let av, bv
      if (sortKey === 'delta_pct') { av = a.delta_pct; bv = b.delta_pct }
      else if (sortKey === 'player') { av = a.full_name; bv = b.full_name }
      else if (sortKey === 'projected') { av = a.projected_stat; bv = b.projected_stat }
      else if (sortKey === 'actual') { av = a.actual_stat; bv = b.actual_stat }
      else { av = a[sortKey]; bv = b[sortKey] }
      if (typeof av === 'string') return sortDir * av.localeCompare(bv ?? '')
      return sortDir * ((bv ?? -Infinity) - (av ?? -Infinity))
    })

  const diagFields = DIAG_FIELDS[stat] || []
  const impliedKey = normalisation === 'player_historical'
    ? 'implied_stat_player_historical'
    : 'implied_stat_league_average'
  const impliedLabel = `Implied ${stat}`

  function SortTh({ sortK, children, title: ttl, style = {} }) {
    const active = sortKey === sortK
    return (
      <th
        title={ttl}
        onClick={() => handleSort(sortK)}
        style={{
          cursor: 'pointer', padding: '8px 10px', whiteSpace: 'nowrap',
          color: active ? COLORS.text : COLORS.muted,
          borderBottom: `2px solid ${active ? COLORS.blue : COLORS.border}`,
          fontSize: 11, fontWeight: 600, textAlign: 'right',
          background: COLORS.card, userSelect: 'none', ...style,
        }}
      >
        {children}{active ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
      </th>
    )
  }

  function EditableCell({ playerId, field, displayValue, serverInputs, warn }) {
    const key = `${playerId}_${field}`
    const isSaving = saving[key]
    const localVal = localEdits[playerId]?.[field]
    const [editVal, setEditVal] = useState(localVal ?? serverInputs?.[field] ?? '')
    const inputRef = useRef(null)

    return (
      <td style={{ padding: '6px 8px', textAlign: 'right' }}>
        <input
          ref={inputRef}
          type="number"
          step="any"
          value={editVal}
          onChange={e => {
            setEditVal(e.target.value)
            setLocalEdit(playerId, field, e.target.value)
          }}
          onBlur={() => {
            if (editVal !== '' && editVal !== String(serverInputs?.[field])) {
              saveField(playerId, field, editVal, serverInputs)
            }
          }}
          style={{
            width: 64, background: warn ? 'rgba(245,158,11,0.1)' : COLORS.inputBg,
            border: `1px solid ${warn ? COLORS.amber : isSaving ? COLORS.blue : COLORS.border}`,
            borderRadius: 4, color: COLORS.text, padding: '2px 6px',
            fontSize: 12, textAlign: 'right',
          }}
        />
        {isSaving && <span style={{ marginLeft: 4, color: COLORS.blue, fontSize: 10 }}>●</span>}
      </td>
    )
  }

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', color: COLORS.text, padding: '20px 16px', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Projection Audit</h2>
        <button
          onClick={toggleLog}
          style={{
            background: showLog ? COLORS.blue : COLORS.card,
            border: `1px solid ${COLORS.border}`, borderRadius: 6,
            color: COLORS.text, padding: '6px 14px', cursor: 'pointer', fontSize: 13,
          }}
        >
          Edit Log
        </button>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        {/* Stat */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: COLORS.muted }}>Stat</span>
          <select value={stat} onChange={e => setStat(e.target.value)}
            style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, padding: '5px 10px', fontSize: 13 }}>
            {STATS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        {/* Period */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: COLORS.muted }}>Period</span>
          <select value={period} onChange={e => setPeriod(e.target.value)}
            style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, padding: '5px 10px', fontSize: 13 }}>
            {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>

        {/* Threshold */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: COLORS.muted }}>Threshold ±%</span>
          <input
            type="number" min={0} max={100} value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
            style={{ width: 60, background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, padding: '5px 8px', fontSize: 13, textAlign: 'center' }}
          />
        </label>

        {/* Normalisation */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: COLORS.muted }}>Implied</span>
          <select value={normalisation} onChange={e => setNormalisation(e.target.value)}
            style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, padding: '5px 10px', fontSize: 13 }}>
            <option value="player_historical">Player Historical</option>
            <option value="league_average">League Average</option>
          </select>
        </label>

        <span style={{ color: COLORS.muted, fontSize: 12, marginLeft: 4 }}>
          {sorted.length} player{sorted.length !== 1 ? 's' : ''} shown
        </span>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: `1px solid ${COLORS.red}`, borderRadius: 6, padding: '8px 12px', marginBottom: 12, color: COLORS.red, fontSize: 13 }}>
          Error loading data: {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: COLORS.muted }}>Loading…</div>
      )}

      {/* Table */}
      {!loading && (
        <div style={{ overflowX: 'auto', borderRadius: 8, border: `1px solid ${COLORS.border}` }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead>
              <tr style={{ background: COLORS.card }}>
                {/* Sticky columns */}
                <SortTh sortK="player" style={{ position: 'sticky', left: 0, zIndex: 2, textAlign: 'left', minWidth: 160 }}>Player</SortTh>
                <SortTh sortK="projected" title={`Projected ${stat}`} style={{ position: 'sticky', left: 160, zIndex: 2, minWidth: 72 }}>Proj</SortTh>
                <SortTh sortK="actual"    title={`Actual ${stat}`}    style={{ position: 'sticky', left: 232, zIndex: 2, minWidth: 72 }}>Actual</SortTh>
                <SortTh sortK="delta_pct" title="Delta %"              style={{ position: 'sticky', left: 304, zIndex: 2, minWidth: 72 }}>Δ%</SortTh>
                {/* Diagnostic columns */}
                {diagFields.map(f => (
                  <th key={f.key} title={f.title}
                    style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: COLORS.muted, borderBottom: `2px solid ${COLORS.border}`, fontSize: 11, fontWeight: 600, textAlign: 'right', background: COLORS.card, minWidth: f.editable ? 80 : 72 }}>
                    {f.label}{f.editable ? ' ✎' : ''}
                  </th>
                ))}
                {/* Implied column */}
                <th title={`${impliedLabel} — ${normalisation === 'player_historical' ? 'using player full-season rate × period minutes' : 'using league average rate × period minutes'}`}
                  style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: COLORS.amber, borderBottom: `2px solid ${COLORS.border}`, fontSize: 11, fontWeight: 600, textAlign: 'right', background: COLORS.card, minWidth: 80 }}>
                  {impliedLabel}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, idx) => {
                const d = row.diagnostic || {}
                const isOdd = idx % 2 === 0
                const rowBg = isOdd ? COLORS.bg : 'rgba(30,41,59,0.5)'
                const deltaPct = row.delta_pct
                const dColor = deltaColor(deltaPct)

                return (
                  <tr key={row.player_id} style={{ background: rowBg }}>
                    {/* Player — sticky */}
                    <td style={{
                      position: 'sticky', left: 0, zIndex: 1,
                      background: rowBg, padding: '8px 10px', borderBottom: `1px solid ${COLORS.border}`,
                    }}>
                      <div style={{ fontWeight: 600, color: COLORS.text, fontSize: 12 }}>{row.full_name}</div>
                      <div style={{ fontSize: 10, color: COLORS.muted }}>{row.team}</div>
                    </td>

                    {/* Proj — sticky */}
                    <td style={{
                      position: 'sticky', left: 160, zIndex: 1,
                      background: rowBg, padding: '8px 10px', textAlign: 'right',
                      borderBottom: `1px solid ${COLORS.border}`, color: COLORS.text,
                    }}>
                      {row.projected_stat?.toFixed(1) ?? '-'}
                    </td>

                    {/* Actual — sticky */}
                    <td style={{
                      position: 'sticky', left: 232, zIndex: 1,
                      background: rowBg, padding: '8px 10px', textAlign: 'right',
                      borderBottom: `1px solid ${COLORS.border}`, color: COLORS.text,
                    }}>
                      {row.actual_stat?.toFixed(1) ?? '-'}
                    </td>

                    {/* Delta % — sticky */}
                    <td style={{
                      position: 'sticky', left: 304, zIndex: 1,
                      background: rowBg, padding: '8px 10px', textAlign: 'right',
                      borderBottom: `1px solid ${COLORS.border}`, color: dColor, fontWeight: 600,
                    }}>
                      {fmtPct(deltaPct)}
                    </td>

                    {/* Diagnostic columns */}
                    {diagFields.map(f => {
                      const val = d[f.key]
                      const cellBg = `${rowBg}`
                      if (f.editable) {
                        const serverInputs = row.inputs || {}
                        const inputVal = getInputVal(row.player_id, f.editable, serverInputs)
                        const warn = f.editable === 'minutes_per_game' && parseFloat(inputVal) > 36
                        return (
                          <td key={f.key} style={{ padding: '4px 6px', textAlign: 'right', borderBottom: `1px solid ${COLORS.border}`, background: rowBg }}>
                            <InputCell
                              key={`${row.player_id}_${f.editable}`}
                              playerId={row.player_id}
                              field={f.editable}
                              serverValue={serverInputs[f.editable]}
                              displayFmt={f.fmt}
                              warn={warn}
                              isSaving={!!saving[`${row.player_id}_${f.editable}`]}
                              onSave={(v) => saveField(row.player_id, f.editable, v, serverInputs)}
                            />
                          </td>
                        )
                      }
                      return (
                        <td key={f.key} style={{
                          padding: '8px 10px', textAlign: 'right',
                          borderBottom: `1px solid ${COLORS.border}`,
                          color: val != null ? COLORS.text : COLORS.muted,
                        }}>
                          {f.fmt(val)}
                        </td>
                      )
                    })}

                    {/* Implied stat */}
                    <td style={{
                      padding: '8px 10px', textAlign: 'right',
                      borderBottom: `1px solid ${COLORS.border}`,
                      color: COLORS.amber,
                    }}>
                      {d[impliedKey]?.toFixed(1) ?? '-'}
                    </td>
                  </tr>
                )
              })}

              {!loading && sorted.length === 0 && (
                <tr>
                  <td colSpan={4 + diagFields.length + 1}
                    style={{ textAlign: 'center', padding: 32, color: COLORS.muted }}>
                    No players exceed ±{threshold}% threshold for {stat} over {PERIODS.find(p => p.value === period)?.label ?? period}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Log Panel */}
      {showLog && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 400,
          background: COLORS.card, borderLeft: `1px solid ${COLORS.border}`,
          zIndex: 100, display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 20px rgba(0,0,0,0.4)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${COLORS.border}` }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Edit Log</span>
            <button onClick={() => setShowLog(false)}
              style={{ background: 'none', border: 'none', color: COLORS.text, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>
              ✕
            </button>
          </div>
          <div style={{ overflowY: 'auto', flex: 1, padding: 12 }}>
            {editLog.length === 0 && (
              <div style={{ color: COLORS.muted, textAlign: 'center', padding: 24, fontSize: 13 }}>No edits yet.</div>
            )}
            {editLog.map(e => (
              <div key={e.id} style={{
                borderBottom: `1px solid ${COLORS.border}`, padding: '10px 4px', fontSize: 12,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontWeight: 600, color: COLORS.text }}>{e.player_name || e.player_id}</span>
                  <span style={{ color: COLORS.muted, fontSize: 10 }}>{e.source_view}</span>
                </div>
                <div style={{ color: COLORS.muted, marginBottom: 2 }}>
                  <span style={{ color: COLORS.text }}>{e.field_edited}</span>:&nbsp;
                  <span style={{ color: COLORS.red }}>{e.old_value ?? '—'}</span>
                  {' → '}
                  <span style={{ color: COLORS.green }}>{e.new_value ?? '—'}</span>
                </div>
                <div style={{ color: COLORS.muted, fontSize: 10 }}>
                  {e.edited_by} · {e.edited_at ? new Date(e.edited_at).toLocaleString() : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Separate component to manage its own local input state cleanly
function InputCell({ playerId, field, serverValue, displayFmt, warn, isSaving, onSave }) {
  const [val, setVal] = useState(serverValue ?? '')

  // Sync if server value changes (e.g. after a save)
  useEffect(() => {
    setVal(serverValue ?? '')
  }, [serverValue])

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3 }}>
      <input
        type="number"
        step="any"
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={() => {
          const parsed = parseFloat(val)
          if (!isNaN(parsed) && parsed !== serverValue) {
            onSave(parsed)
          }
        }}
        title={warn ? 'Minutes > 36 — check team calibration view for team total' : undefined}
        style={{
          width: 70, background: warn ? 'rgba(245,158,11,0.08)' : '#0f172a',
          border: `1px solid ${warn ? '#f59e0b' : isSaving ? '#3b82f6' : '#334155'}`,
          borderRadius: 4, color: '#e2e8f0', padding: '3px 6px',
          fontSize: 12, textAlign: 'right',
        }}
      />
      {isSaving && <span style={{ color: '#3b82f6', fontSize: 10, minWidth: 8 }}>●</span>}
    </div>
  )
}
