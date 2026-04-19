import { useState, useRef, useEffect, useCallback, Fragment } from 'react'
import { Bar, Line, Radar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
} from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import './App.css'

ChartJS.register(CategoryScale, LinearScale, RadialLinearScale, BarElement, LineElement, PointElement, Tooltip, Legend, ChartDataLabels)

const STAT_OPTIONS = [
  { value: 'pts', label: 'Points' },
  { value: 'reb', label: 'Rebounds' },
  { value: 'ast', label: 'Assists' },
  { value: 'stl', label: 'Steals' },
  { value: 'blk', label: 'Blocks' },
  { value: 'tov', label: 'Turnovers' },
]

const PROJ_STAT_OPTIONS = [
  { value: 'z_sum',  label: 'Sum of Z scores' },
  { value: 'pts',    label: 'Points' },
  { value: 'reb',    label: 'Rebounds' },
  { value: 'ast',    label: 'Assists' },
  { value: 'stl',    label: 'Steals' },
  { value: 'blk',    label: 'Blocks' },
  { value: 'fg3m',   label: '3-Pointers' },
  { value: 'fg_pct', label: 'FG%' },
  { value: 'ft_pct', label: 'FT%' },
]

const MA_STAT_OPTIONS = [
  { value: 'z_sum',  label: 'Sum of Z scores' },
  { value: 'pts',    label: 'Points' },
  { value: 'reb',    label: 'Rebounds' },
  { value: 'ast',    label: 'Assists' },
  { value: 'stl',    label: 'Steals' },
  { value: 'blk',    label: 'Blocks' },
  { value: 'tov',    label: 'Turnovers' },
  { value: 'fg3m',   label: '3-Pointers' },
  { value: 'min',    label: 'Minutes' },
  { value: 'fg_pct', label: 'FG%' },
  { value: 'ft_pct', label: 'FT%' },
]

const Z_SUM_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'tov']
const Z_SUM_INVERT = new Set(['tov'])

function computeGameZSums(games) {
  const stats = {}
  for (const key of Z_SUM_KEYS) {
    const vals = games.map(g => g[key]).filter(v => v !== null && v !== undefined)
    if (!vals.length) { stats[key] = { mean: 0, std: 1 }; continue }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    const std  = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1
    stats[key] = { mean, std }
  }
  return games.map(g => {
    let sum = 0
    for (const key of Z_SUM_KEYS) {
      const val = g[key]
      if (val === null || val === undefined) continue
      const z = (val - stats[key].mean) / stats[key].std
      sum += Z_SUM_INVERT.has(key) ? -z : z
    }
    return +sum.toFixed(2)
  })
}

const MA_WINDOW_OPTIONS = [
  { value: 5,  label: 'Week (~5 games)' },
  { value: 10, label: 'Fortnight (~10 games)' },
  { value: 20, label: 'Month (~20 games)' },
  { value: 41, label: 'Quarter season (~41 games)' },
]

const AGING_COLS = [
  { key: 'pts',    label: 'PTS',  reverse: false },
  { key: 'reb',    label: 'REB',  reverse: false },
  { key: 'ast',    label: 'AST',  reverse: false },
  { key: 'stl',    label: 'STL',  reverse: false },
  { key: 'blk',    label: 'BLK',  reverse: false },
  { key: 'tov',    label: 'TOV',  reverse: true  },
  { key: 'fg3m',   label: '3PM',  reverse: false },
  { key: 'fg_pct', label: 'FG%',  reverse: false },
]

const RADAR_STATS = [
  { key: 'pts',    label: 'PTS', invert: false },
  { key: 'reb',    label: 'REB', invert: false },
  { key: 'ast',    label: 'AST', invert: false },
  { key: 'stl',    label: 'STL', invert: false },
  { key: 'blk',    label: 'BLK', invert: false },
  { key: 'tov',    label: 'TOV', invert: true  },
  { key: 'fg_pct', label: 'FG%', invert: false },
  { key: 'fg3m',   label: '3PM', invert: false },
]

function zToRadar(z, invert) {
  const v = invert ? -(z || 0) : (z || 0)
  return Math.min(100, Math.max(0, 50 + v * 15))
}

function heatColor(val, min, max, reverse) {
  if (val === null || val === undefined || max === min) return {}
  const t = (val - min) / (max - min)
  const intensity = reverse ? 1 - t : t
  return { backgroundColor: `rgba(77,255,180,${(intensity * 0.55).toFixed(2)})` }
}

function rollingAverage(games, key, window) {
  return games.map((g, i) => {
    const slice = games.slice(Math.max(0, i - window + 1), i + 1)
    const vals = slice.map(r => r[key]).filter(v => v !== null && v !== undefined)
    if (!vals.length) return null
    return vals.reduce((a, b) => a + b, 0) / vals.length
  })
}

function nextSeasonLabel(season) {
  if (!season) return 'Next season'
  const yr = parseInt(season.split('-')[0]) + 1
  return `${yr}-${String(yr + 1).slice(2)} ▸`
}

const TEAM_ABBR = {
  'ATLANTA HAWKS': 'ATL', 'BOSTON CELTICS': 'BOS', 'BROOKLYN NETS': 'BKN',
  'CHARLOTTE HORNETS': 'CHA', 'CHICAGO BULLS': 'CHI', 'CLEVELAND CAVALIERS': 'CLE',
  'DALLAS MAVERICKS': 'DAL', 'DENVER NUGGETS': 'DEN', 'DETROIT PISTONS': 'DET',
  'GOLDEN STATE WARRIORS': 'GSW', 'HOUSTON ROCKETS': 'HOU', 'INDIANA PACERS': 'IND',
  'LOS ANGELES CLIPPERS': 'LAC', 'LOS ANGELES LAKERS': 'LAL', 'MEMPHIS GRIZZLIES': 'MEM',
  'MIAMI HEAT': 'MIA', 'MILWAUKEE BUCKS': 'MIL', 'MINNESOTA TIMBERWOLVES': 'MIN',
  'NEW ORLEANS PELICANS': 'NOP', 'NEW YORK KNICKS': 'NYK', 'OKLAHOMA CITY THUNDER': 'OKC',
  'ORLANDO MAGIC': 'ORL', 'PHILADELPHIA 76ERS': 'PHI', 'PHOENIX SUNS': 'PHX',
  'PORTLAND TRAIL BLAZERS': 'POR', 'SACRAMENTO KINGS': 'SAC', 'SAN ANTONIO SPURS': 'SAS',
  'TORONTO RAPTORS': 'TOR', 'UTAH JAZZ': 'UTA', 'WASHINGTON WIZARDS': 'WAS',
}
function teamAbbr(name) {
  if (!name) return '—'
  return TEAM_ABBR[name.toUpperCase()] ?? name
}

const STAT_LABELS_SHORT = {
  pts: 'Pts/g', reb: 'Rebounds/g', ast: 'Ast/g',
  stl: 'Stl/g', blk: 'Blk/g', tov: 'Tov/g',
}

const CATEGORY_COLORS = {
  role:     '#7c8cff',
  skill:    '#4dffb4',
  opponent: '#ffb84d',
  team:     '#ff7cf5',
}

const BASELINE_COLOR = 'rgba(255,255,255,0.07)'
const TOTAL_COLOR    = '#555555'

function getBarColor(category) {
  return CATEGORY_COLORS[category] ?? '#888'
}

const CAT_ORDER = { skill: 0, role: 1, team: 2, opponent: 3 }

function buildWaterfall(result) {
  const { period_a, period_b } = result
  const drivers = [...result.drivers].sort(
    (a, b) => (CAT_ORDER[a.category] ?? 99) - (CAT_ORDER[b.category] ?? 99)
  )
  const labels       = ['Baseline', ...drivers.map(d => LABEL_DISPLAY[d.label] ?? d.label), 'Total']
  const floatData    = []
  const barData      = []
  const colors       = []
  const tipLabels    = []
  const displayLabels = []

  floatData.push(0)
  barData.push(period_a.value)
  colors.push(BASELINE_COLOR)
  tipLabels.push(`Baseline: ${period_a.value.toFixed(2)}`)
  displayLabels.push(period_a.value.toFixed(1))

  let running = period_a.value
  for (const d of drivers) {
    const c = d.contribution
    floatData.push(c >= 0 ? running : running + c)
    barData.push(Math.abs(c))
    colors.push(getBarColor(d.category))
    tipLabels.push(`${d.label}: ${c >= 0 ? '+' : ''}${c.toFixed(3)}`)
    displayLabels.push(`${c >= 0 ? '+' : ''}${c.toFixed(2)}`)
    running += c
  }

  floatData.push(0)
  barData.push(period_b.value)
  colors.push(TOTAL_COLOR)
  tipLabels.push(`Total: ${period_b.value.toFixed(2)}`)
  displayLabels.push(period_b.value.toFixed(1))

  return { labels, floatData, barData, colors, tipLabels, displayLabels }
}

function generateInsights(result, statLabel) {
  const pct       = ((result.delta / result.period_a.value) * 100)
  const skillSum  = result.drivers.filter(d => d.category === 'skill').reduce((s, d) => s + d.contribution, 0)
  const luckSum   = result.drivers.filter(d => d.category === 'opponent' || d.category === 'team').reduce((s, d) => s + d.contribution, 0)
  const roleSum   = result.drivers.filter(d => d.category === 'role').reduce((s, d) => s + d.contribution, 0)
  const sorted    = [...result.drivers].sort((a, b) => b.contribution - a.contribution)
  const biggestPos = sorted.find(d => d.contribution > 0)
  const biggestNeg = [...sorted].reverse().find(d => d.contribution < 0)

  const fmt = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`
  const ins = []

  ins.push(`${statLabel} ${result.delta >= 0 ? 'improved' : 'declined'} by ${Math.abs(result.delta).toFixed(2)} — a ${Math.abs(pct).toFixed(1)}% ${result.delta >= 0 ? 'positive' : 'negative'} move.`)

  if (Math.abs(skillSum) > 0.01) {
    if (skillSum > 0)
      ins.push(`Genuine skill rates are improving (${fmt(skillSum)}), suggesting a real performance gain.`)
    else
      ins.push(`Skill rates have declined (${fmt(skillSum)}), indicating a genuine performance drop.`)
  }

  if (Math.abs(luckSum) > 0.01)
    ins.push(`External/luck factors account for ${fmt(luckSum)} — consider whether the schedule context will persist.`)

  if (Math.abs(roleSum) > 0.01)
    ins.push(`Role/opportunity changes contributed ${fmt(roleSum)}, primarily through ${roleSum > 0 ? 'increased' : 'decreased'} minutes or usage.`)

  if (biggestPos)
    ins.push(`Biggest positive driver: "${biggestPos.label}" (${fmt(biggestPos.contribution)}).`)

  if (biggestNeg)
    ins.push(`Biggest drag: "${biggestNeg.label}" (${fmt(biggestNeg.contribution)}).`)

  return ins
}

const LEGEND_ITEMS = [
  { label: 'Baseline',     color: 'rgba(255,255,255,0.3)' },
  { label: 'Rate change',  color: CATEGORY_COLORS.skill },
  { label: 'Role',         color: CATEGORY_COLORS.role },
  { label: 'Pace',         color: CATEGORY_COLORS.team },
  { label: 'Comparison',   color: TOTAL_COLOR },
]

const CATEGORY_DISPLAY = { skill: 'Rate change', role: 'Role', team: 'Pace', opponent: 'Context' }
const LABEL_DISPLAY = { 'Pace (poss/min)': 'Pace' }

const CATEGORY_ORDER = CAT_ORDER

// Zones in display order
const ZONE_ORDER = ['restricted_area', 'paint_non_ra', 'mid_range', 'corner_3', 'above_break_3']
const ZONE_LABELS = {
  restricted_area: 'Restricted',
  paint_non_ra:    'Paint',
  mid_range:       'Mid-range',
  corner_3:        'Corner 3',
  above_break_3:   'Above break 3',
}


// ── Half-court SVG ──────────────────────────────────────────────────────────
// Court units: 500 wide × 470 tall (NBA half-court ~47ft × 50ft, scaled ×10)
// Zones are approximate but spatially accurate enough to read.

function CourtDiagram({ zones, period }) {
  // zones: array of { zone, fg_pct, fga, net } — net = diet+efficiency contribution
  const byZone = Object.fromEntries((zones || []).map(z => [z.zone, z]))
  // total FGA for frequency calculation
  const totalFga = (zones || []).reduce((s, z) => s + (z.fga || 0), 0)

  function zoneColor(zoneKey) {
    const z = byZone[zoneKey]
    if (!z) return '#1e2235'
    // colour by net contribution — green positive, red negative, neutral if tiny
    const net = z.net
    const intensity = Math.min(Math.abs(net) / 0.03, 1)
    if (net > 0.002)  return `rgba(77,255,180,${0.15 + intensity * 0.4})`
    if (net < -0.002) return `rgba(255,107,107,${0.15 + intensity * 0.4})`
    return '#1e2235'
  }

  function fgLabel(zoneKey) {
    const z = byZone[zoneKey]
    if (!z || z.fga === 0) return ''
    return `${(z.fg_pct * 100).toFixed(0)}FG%`
  }

  function freqLabel(zoneKey) {
    const z = byZone[zoneKey]
    if (!z || z.fga === 0 || totalFga === 0) return ''
    const freq = z.freq !== undefined ? z.freq : (z.fga / totalFga)
    return `${(freq * 100).toFixed(0)}% of FGA`
  }

  const W = 500, H = 350
  const stroke = '#2a3050'
  const text = '#9aa0b8'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="court-svg">
      {/* Court outline */}
      <rect x={0} y={0} width={W} height={H} fill="#141828" rx={4} />

      {/* ── Zone fills (layered back-to-front) ── */}
      {/* above_break_3: full court background */}
      <rect x={0} y={0} width={W} height={H} fill={zoneColor('above_break_3')} />
      {/* mid_range: full inside-3pt-line area (paint drawn on top) */}
      <path d={`M 60,0 L 60,140 A 237,237 0 0,0 440,140 L 440,0 Z`} fill={zoneColor('mid_range')} />
      {/* corner_3: left and right strips */}
      <rect x={0}   y={0} width={60}  height={140} fill={zoneColor('corner_3')} />
      <rect x={440} y={0} width={60}  height={140} fill={zoneColor('corner_3')} />
      {/* paint_non_ra: covers paint area of mid_range */}
      <rect x={160} y={0} width={180} height={190} fill={zoneColor('paint_non_ra')} />
      {/* restricted_area: D-shape matching the RA arc */}
      <path d={`M 190,0 L 190,80 A 60,60 0 0,0 310,80 L 310,0 Z`} fill={zoneColor('restricted_area')} />

      {/* ── Court lines ── */}
      {/* Baseline */}
      <line x1={0} y1={0} x2={W} y2={0} stroke={stroke} strokeWidth={2} />
      {/* Sidelines */}
      <line x1={0} y1={0} x2={0} y2={H} stroke={stroke} strokeWidth={2} />
      <line x1={W} y1={0} x2={W} y2={H} stroke={stroke} strokeWidth={2} />
      {/* Half court */}
      <line x1={0} y1={H} x2={W} y2={H} stroke={stroke} strokeWidth={1} strokeDasharray="4 4" />

      {/* Paint */}
      <rect x={160} y={0} width={180} height={190} fill="none" stroke={stroke} strokeWidth={1.5} />
      {/* Paint lane lines */}
      <line x1={160} y1={0}   x2={160} y2={190} stroke={stroke} strokeWidth={1} />
      <line x1={340} y1={0}   x2={340} y2={190} stroke={stroke} strokeWidth={1} />
      {/* Free throw circle */}
      <circle cx={250} cy={190} r={60} fill="none" stroke={stroke} strokeWidth={1} strokeDasharray="4 4" />
      {/* Free throw line */}
      <line x1={160} y1={190} x2={340} y2={190} stroke={stroke} strokeWidth={1.5} />

      {/* Restricted area arc */}
      <path d={`M 190,0 L 190,80 A 60,60 0 0,0 310,80 L 310,0`} fill="none" stroke={stroke} strokeWidth={1.5} />

      {/* 3pt line */}
      <line x1={60} y1={0}   x2={60}  y2={140} stroke={stroke} strokeWidth={1.5} />
      <line x1={440} y1={0}  x2={440} y2={140} stroke={stroke} strokeWidth={1.5} />
      <path d={`M 60,140 A 237,237 0 0,0 440,140`} fill="none" stroke={stroke} strokeWidth={1.5} />

      {/* Backboard */}
      <line x1={210} y1={0} x2={290} y2={0} stroke="#4a5070" strokeWidth={4} />
      {/* Rim */}
      <circle cx={250} cy={20} r={15} fill="none" stroke="#4a5070" strokeWidth={2} />

      {/* ── Labels ── */}
      {/* Restricted area */}
      <text x={250} y={50}  textAnchor="middle" fill={text} fontSize={11} fontFamily="DM Mono,monospace" stroke="#141828" strokeWidth={3} paintOrder="stroke fill">{fgLabel('restricted_area')}</text>
      <text x={250} y={65}  textAnchor="middle" fill={text} fontSize={9}  fontFamily="DM Mono,monospace" opacity={0.8} stroke="#141828" strokeWidth={2} paintOrder="stroke fill">{freqLabel('restricted_area')}</text>

      {/* Paint */}
      <text x={250} y={145} textAnchor="middle" fill={text} fontSize={11} fontFamily="DM Mono,monospace" stroke="#141828" strokeWidth={3} paintOrder="stroke fill">{fgLabel('paint_non_ra')}</text>
      <text x={250} y={160} textAnchor="middle" fill={text} fontSize={9}  fontFamily="DM Mono,monospace" opacity={0.8} stroke="#141828" strokeWidth={2} paintOrder="stroke fill">{freqLabel('paint_non_ra')}</text>

      {/* Mid-range — label in upper elbow area, well inside arc */}
      <text x={110} y={80} textAnchor="middle" fill={text} fontSize={11} fontFamily="DM Mono,monospace" stroke="#141828" strokeWidth={3} paintOrder="stroke fill">{fgLabel('mid_range')}</text>
      <text x={110} y={95} textAnchor="middle" fill={text} fontSize={9}  fontFamily="DM Mono,monospace" opacity={0.8} stroke="#141828" strokeWidth={2} paintOrder="stroke fill">{freqLabel('mid_range')}</text>

      {/* Corner 3 left */}
      <text x={30}  y={80}  textAnchor="middle" fill={text} fontSize={11} fontFamily="DM Mono,monospace" stroke="#141828" strokeWidth={3} paintOrder="stroke fill">{fgLabel('corner_3')}</text>
      <text x={30}  y={95}  textAnchor="middle" fill={text} fontSize={9}  fontFamily="DM Mono,monospace" opacity={0.8} stroke="#141828" strokeWidth={2} paintOrder="stroke fill">{freqLabel('corner_3')}</text>

      {/* Above break 3 */}
      <text x={250} y={295} textAnchor="middle" fill={text} fontSize={11} fontFamily="DM Mono,monospace" stroke="#141828" strokeWidth={3} paintOrder="stroke fill">{fgLabel('above_break_3')}</text>
      <text x={250} y={310} textAnchor="middle" fill={text} fontSize={9}  fontFamily="DM Mono,monospace" opacity={0.8} stroke="#141828" strokeWidth={2} paintOrder="stroke fill">{freqLabel('above_break_3')}</text>

      {/* Period label */}
      <text x={250} y={340} textAnchor="middle" fill="#555" fontSize={10} fontFamily="DM Mono,monospace">{period}</text>
    </svg>
  )
}

// ─── Rankings Page ────────────────────────────────────────────────────────────

const RANK_COLS = [
  { key: 'pts',    label: 'PTS' },
  { key: 'reb',    label: 'REB' },
  { key: 'ast',    label: 'AST' },
  { key: 'stl',    label: 'STL' },
  { key: 'blk',    label: 'BLK' },
  { key: 'tov',    label: 'TOV', lowerBetter: true },
  { key: 'fg3m',   label: '3PM' },
  { key: 'fg_pct', label: 'FG%', pct: true },
  { key: 'ft_pct', label: 'FT%', pct: true },
]

const POSITIONS = ['All', 'Guard', 'Forward', 'Center', 'Guard-Forward', 'Forward-Center']

const PERIODS = [
  { value: 'season', label: 'Full Season' },
  { value: 'l30',    label: 'Last 30 Days' },
  { value: 'l14',    label: 'Last 14 Days' },
]

function RankingsPage() {
  const [period,   setPeriod]   = useState('season')
  const [position, setPosition] = useState('all')
  const [players,  setPlayers]  = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [sortKey,  setSortKey]  = useState('z_total')
  const [sortAsc,  setSortAsc]  = useState(false)

  useEffect(() => {
    setLoading(true)
    setPlayers(null)
    const pos = position === 'all' ? 'all' : position
    fetch(`/api/rankings?period=${period}&position=${encodeURIComponent(pos)}`)
      .then(r => r.json())
      .then(d => { setPlayers(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [period, position])

  function handleSort(key) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(key === 'tov') }
  }

  const sorted = players ? [...players].sort((a, b) => {
    const av = a[sortKey] ?? -Infinity
    const bv = b[sortKey] ?? -Infinity
    return sortAsc ? av - bv : bv - av
  }) : []

  const fmt = (val, pct) => val == null ? '—' : pct ? `${val}%` : val.toFixed(1)
  const fmtZ = (z) => z == null ? '' : (z >= 0 ? '+' : '') + z.toFixed(2)

  function SortIcon({ col }) {
    if (sortKey !== col) return <span className="sort-icon muted">↕</span>
    return <span className="sort-icon">{sortAsc ? '↑' : '↓'}</span>
  }

  return (
    <div className="rankings-page">
      <div className="rankings-controls">
        <div className="rank-filter-group">
          <span className="ctrl-label">Period</span>
          <div className="rank-pills">
            {PERIODS.map(p => (
              <button key={p.value} className={`rank-pill${period === p.value ? ' active' : ''}`}
                onClick={() => setPeriod(p.value)}>{p.label}</button>
            ))}
          </div>
        </div>
        <div className="rank-filter-group">
          <span className="ctrl-label">Position</span>
          <div className="rank-pills">
            {POSITIONS.map(p => (
              <button key={p} className={`rank-pill${position === (p === 'All' ? 'all' : p) ? ' active' : ''}`}
                onClick={() => setPosition(p === 'All' ? 'all' : p)}>{p}</button>
            ))}
          </div>
        </div>
      </div>

      {loading && <p className="rankings-loading">Loading…</p>}

      {!loading && sorted.length > 0 && (
        <div className="rankings-table-wrap">
          <table className="rankings-table">
            <thead>
              <tr>
                <th className="rank-col">#</th>
                <th className="name-col" onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
                  Player <SortIcon col="name" />
                </th>
                <th>Pos</th>
                <th className="num" onClick={() => handleSort('gp')} style={{ cursor: 'pointer' }}>
                  GP <SortIcon col="gp" />
                </th>
                <th className="num" onClick={() => handleSort('min_pg')} style={{ cursor: 'pointer' }}>
                  MIN <SortIcon col="min_pg" />
                </th>
                {RANK_COLS.map(c => (
                  <th key={c.key} className="num" onClick={() => handleSort(c.key)} style={{ cursor: 'pointer' }}>
                    {c.label} <SortIcon col={c.key} />
                    <div className="th-z" onClick={e => { e.stopPropagation(); handleSort(`z_${c.key}`) }}>
                      z <SortIcon col={`z_${c.key}`} />
                    </div>
                  </th>
                ))}
                <th className="num" onClick={() => handleSort('z_total')} style={{ cursor: 'pointer' }}>
                  Value <SortIcon col="z_total" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => {
                const isTopVal = sortKey === 'z_total'
                return (
                  <tr key={p.slug} className={i % 2 === 0 ? 'row-even' : 'row-odd'}>
                    <td className="rank-col muted">{p.rank}</td>
                    <td className="name-col">
                      <span className="rank-player-name">{p.name}</span>
                      <span className="rank-player-team muted"> {p.team}</span>
                    </td>
                    <td className="muted" style={{ fontSize: '11px' }}>{p.position || '—'}</td>
                    <td className="num mono">{p.gp ?? '—'}</td>
                    <td className="num mono">{p.min_pg != null ? p.min_pg.toFixed(1) : '—'}</td>
                    {RANK_COLS.map(c => {
                      const z = p[`z_${c.key}`]
                      const zColor = z == null ? '' : z >= 1 ? '#4dffb4' : z <= -1 ? '#ff6b6b' : '#888'
                      return (
                        <td key={c.key} className="num mono rank-stat-cell">
                          <div>{fmt(p[c.key], c.pct)}</div>
                          <div className="rank-z" style={{ color: zColor }}>{fmtZ(z)}</div>
                        </td>
                      )
                    })}
                    <td className="num mono z-total-cell">
                      {fmtZ(p.z_total)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && players && sorted.length === 0 && (
        <p className="rankings-empty">No players found for this filter.</p>
      )}
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [page, setPage]               = useState('home')
  const [query, setQuery]             = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [showSugg, setShowSugg]       = useState(false)
  const [selectedPlayer, setSelected] = useState(null)
  const [stat, setStat]               = useState('reb')
  const [periodA, setPeriodA]         = useState({ start: '2025-10-22', end: '2026-02-13' })
  const [periodB, setPeriodB]         = useState({ start: '2026-02-21', end: '2026-04-06' })
  const [result, setResult]           = useState(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  const [dataRange, setDataRange]     = useState(null)
  const [gameLog, setGameLog]         = useState(null)
  const [shotDiet, setShotDiet]       = useState(null)
  const [playerStats, setPlayerStats] = useState(null)
  const [projection, setProjection]   = useState(null)
  const [projMpg, setProjMpg]         = useState(32)
  const [projStat, setProjStat]       = useState('pts')
  const [projYear, setProjYear]       = useState(1)
  const [projExpanded, setProjExpanded] = useState(true)
  const [playerGames, setPlayerGames] = useState(null)
  const [maStat, setMaStat]           = useState('pts')
  const [maWindow, setMaWindow]       = useState(10)
  const [maLookback, setMaLookback]   = useState(20)
  const [maExpanded, setMaExpanded]   = useState(false)
  const [glExpanded, setGlExpanded]   = useState(false)
  const [glStart, setGlStart]         = useState(0)
  const [glEnd, setGlEnd]             = useState(0)
  const [agingCurves, setAgingCurves]     = useState(null)
  const [agingArchetype, setAgingArchetype] = useState(null)
  const [agingExpanded, setAgingExpanded]   = useState(false)
  const [driverExpanded, setDriverExpanded] = useState(false)

  // Compare tool state
  const [cmpExpanded, setCmpExpanded] = useState(false)
  const [cmpQuery,    setCmpQuery]    = useState('')
  const [cmpSuggs,    setCmpSuggs]    = useState([])
  const [cmpShow,     setCmpShow]     = useState(false)
  const [cmpPlayers,  setCmpPlayers]  = useState([]) // [{player, stats}]

  const searchRef   = useRef(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    fetch('/api/data-range')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setDataRange(d) })
      .catch(() => {})
    fetch('/api/aging-curves')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setAgingCurves(d)
          setAgingArchetype(Object.keys(d)[0])
        }
      })
      .catch(() => {})
  }, [])

  // Compare tool — suggestions
  useEffect(() => {
    if (!cmpQuery || cmpQuery.length < 2) { setCmpSuggs([]); return }
    fetch(`/api/players?q=${encodeURIComponent(cmpQuery)}`)
      .then(r => r.json()).then(d => setCmpSuggs(Array.isArray(d) ? d : [])).catch(() => {})
  }, [cmpQuery])

  // Reset compare players when main player changes
  useEffect(() => { setCmpPlayers([]) }, [selectedPlayer])

  const fetchSuggestions = useCallback(async (q) => {
    if (!q.trim()) { setSuggestions([]); return }
    try {
      const res = await fetch(`/api/players?q=${encodeURIComponent(q)}`)
      if (res.ok) setSuggestions(await res.json())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(query), 250)
  }, [query, fetchSuggestions])

  useEffect(() => {
    const onDown = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowSugg(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const selectPlayer = (p) => {
    setSelected(p)
    setQuery(p.name)
    setSuggestions([])
    setShowSugg(false)
    setResult(null)
    setGameLog(null)
    setShotDiet(null)
    setPlayerStats(null)
    setProjection(null)
    setPlayerGames(null)
    setMaLookback(20)
    setProjYear(1)
    fetch(`/api/player-stats?player=${encodeURIComponent(p.slug)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setPlayerStats(d) })
      .catch(() => {})
    fetch(`/api/project?player=${encodeURIComponent(p.slug)}&mpg=32`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setProjection(d)
          setProjMpg(Math.round(d.current_mpg))
        }
      })
      .catch(() => {})
    fetch(`/api/player-games?player=${encodeURIComponent(p.slug)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setPlayerGames(d)
          setGlEnd(d.length - 1)
          setGlStart(Math.max(0, d.length - 20))
        }
      })
      .catch(() => {})
  }

  const handleAnalyse = async () => {
    if (!selectedPlayer || !periodA.start || !periodA.end || !periodB.start || !periodB.end) {
      setError('Please select a player and fill in both date ranges.')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    setGameLog(null)
    setShotDiet(null)
    try {
      const params = new URLSearchParams({
        player: selectedPlayer.slug, stat,
        pa_start: periodA.start, pa_end: periodA.end,
        pb_start: periodB.start, pb_end: periodB.end,
      })
      const res = await fetch(`/api/decompose?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: 'Request failed' }))
        setError(body.detail ?? 'Request failed')
      } else {
        const data = await res.json()
        setResult(data)
        // fetch game log for both periods combined
        const logParams = new URLSearchParams({
          player:   selectedPlayer.slug,
          pa_start: periodA.start,
          pb_end:   periodB.end,
        })
        fetch(`/api/game-log?${logParams}`)
          .then(r => r.ok ? r.json() : null)
          .then(rows => { if (rows) setGameLog(rows) })
          .catch(() => {})

        const shotParams = new URLSearchParams({
          player: selectedPlayer.slug,
          pa_start: periodA.start, pa_end: periodA.end,
          pb_start: periodB.start, pb_end: periodB.end,
        })
        if (stat === 'pts' || stat === 'fg3m') {
          fetch(`/api/shot-diet?${shotParams}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) setShotDiet(d) })
            .catch(() => {})
        }
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const wf = result ? buildWaterfall(result) : null

  // Active projection year (from multi-year array)
  const activeProj = projection?.projections?.[projYear - 1] ?? null

  // Projection row — recomputed whenever slider or year changes
  const projScale = projMpg / 30.0
  const projRowData = activeProj ? {
    pts:    +(activeProj.projection_p30.pts    * projScale).toFixed(1),
    reb:    +(activeProj.projection_p30.reb    * projScale).toFixed(1),
    ast:    +(activeProj.projection_p30.ast    * projScale).toFixed(1),
    stl:    +(activeProj.projection_p30.stl    * projScale).toFixed(1),
    blk:    +(activeProj.projection_p30.blk    * projScale).toFixed(1),
    tov:    +(activeProj.projection_p30.tov    * projScale).toFixed(1),
    fg3m:   +(activeProj.projection_p30.fg3m   * projScale).toFixed(1),
    fg_pct: +activeProj.projection_p30.fg_pct.toFixed(1),
    ft_pct: activeProj.projection_p30.ft_pct ?? null,
  } : null

  // Trend chart — historical seasons + all projected years
  const trendSeasons = playerStats ? [...playerStats.seasons].reverse() : []
  const Z_TREND_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fg3m', 'fg_pct', 'ft_pct']
  const Z_TREND_INVERT = new Set(['tov'])
  const getStatVal = (s, key) => {
    if (key === 'z_sum') {
      let sum = 0
      for (const k of Z_TREND_KEYS) {
        const z = s[`z_${k}`]
        if (z === null || z === undefined) continue
        sum += Z_TREND_INVERT.has(k) ? -z : z
      }
      return +sum.toFixed(2)
    }
    return s[key] ?? null
  }
  const getProjVal = (proj) => {
    if (projStat === 'z_sum')  return proj.z_sum ?? null
    if (projStat === 'ft_pct') return proj.projection_p30.ft_pct ?? null
    if (projStat === 'fg_pct') return +proj.projection_p30.fg_pct.toFixed(1)
    return +(proj.projection_p30[projStat] * projScale).toFixed(1)
  }

  const projLabels  = projection?.projections?.map(p => p.season) ?? []
  const trendLabels = [...trendSeasons.map(s => s.period), ...projLabels]

  // Historical line: season values + nulls for projected slots
  const historicalVals = [
    ...trendSeasons.map(s => getStatVal(s, projStat)),
    ...projLabels.map(() => null),
  ]

  // Projection line: nulls for historical, then connect from last season value through all projected years
  const lastHistVal = trendSeasons.length > 0 ? getStatVal(trendSeasons[trendSeasons.length - 1], projStat) : null
  const projLineVals = [
    ...trendSeasons.map((_, i) => i === trendSeasons.length - 1 ? lastHistVal : null),
    ...(projection?.projections?.map(p => getProjVal(p)) ?? []),
  ]

  const trendChartData = playerStats && projection ? {
    labels: trendLabels,
    datasets: [
      {
        label: 'Historical',
        data: historicalVals,
        borderColor: '#7c8cff',
        pointBackgroundColor: '#7c8cff',
        pointRadius: 4,
        borderWidth: 2,
        tension: 0.2,
        spanGaps: false,
      },
      {
        label: 'Projected',
        data: projLineVals,
        borderColor: '#4dffb4',
        pointBackgroundColor: (ctx) => {
          const idx = ctx.dataIndex - trendSeasons.length + 1
          return idx === projYear ? '#4dffb4' : 'rgba(77,255,180,0.4)'
        },
        pointRadius: (ctx) => {
          const idx = ctx.dataIndex - trendSeasons.length + 1
          return idx >= 1 ? (idx === projYear ? 6 : 4) : 0
        },
        borderWidth: 2,
        borderDash: [5, 4],
        tension: 0.2,
        spanGaps: false,
      },
    ],
  } : null

  const trendChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      datalabels: { display: false },
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const val = ctx.parsed.y
            return (projStat === 'fg_pct' || projStat === 'ft_pct') ? ` ${val}%` : ` ${val}`
          },
        },
        backgroundColor: '#1c1c1c',
        borderColor: '#2a2a2a',
        borderWidth: 1,
        titleColor: '#555',
        bodyColor: '#e8e8e8',
        titleFont: { family: "'DM Mono', monospace", size: 10 },
        bodyFont:  { family: "'DM Mono', monospace", size: 12 },
        padding: 10,
        cornerRadius: 4,
      },
    },
    scales: {
      x: {
        grid:   { color: '#1a1a1a', drawTicks: false },
        border: { color: '#222' },
        ticks:  { color: '#555', font: { family: "'DM Mono', monospace", size: 10 } },
      },
      y: {
        grid:   { color: '#1a1a1a', drawTicks: false },
        border: { color: '#222' },
        ticks:  { color: '#555', font: { family: "'DM Mono', monospace", size: 10 } },
      },
    },
  }

  // Moving average chart
  const maAllGames  = playerGames ?? []
  const maGames     = maLookback ? maAllGames.slice(-maLookback) : maAllGames
  const maIsZSum    = maStat === 'z_sum'
  // Z-scores computed over full career so the baseline doesn't shift with the slider
  const maAllZSums  = maIsZSum ? computeGameZSums(maAllGames) : null
  const maRawVals   = maIsZSum
    ? (maLookback ? maAllZSums.slice(-maLookback) : maAllZSums)
    : maGames.map(g => g[maStat] ?? null)
  const maSynthGames = maIsZSum ? maGames.map((g, i) => ({ ...g, z_sum: maRawVals[i] })) : maGames
  const maVals      = rollingAverage(maSynthGames, maStat, maWindow)
  const maStatLabel = MA_STAT_OPTIONS.find(o => o.value === maStat)?.label ?? maStat
  const maChartData = maGames.length > 0 ? {
    labels: maGames.map(g => g.game_date),
    datasets: [
      {
        label: maStatLabel,
        data: maRawVals,
        borderColor: 'rgba(150,150,255,0.25)',
        backgroundColor: 'rgba(150,150,255,0.25)',
        pointRadius: 2,
        pointHoverRadius: 4,
        borderWidth: 0,
        showLine: false,
        spanGaps: false,
      },
      {
        label: `${maWindow}-game avg`,
        data: maVals,
        borderColor: '#9696ff',
        backgroundColor: 'transparent',
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2,
        tension: 0.3,
        spanGaps: false,
      },
    ],
  } : null

  const maChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      datalabels: { display: false },
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const val = ctx.parsed.y
            if (val === null) return null
            return (maStat === 'fg_pct' || maStat === 'ft_pct') ? ` ${val.toFixed(1)}%` : ` ${val.toFixed(2)}`
          },
        },
        backgroundColor: '#1c1c1c',
        borderColor: '#2a2a2a',
        borderWidth: 1,
        titleColor: '#aaa',
        bodyColor: '#eee',
      },
    },
    scales: {
      x: {
        grid:   { color: '#1a1a1a', drawTicks: false },
        border: { color: '#222' },
        ticks: {
          color: '#555',
          font: { family: "'DM Mono', monospace", size: 10 },
          maxTicksLimit: 12,
          maxRotation: 0,
        },
      },
      y: {
        grid:   { color: '#1a1a1a', drawTicks: false },
        border: { color: '#222' },
        ticks:  { color: '#555', font: { family: "'DM Mono', monospace", size: 10 } },
      },
    },
  }

  const labelPlugin = {
    id: 'waterfallLabels',
    afterDraw(chart) {
      if (!wf) return
      const meta = chart.getDatasetMeta(1)
      if (!meta?.data) return
      const { ctx } = chart
      ctx.save()
      ctx.font = "500 10px 'DM Mono', monospace"
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      meta.data.forEach((bar, i) => {
        if (wf.barData[i] === 0) return
        ctx.fillStyle = i === 0 || i === wf.labels.length - 1
          ? 'rgba(232,232,232,0.5)'
          : wf.colors[i]
        ctx.fillText(wf.displayLabels[i], bar.x, bar.y - 4)
      })
      ctx.restore()
    },
  }

  const chartData = wf && {
    labels: wf.labels,
    datasets: [
      { label: 'float', data: wf.floatData, backgroundColor: 'transparent', borderWidth: 0, stack: 'wf' },
      { label: 'value', data: wf.barData, backgroundColor: wf.colors, borderRadius: 2, borderWidth: 0, stack: 'wf' },
    ],
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      datalabels: { display: false },
      legend: { display: false },
      tooltip: {
        filter: (item) => item.datasetIndex === 1,
        callbacks: { label: (ctx) => ' ' + wf.tipLabels[ctx.dataIndex] },
        backgroundColor: '#1c1c1c',
        borderColor: '#2a2a2a',
        borderWidth: 1,
        titleColor: '#555',
        bodyColor: '#e8e8e8',
        titleFont: { family: "'DM Mono', monospace", size: 10 },
        bodyFont:  { family: "'DM Mono', monospace", size: 12 },
        padding: 10,
        cornerRadius: 4,
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { color: '#1a1a1a', drawTicks: false },
        border: { color: '#222' },
        ticks: {
          color: '#555',
          font: { family: "'DM Mono', monospace", size: 10 },
          maxRotation: 35,
          minRotation: 35,
        },
      },
      y: {
        stacked: true,
        display: false,
      },
    },
  }

  const statLabel = STAT_OPTIONS.find(o => o.value === result?.stat)?.label ?? result?.stat
  const statLabelShort = STAT_LABELS_SHORT[result?.stat] ?? result?.stat

  const skillSum = result
    ? result.drivers.filter(d => d.category === 'skill').reduce((s, d) => s + d.contribution, 0)
    : 0
  const roleSum = result
    ? result.drivers.filter(d => d.category === 'role').reduce((s, d) => s + d.contribution, 0)
    : 0
  const luckSum = result
    ? result.drivers.filter(d => d.category === 'opponent' || d.category === 'team').reduce((s, d) => s + d.contribution, 0)
    : 0
  const maxContrib = result ? Math.max(...result.drivers.map(d => Math.abs(d.contribution)), 0.001) : 0.001
  const insights   = result ? generateInsights(result, statLabelShort) : []

  const STAT_COLS = [
    { key: 'min_pg', label: 'MIN', noZ: true },
    { key: 'pts',    label: 'PTS' },
    { key: 'reb',    label: 'REB' },
    { key: 'ast',    label: 'AST' },
    { key: 'stl',    label: 'STL' },
    { key: 'blk',    label: 'BLK' },
    { key: 'tov',    label: 'TOV' },
    { key: 'fg_pct', label: 'FG%' },
    { key: 'ft_pct', label: 'FT%' },
    { key: 'fg3m',   label: '3PM' },
  ]

  function zColor(z, key) {
    if (z === null || z === undefined) return ''
    // For TOV, lower is better — invert
    const v = key === 'tov' ? -z : z
    if (v >= 1.5)  return '#4dffb4'
    if (v >= 0.5)  return '#9affda'
    if (v <= -1.5) return '#ff6b6b'
    if (v <= -0.5) return '#ff9e9e'
    return '#555'
  }

  function StatCell({ val, col, z, noZ }) {
    if (val === null || val === undefined) return <><td className="num mono stat-cell">—</td>{!noZ && <td className="num mono z-cell">—</td>}</>
    const display = (col === 'fg_pct' || col === 'ft_pct') ? `${val}%` : val.toFixed(1)
    const zDisplay = (z !== null && z !== undefined) ? `${z >= 0 ? '+' : ''}${z.toFixed(1)}` : '—'
    return (
      <>
        <td className="num mono stat-cell">{display}</td>
        {!noZ && <td className="num mono z-cell" style={{ color: zColor(z, col) }}>{zDisplay}</td>}
      </>
    )
  }

  function StatsRow({ label, data, highlight }) {
    if (!data) return null
    const rankColor = data.rank && data.rank_n
      ? data.rank / data.rank_n <= 0.1 ? '#4dffb4'
      : data.rank / data.rank_n <= 0.25 ? '#9affda'
      : data.rank / data.rank_n >= 0.9 ? '#ff6b6b'
      : data.rank / data.rank_n >= 0.75 ? '#ff9e9e'
      : '#aaa'
      : '#555'
    return (
      <tr className={highlight ? `stats-row-${highlight}` : ''}>
        <td className="stats-period-cell">{label}</td>
        <td className="stats-period-cell muted" style={{ fontSize: '11px', fontFamily: 'var(--mono)' }}>{data.team ? teamAbbr(data.team) : '—'}</td>
        <td className="num mono stat-cell muted">{data.gp}</td>
        <td className="num mono rank-cell" style={{ color: rankColor }} colSpan={2}>
          {data.rank ?? '—'}
        </td>
        {STAT_COLS.map(c => (
          <StatCell key={c.key} val={data[c.key]} col={c.key} z={data[`z_${c.key}`]} noZ={c.noZ} />
        ))}
      </tr>
    )
  }

  function ProjectionRow({ label, data, note }) {
    if (!data) return null
    return (
      <tr className="stats-row-projection">
        <td className="stats-period-cell">
          <div>{label}{note && <span className="archetype-transition" title={`Projected archetype: ${note}`}> ↓</span>}</div>
          <div><span className="forecast-badge">Forecast</span></div>
        </td>
        <td className="stats-period-cell muted" style={{ fontSize: '11px', fontFamily: 'var(--mono)' }}>—</td>
        <td className="num mono stat-cell muted">—</td>
        <td className="num mono rank-cell" colSpan={2} style={{ color: '#555' }}>—</td>
        {STAT_COLS.map(c => {
          const val = data[c.key]
          if (val === null || val === undefined) {
            return <Fragment key={c.key}><td className="num mono stat-cell">—</td>{!c.noZ && <td className="num mono z-cell">—</td>}</Fragment>
          }
          const display = (c.key === 'fg_pct' || c.key === 'ft_pct') ? `${val}%` : val.toFixed(1)
          return (
            <Fragment key={c.key}>
              <td className="num mono stat-cell" style={{ color: '#4dffb4' }}>{display}</td>
              {!c.noZ && <td className="num mono z-cell">—</td>}
            </Fragment>
          )
        })}
      </tr>
    )
  }

  return (
    <>
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="site-header">
        <div className="site-header-inner">
          <div className="site-logo">
            <span className="site-logo-icon">🏀</span>
            <div>
              <h1>Fantasy Basketball Analyzer</h1>
            </div>
          </div>
          <nav className="site-nav">
            <button className={`nav-btn${page === 'home' ? ' active' : ''}`} onClick={() => setPage('home')}>Player</button>
            <button className={`nav-btn${page === 'rankings' ? ' active' : ''}`} onClick={() => setPage('rankings')}>Rankings</button>
          </nav>
        </div>
      </header>

      {/* ── Page body ──────────────────────────────────────── */}
      <main className="page-body">

      {page === 'rankings' && <RankingsPage />}

      {page === 'home' && <>
        {/* ── Player search ────────────────────────────────── */}
        <div className="player-search-section" ref={searchRef}>
          <div className="typeahead player-typeahead">
            <input
              className="ctrl-input player-search-input"
              type="text"
              placeholder="Search for a player…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null); setShowSugg(true) }}
              onFocus={() => setShowSugg(true)}
            />
            {showSugg && suggestions.length > 0 && (
              <ul className="suggestions">
                {suggestions.map((p) => (
                  <li key={p.slug} onMouseDown={() => selectPlayer(p)}>
                    <span className="sugg-name">{p.name}</span>
                    <span className="sugg-team">{p.team}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {/* ── Player profile ────────────────────────────────── */}
        {selectedPlayer && playerStats && (
          <div className="player-profile">
            <div className="player-profile-header">
              <h2 className="player-name">{playerStats.player.name}</h2>
              <span className="player-team">{teamAbbr(playerStats.player.team)}</span>
              {playerStats.player.position && (
                <span className="player-age">{playerStats.player.position}</span>
              )}
              {playerStats.player.age && (
                <span className="player-age">Age {playerStats.player.age}</span>
              )}
              {projection?.archetype && (
                <span className="archetype-badge">{projection.archetype}</span>
              )}
            </div>

            <div className="stats-grid-wrap">
              <table className="stats-grid">
                <thead>
                  <tr>
                    <th className="stats-period-cell" rowSpan={2}>Period</th>
                    <th className="stats-period-cell" rowSpan={2}>Team</th>
                    <th className="num" rowSpan={2}>GP</th>
                    <th className="num stat-group-header" colSpan={2} rowSpan={2} style={{verticalAlign:'middle'}}>Rank</th>
                    {STAT_COLS.map(c => (
                      <th key={c.key} className="num stat-group-header" colSpan={c.noZ ? 1 : 2}>{c.label}</th>
                    ))}
                  </tr>
                  <tr>
                    {STAT_COLS.map(c => (
                      <Fragment key={c.key}>
                        <th className="num stat-sub-header">avg</th>
                        {!c.noZ && <th className="num stat-sub-header z-header">z</th>}
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <StatsRow label={playerStats.seasons[0]?.period} data={playerStats.seasons[0]} />
                  <StatsRow label="Last 14 days" data={playerStats.l14} highlight="recent" />
                  <StatsRow label="Last 30 days" data={playerStats.l30} highlight="recent" />
                  <ProjectionRow
                    label={activeProj ? activeProj.season : 'Projected'}
                    data={projRowData}
                    note={activeProj && activeProj.archetype !== projection.archetype ? activeProj.archetype : null}
                  />
                  <StatsRow label="Career" data={{ ...playerStats.career, rank: null }} highlight="career" />
                </tbody>
              </table>
            </div>

            {/* ── Compare ───────────────────────────────────────── */}
            <div className="projection-section">
              <div className="projection-header" onClick={() => setCmpExpanded(e => !e)} style={{ cursor: 'pointer' }}>
                <h3 className="panel-title">Compare</h3>
                <span className="proj-toggle">{cmpExpanded ? '▲' : '▼'}</span>
              </div>
              {cmpExpanded && (() => {
                const CMP_COLORS = ['#4dffb4', '#ff9e64', '#64b5ff', '#c084fc']
                const allPlayers = [{ player: playerStats.player, stats: playerStats }, ...cmpPlayers]
                const canAdd = cmpPlayers.length < 3

                function removeCmpPlayer(slug) {
                  setCmpPlayers(ps => ps.filter(p => p.player.slug !== slug))
                }

                function addCmpPlayer(p) {
                  if (cmpPlayers.some(cp => cp.player.slug === p.slug)) return
                  if (p.slug === playerStats.player.slug) return
                  fetch(`/api/player-stats?player=${p.slug}`)
                    .then(r => r.json())
                    .then(stats => setCmpPlayers(ps => [...ps, { player: p, stats }]))
                    .catch(() => {})
                  setCmpQuery('')
                  setCmpSuggs([])
                  setCmpShow(false)
                }

                const radarData = allPlayers.every(p => p.stats?.seasons?.[0]) ? {
                  labels: RADAR_STATS.map(s => s.label),
                  datasets: allPlayers.map((p, i) => ({
                    label: p.player.name,
                    data: RADAR_STATS.map(s => zToRadar(p.stats.seasons[0][`z_${s.key}`], s.invert)),
                    backgroundColor: CMP_COLORS[i] + '20',
                    borderColor: CMP_COLORS[i],
                    pointBackgroundColor: CMP_COLORS[i],
                    borderWidth: 2,
                  })),
                } : null

                const radarOptions = {
                  scales: {
                    r: {
                      min: 0, max: 100,
                      ticks: { display: false },
                      grid: { color: 'rgba(255,255,255,0.07)' },
                      angleLines: { color: 'rgba(255,255,255,0.07)' },
                      pointLabels: { color: '#aaa', font: { size: 11 } },
                    },
                  },
                  plugins: {
                    legend: { labels: { color: '#ccc', font: { size: 11 }, boxWidth: 12 } },
                    datalabels: { display: false },
                  },
                }

                const CMP_COLS = [
                  { key: 'pts',    label: 'PTS' },
                  { key: 'reb',    label: 'REB' },
                  { key: 'ast',    label: 'AST' },
                  { key: 'stl',    label: 'STL' },
                  { key: 'blk',    label: 'BLK' },
                  { key: 'tov',    label: 'TOV' },
                  { key: 'fg_pct', label: 'FG%',  pct: true },
                  { key: 'ft_pct', label: 'FT%',  pct: true },
                  { key: 'fg3m',   label: '3PM' },
                ]

                const fmt = (val, pct) => val == null ? '—' : pct ? `${val}%` : val.toFixed(1)

                function bestIdx(col) {
                  const vals = allPlayers.map(p => p.stats?.seasons?.[0]?.[col.key])
                  if (vals.some(v => v == null)) return null
                  const fn = col.key === 'tov' ? Math.min : Math.max
                  const best = fn(...vals)
                  const idx = vals.indexOf(best)
                  return vals.filter(v => v === best).length === 1 ? idx : null
                }

                return (
                  <div className="compare-content">
                    {/* Chips + search */}
                    <div className="cmp-chips">
                      {allPlayers.map((p, i) => (
                        <span key={p.player.slug} className="cmp-chip" style={{ borderColor: CMP_COLORS[i], color: CMP_COLORS[i] }}>
                          {p.player.name}
                          {i > 0 && (
                            <button className="cmp-chip-remove" onClick={() => removeCmpPlayer(p.player.slug)}>×</button>
                          )}
                        </span>
                      ))}
                      {canAdd && (
                        <div className="typeahead cmp-typeahead">
                          <input
                            className="ctrl-input cmp-search-input"
                            placeholder="Add player…"
                            value={cmpQuery}
                            onChange={e => { setCmpQuery(e.target.value); setCmpShow(true) }}
                            onFocus={() => setCmpShow(true)}
                          />
                          {cmpShow && cmpSuggs.length > 0 && (
                            <ul className="suggestions">
                              {cmpSuggs.map(p => (
                                <li key={p.slug} onMouseDown={() => addCmpPlayer(p)}>
                                  <span className="sugg-name">{p.name}</span>
                                  <span className="sugg-team">{p.team}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Chart + table */}
                    {allPlayers.length > 1 && radarData && (
                      <div className="compare-results">
                        <div className="compare-chart-wrap">
                          <Radar data={radarData} options={radarOptions} />
                        </div>
                        <div className="compare-table-wrap">
                          <table className="compare-table">
                            <thead>
                              <tr>
                                <th>Player</th>
                                <th className="num">GP</th>
                                <th className="num">MIN</th>
                                {CMP_COLS.map(c => <th key={c.key} className="num">{c.label}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {allPlayers.map((p, i) => {
                                const s = p.stats?.seasons?.[0]
                                if (!s) return null
                                const color = CMP_COLORS[i]
                                return (
                                  <tr key={p.player.slug}>
                                    <td style={{ color, fontWeight: 500, whiteSpace: 'nowrap' }}>
                                      {p.player.name}
                                      <span className="compare-player-meta"> {teamAbbr(p.player.team)}</span>
                                    </td>
                                    <td className="num mono">{s.gp}</td>
                                    <td className="num mono">{s.min_pg?.toFixed(1)}</td>
                                    {CMP_COLS.map(c => {
                                      const bi = bestIdx(c)
                                      const highlight = bi === i
                                      return (
                                        <td key={c.key} className="num mono"
                                          style={{ color: highlight ? color : '', fontWeight: highlight ? 600 : 400 }}>
                                          {fmt(s[c.key], c.pct)}
                                        </td>
                                      )
                                    })}
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {allPlayers.length === 1 && (
                      <p className="cmp-prompt">Add a player above to start comparing.</p>
                    )}
                  </div>
                )
              })()}
            </div>

            {/* ── Driver analysis tool ──────────────────────── */}
            <div className="projection-section">
              <div className="projection-header" onClick={() => setDriverExpanded(e => !e)} style={{ cursor: 'pointer' }}>
                <h3 className="panel-title">Driver Analysis</h3>
                <span className="proj-toggle">{driverExpanded ? '▲' : '▼'}</span>
              </div>
              {driverExpanded && (
                <>
                <div className="controls-inner">
                  <div className="ctrl-group preset-group">
                    <span className="ctrl-label">Presets</span>
                    <div className="preset-btns">
                      {[
                        { label: 'Pre/Post All-Star', a: { start: '2025-10-22', end: '2026-02-13' }, b: { start: '2026-02-21', end: '2026-04-06' } },
                        { label: 'Jan vs Mar',        a: { start: '2026-01-01', end: '2026-01-31' }, b: { start: '2026-03-01', end: '2026-03-31' } },
                        { label: 'Feb vs Mar',        a: { start: '2026-02-01', end: '2026-02-28' }, b: { start: '2026-03-01', end: '2026-03-31' } },
                        { label: 'First half vs Second half', a: { start: '2025-10-22', end: '2026-01-15' }, b: { start: '2026-01-16', end: '2026-04-06' } },
                      ].map(p => (
                        <button
                          key={p.label}
                          className="preset-btn"
                          onClick={() => { setPeriodA(p.a); setPeriodB(p.b) }}
                        >{p.label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="ctrl-group">
                    <span className="ctrl-label">Stat</span>
                    <select className="ctrl-input" value={stat} onChange={(e) => setStat(e.target.value)}>
                      {STAT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="ctrl-group ctrl-period">
                    <span className="ctrl-label">Baseline period</span>
                    <div className="date-pair">
                      <input className="ctrl-input date-input" type="date" value={periodA.start} onChange={(e) => setPeriodA(p => ({ ...p, start: e.target.value }))} />
                      <span className="date-sep">–</span>
                      <input className="ctrl-input date-input" type="date" value={periodA.end} onChange={(e) => setPeriodA(p => ({ ...p, end: e.target.value }))} />
                    </div>
                  </div>
                  <div className="ctrl-group ctrl-period">
                    <span className="ctrl-label">Comparison period</span>
                    <div className="date-pair">
                      <input className="ctrl-input date-input" type="date" value={periodB.start} onChange={(e) => setPeriodB(p => ({ ...p, start: e.target.value }))} />
                      <span className="date-sep">–</span>
                      <input className="ctrl-input date-input" type="date" value={periodB.end} onChange={(e) => setPeriodB(p => ({ ...p, end: e.target.value }))} />
                    </div>
                  </div>
                  <button className="analyse-btn" onClick={handleAnalyse} disabled={loading}>
                    {loading ? '…' : 'Analyse'}
                  </button>
                </div>
                {result && selectedPlayer && (
                  <div className="driver-results">
                    {/* ── Metrics row ──────────────────────────────── */}
                    <div className="metrics-row">
                      <div className="metric-card">
                        <span className="metric-label">Baseline</span>
                        <span className="metric-value">{result.period_a.value.toFixed(1)}</span>
                        <span className="metric-sub">{statLabelShort}</span>
                      </div>
                      <div className="metric-card">
                        <span className="metric-label">Comparison</span>
                        <span className="metric-value">{result.period_b.value.toFixed(1)}</span>
                        <span className={`metric-sub metric-delta ${result.delta >= 0 ? 'pos' : 'neg'}`}>
                          {result.delta >= 0 ? '+' : ''}{result.delta.toFixed(2)}&ensp;
                          ({result.delta >= 0 ? '+' : ''}{((result.delta / result.period_a.value) * 100).toFixed(1)}%)
                        </span>
                      </div>
                      <div className="metric-card">
                        <span className="metric-label">Rate change</span>
                        <span className={`metric-value ${skillSum >= 0 ? 'pos' : 'neg'}`}>
                          {skillSum >= 0 ? '+' : ''}{skillSum.toFixed(2)}
                        </span>
                        <span className="metric-sub">rate changes</span>
                      </div>
                      <div className="metric-card">
                        <span className="metric-label">Role</span>
                        <span className={`metric-value ${roleSum >= 0 ? 'pos' : 'neg'}`}>
                          {roleSum >= 0 ? '+' : ''}{roleSum.toFixed(2)}
                        </span>
                        <span className="metric-sub">minutes / usage</span>
                      </div>
                      <div className="metric-card">
                        <span className="metric-label">Pace</span>
                        <span className={`metric-value ${luckSum >= 0 ? 'pos' : 'neg'}`}>
                          {luckSum >= 0 ? '+' : ''}{luckSum.toFixed(2)}
                        </span>
                        <span className="metric-sub">external factors</span>
                      </div>
                    </div>

                    {/* ── Legend ───────────────────────────────────── */}
                    <div className="chart-legend">
                      {LEGEND_ITEMS.map((item) => (
                        <span key={item.label} className="legend-item">
                          <span className="legend-dot" style={{ background: item.color }} />
                          {item.label}
                        </span>
                      ))}
                    </div>

                    {/* ── Waterfall chart ───────────────────────────── */}
                    <div className="chart-wrap">
                      <Bar data={chartData} options={chartOptions} plugins={[labelPlugin]} />
                    </div>

                    {/* ── Driver table + Insights ───────────────────── */}
                    <div className="analysis-row">
                      <div className="breakdown-panel">
                        <h2 className="panel-title">Driver breakdown</h2>
                        <table className="drivers-table">
                          <thead>
                            <tr>
                              <th>Driver</th>
                              <th className="num">Change</th>
                              <th className="num">Attribution</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...result.drivers]
                              .sort((a, b) => (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99))
                              .map((d) => {
                                const catColor = CATEGORY_COLORS[d.category] ?? '#888'
                                const barColor = CATEGORY_COLORS[d.category] ?? '#888'
                                const barPct   = (Math.abs(d.contribution) / maxContrib) * 100
                                return (
                                  <tr key={d.key}>
                                    <td className="driver-cell">
                                      <span className="driver-name">{d.label}</span>
                                      <span
                                        className="cat-pill"
                                        style={{ background: catColor + '20', color: catColor, borderColor: catColor + '40' }}
                                      >
                                        {CATEGORY_DISPLAY[d.category] ?? d.category}
                                      </span>
                                    </td>
                                    <td className={`num change-val ${d.contribution >= 0 ? 'pos' : 'neg'}`}>
                                      {d.contribution >= 0 ? '+' : ''}{d.contribution.toFixed(2)}
                                    </td>
                                    <td className="attribution-cell">
                                      <div
                                        className="attr-bar"
                                        style={{ width: `${barPct}%`, background: barColor }}
                                      />
                                    </td>
                                  </tr>
                                )
                              })}
                          </tbody>
                        </table>
                      </div>

                      <div className="insights-panel">
                        <h2 className="panel-title">Key insights</h2>
                        <ul className="insights-list">
                          {insights.map((ins, i) => (
                            <li key={i}>
                              <span className="insight-dot" />
                              {ins}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    {shotDiet && (stat === 'pts' || stat === 'fg3m') && (() => {
                      const zoneRows = ZONE_ORDER.map(zk => {
                        const z = shotDiet.zones.find(r => r.zone === zk) || {
                          zone: zk, label: ZONE_LABELS[zk],
                          fga_a: 0, fga_b: 0, fg_pct_a: 0, fg_pct_b: 0,
                          freq_a: 0, freq_b: 0,
                          diet_effect: 0, efficiency_effect: 0,
                        }
                        return { ...z, net: z.diet_effect + z.efficiency_effect }
                      })
                      const courtZonesA = zoneRows.map(z => ({ zone: z.zone, fg_pct: z.fg_pct_a, fga: z.fga_a, freq: z.freq_a, net: z.net }))
                      const courtZonesB = zoneRows.map(z => ({ zone: z.zone, fg_pct: z.fg_pct_b, fga: z.fga_b, freq: z.freq_b, net: z.net }))
                      const zoneLabels = zoneRows.map(z => ZONE_LABELS[z.zone])
                      const attemptChartData = {
                        labels: zoneLabels,
                        datasets: [
                          { label: 'Baseline', data: zoneRows.map(z => z.freq_a ? +(z.freq_a * 100).toFixed(1) : 0), backgroundColor: '#3a4470', borderRadius: 2 },
                          { label: 'Comparison', data: zoneRows.map(z => z.freq_b ? +(z.freq_b * 100).toFixed(1) : 0), backgroundColor: '#4dffb4', borderRadius: 2 },
                        ],
                      }
                      const attemptChartOptions = {
                        responsive: true, maintainAspectRatio: false,
                        plugins: {
                          legend: { display: true, labels: { color: '#555', font: { family: "'DM Mono', monospace", size: 10 }, boxWidth: 10 } },
                          tooltip: { backgroundColor: '#1c1c1c', borderColor: '#2a2a2a', borderWidth: 1, titleColor: '#555', bodyColor: '#e8e8e8', titleFont: { family: "'DM Mono', monospace", size: 10 }, bodyFont: { family: "'DM Mono', monospace", size: 12 }, padding: 10, cornerRadius: 4 },
                          datalabels: { labels: { count: { anchor: 'end', align: 'end', formatter: (val) => val > 0 ? `${Math.round(val)}%` : null, color: '#9aa0b8', font: { family: "'DM Mono', monospace", size: 9 } }, pct: { anchor: 'center', align: 'center', formatter: (val, ctx) => { if (val === 0) return null; const z = zoneRows[ctx.dataIndex]; if (!z) return null; const pct = ctx.datasetIndex === 0 ? z.fg_pct_a : z.fg_pct_b; const fga = ctx.datasetIndex === 0 ? z.fga_a : z.fga_b; return fga > 0 ? `${Math.round(pct * 100)}FG%` : null }, color: (ctx) => ctx.datasetIndex === 0 ? 'rgba(255,255,255,0.75)' : '#0d1a14', font: { family: "'DM Mono', monospace", size: 9, weight: '500' } } } },
                        },
                        scales: {
                          x: { grid: { color: '#1a1a1a', drawTicks: false }, border: { color: '#222' }, ticks: { color: '#888', font: { family: "'DM Mono', monospace", size: 10 } } },
                          y: { grid: { color: '#1a1a1a' }, border: { color: '#222' }, ticks: { color: '#888', font: { family: "'DM Mono', monospace", size: 10 }, callback: (v) => `${v}%` }, title: { display: true, text: '% of FGA', color: '#888', font: { family: "'DM Mono', monospace", size: 9 } } },
                        },
                      }
                      return (
                        <div className="shot-diet-section">
                          <h2 className="panel-title">Shot diet analysis</h2>
                          <div className="shot-summary">
                            <div className="shot-metric"><span className="metric-label">Baseline FG%</span><span className="metric-value">{(shotDiet.fg_pct_a * 100).toFixed(1)}%</span></div>
                            <div className="shot-metric"><span className="metric-label">Comparison FG%</span><span className="metric-value">{(shotDiet.fg_pct_b * 100).toFixed(1)}%</span><span className={`metric-sub metric-delta ${shotDiet.delta >= 0 ? 'pos' : 'neg'}`}>{shotDiet.delta >= 0 ? '+' : ''}{(shotDiet.delta * 100).toFixed(1)}pp</span></div>
                            <div className="shot-metric"><span className="metric-label">Selection effect</span><span className={`metric-value ${shotDiet.diet_total >= 0 ? 'pos' : 'neg'}`}>{shotDiet.diet_total >= 0 ? '+' : ''}{(shotDiet.diet_total * 100).toFixed(1)}pp</span><span className="metric-sub">shot mix shift</span></div>
                            <div className="shot-metric"><span className="metric-label">Efficiency effect</span><span className={`metric-value ${shotDiet.efficiency_total >= 0 ? 'pos' : 'neg'}`}>{shotDiet.efficiency_total >= 0 ? '+' : ''}{(shotDiet.efficiency_total * 100).toFixed(1)}pp</span><span className="metric-sub">zone accuracy</span></div>
                          </div>
                          <div className="shot-diet-body">
                            <div className="courts-row">
                              <div className="court-wrap"><div className="court-label">Baseline</div><CourtDiagram zones={courtZonesA} period={`${result.period_a.start} – ${result.period_a.end}`} /></div>
                              <div className="court-wrap"><div className="court-label">Comparison</div><CourtDiagram zones={courtZonesB} period={`${result.period_b.start} – ${result.period_b.end}`} /></div>
                            </div>
                            <div className="attempt-chart-wrap"><Bar data={attemptChartData} options={attemptChartOptions} /></div>
                          </div>
                          <table className="shot-table">
                            <thead><tr><th>Zone</th><th className="num">Baseline freq</th><th className="num">Baseline FG%</th><th className="num">Comp freq</th><th className="num">Comp FG%</th><th className="num">Selection FG% impact</th><th className="num">Efficiency FG% impact</th></tr></thead>
                            <tbody>
                              {zoneRows.filter(z => z.fga_a > 0 || z.fga_b > 0).map(z => {
                                const fgShift = Math.round((z.fg_pct_b - z.fg_pct_a) * 100)
                                const freqShift = Math.round((z.freq_b - z.freq_a) * 100)
                                return (
                                  <tr key={z.zone}>
                                    <td>{ZONE_LABELS[z.zone]}</td>
                                    <td className="num mono">{z.freq_a > 0 ? `${Math.round(z.freq_a * 100)}%` : '—'}</td>
                                    <td className="num mono">{z.fga_a > 0 ? `${Math.round(z.fg_pct_a * 100)}%` : '—'}</td>
                                    <td className="num mono">{z.freq_b > 0 ? `${Math.round(z.freq_b * 100)}% (${freqShift >= 0 ? '+' : ''}${freqShift}%)` : '—'}</td>
                                    <td className="num mono">{z.fga_b > 0 ? `${Math.round(z.fg_pct_b * 100)}% (${fgShift >= 0 ? '+' : ''}${fgShift}%)` : '—'}</td>
                                    <td className={`num mono ${z.diet_effect >= 0 ? 'pos' : 'neg'}`}>{z.diet_effect >= 0 ? '+' : ''}{(z.diet_effect * 100).toFixed(1)}</td>
                                    <td className={`num mono ${z.efficiency_effect >= 0 ? 'pos' : 'neg'}`}>{z.efficiency_effect >= 0 ? '+' : ''}{(z.efficiency_effect * 100).toFixed(1)}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )
                    })()}
                  </div>
                )}
                </>
              )}
            </div>

            {/* ── Projection controls + trend chart ────────── */}
            {projection && (
              <div className="projection-section">
                <div className="projection-header" onClick={() => setProjExpanded(e => !e)} style={{ cursor: 'pointer' }}>
                  <h3 className="panel-title">Career Projection</h3>
                  <span className="proj-toggle">{projExpanded ? '▲' : '▼'}</span>
                </div>

                {projExpanded && <>
                <div className="mpg-slider-row">
                  <span className="ctrl-label">Projected min/game</span>
                  <input
                    type="range"
                    min={10} max={40} step={0.5}
                    value={projMpg}
                    onChange={e => setProjMpg(+e.target.value)}
                    className="mpg-slider"
                  />
                  <span className="mpg-value">{projMpg.toFixed(1)}</span>
                </div>

                <div className="trend-controls">
                  <span className="ctrl-label">Stat</span>
                  <select
                    className="ctrl-input"
                    value={projStat}
                    onChange={e => setProjStat(e.target.value)}
                  >
                    {PROJ_STAT_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div className="trend-chart-wrap">
                  {trendChartData && <Line data={trendChartData} options={trendChartOptions} />}
                </div>
                </>}
              </div>
            )}

            {/* ── Moving average chart ──────────────────────── */}
            {playerGames && (
              <div className="projection-section">
                <div className="projection-header" onClick={() => setMaExpanded(e => !e)} style={{ cursor: 'pointer' }}>
                  <h3 className="panel-title">Form</h3>
                  <span className="proj-toggle">{maExpanded ? '▲' : '▼'}</span>
                </div>

                {maExpanded && <>
                <div className="trend-controls">
                  <span className="ctrl-label">Stat</span>
                  <select className="ctrl-input" value={maStat} onChange={e => setMaStat(e.target.value)}>
                    {MA_STAT_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <span className="ctrl-label" style={{ marginLeft: '1rem' }}>Weighted Average Period</span>
                  <select className="ctrl-input" value={maWindow} onChange={e => setMaWindow(+e.target.value)}>
                    {MA_WINDOW_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                {maAllGames.length > 0 && (
                  <div className="mpg-slider-row">
                    <span className="ctrl-label">Period</span>
                    <input
                      type="range"
                      min={20}
                      max={maAllGames.length}
                      step={5}
                      value={maLookback ?? maAllGames.length}
                      onChange={e => {
                        const v = +e.target.value
                        setMaLookback(v >= maAllGames.length ? null : v)
                      }}
                      className="mpg-slider"
                    />
                    <span className="mpg-value">
                      {maLookback ? `Last ${maLookback} games` : 'All time'}
                    </span>
                  </div>
                )}
                <div className="trend-chart-wrap" style={{ height: '260px' }}>
                  {maChartData && <Line data={maChartData} options={maChartOptions} />}
                </div>
                </>}
              </div>
            )}

            {/* ── Game log ──────────────────────────────────── */}
            {playerGames && playerGames.length > 0 && (
              <div className="projection-section">
                <div className="projection-header" onClick={() => setGlExpanded(e => !e)} style={{ cursor: 'pointer' }}>
                  <h3 className="panel-title">Game Log</h3>
                  <span className="proj-toggle">{glExpanded ? '▲' : '▼'}</span>
                </div>
                {glExpanded && (() => {
                  const visibleGames = [...playerGames].reverse().slice(
                    playerGames.length - 1 - glEnd,
                    playerGames.length - glStart
                  )
                  return (
                    <>
                    <div className="mpg-slider-row">
                      <span className="ctrl-label">From</span>
                      <input
                        type="range"
                        min={0} max={glEnd} step={10}
                        value={glStart}
                        onChange={e => setGlStart(+e.target.value)}
                        className="mpg-slider"
                      />
                      <span className="mpg-value">{playerGames.length - glStart} games ago</span>
                    </div>
                    <div className="mpg-slider-row">
                      <span className="ctrl-label">To</span>
                      <input
                        type="range"
                        min={glStart} max={playerGames.length - 1} step={10}
                        value={glEnd}
                        onChange={e => setGlEnd(+e.target.value)}
                        className="mpg-slider"
                      />
                      <span className="mpg-value">{playerGames.length - 1 - glEnd === 0 ? 'latest' : `${playerGames.length - 1 - glEnd} games ago`}</span>
                    </div>
                    <div className="table-scroll">
                      <table className="gamelog-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Opp</th>
                            <th className="num">Min</th>
                            <th className="num">Pts</th>
                            <th className="num">Reb</th>
                            <th className="num">Ast</th>
                            <th className="num">Stl</th>
                            <th className="num">Blk</th>
                            <th className="num">Tov</th>
                            <th className="num">FG</th>
                            <th className="num">FG%</th>
                            <th className="num">3P</th>
                            <th className="num">3P%</th>
                            <th className="num">FT</th>
                            <th className="num">FT%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleGames.map((g, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'row-even' : ''}>
                              <td className="mono">{g.game_date}</td>
                              <td>
                                <span className="opp-cell">
                                  <span className="ha-badge">{g.home_away}</span>
                                  {g.opponent}
                                </span>
                              </td>
                              <td className="num mono">{g.min}</td>
                              <td className="num mono">{g.pts}</td>
                              <td className="num mono">{g.reb}</td>
                              <td className="num mono">{g.ast}</td>
                              <td className="num mono">{g.stl}</td>
                              <td className="num mono">{g.blk}</td>
                              <td className="num mono">{g.tov}</td>
                              <td className="num mono">{g.fgm}-{g.fga}</td>
                              <td className="num mono">{g.fg_pct != null ? g.fg_pct + '%' : '—'}</td>
                              <td className="num mono">{g.fg3m}-{g.fg3a}</td>
                              <td className="num mono">{g.fg3a > 0 ? (g.fg3m / g.fg3a * 100).toFixed(0) + '%' : '—'}</td>
                              <td className="num mono">{g.ftm}-{g.fta}</td>
                              <td className="num mono">{g.ft_pct != null ? g.ft_pct + '%' : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    </>
                  )
                })()}
              </div>
            )}

            {/* ── Aging curves table ────────────────────────── */}
            {agingCurves && (
              <div className="projection-section">
                <div className="projection-header" onClick={() => setAgingExpanded(e => !e)} style={{ cursor: 'pointer' }}>
                  <h3 className="panel-title">Aging Curves</h3>
                  <span className="proj-toggle">{agingExpanded ? '▲' : '▼'}</span>
                </div>

                {agingExpanded && (() => {
                  const rows = agingCurves[agingArchetype] ?? []
                  const colRanges = AGING_COLS.reduce((acc, c) => {
                    const vals = rows.map(r => r[c.key]).filter(v => v !== null)
                    acc[c.key] = { min: Math.min(...vals), max: Math.max(...vals) }
                    return acc
                  }, {})
                  return (
                    <>
                    <div className="aging-tabs">
                      {Object.keys(agingCurves).map(a => (
                        <button
                          key={a}
                          className={`aging-tab${agingArchetype === a ? ' active' : ''}`}
                          onClick={() => setAgingArchetype(a)}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                    <div className="table-scroll">
                      <table className="stats-table aging-table">
                        <thead>
                          <tr>
                            <th className="num">Age</th>
                            <th className="num muted">n</th>
                            {AGING_COLS.map(c => <th key={c.key} className="num">{c.label}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(row => (
                            <tr key={row.age}>
                              <td className="num mono" style={{ fontWeight: 600 }}>{row.age}</td>
                              <td className="num mono muted" style={{ fontSize: '11px' }}>{row.n}</td>
                              {AGING_COLS.map(c => (
                                <td
                                  key={c.key}
                                  className="num mono"
                                  style={heatColor(row[c.key], colRanges[c.key].min, colRanges[c.key].max, c.reverse)}
                                >
                                  {row[c.key] ?? '—'}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    </>
                  )
                })()}
              </div>
            )}


          </div>
        )}

        {false && result && selectedPlayer && (
          <>
            {/* ── Metrics row ──────────────────────────────── */}
            <div className="metrics-row">
              <div className="metric-card">
                <span className="metric-label">Baseline</span>
                <span className="metric-value">{result.period_a.value.toFixed(1)}</span>
                <span className="metric-sub">{statLabelShort}</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Comparison</span>
                <span className="metric-value">{result.period_b.value.toFixed(1)}</span>
                <span className={`metric-sub metric-delta ${result.delta >= 0 ? 'pos' : 'neg'}`}>
                  {result.delta >= 0 ? '+' : ''}{result.delta.toFixed(2)}&ensp;
                  ({result.delta >= 0 ? '+' : ''}{((result.delta / result.period_a.value) * 100).toFixed(1)}%)
                </span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Rate change</span>
                <span className={`metric-value ${skillSum >= 0 ? 'pos' : 'neg'}`}>
                  {skillSum >= 0 ? '+' : ''}{skillSum.toFixed(2)}
                </span>
                <span className="metric-sub">rate changes</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Role</span>
                <span className={`metric-value ${roleSum >= 0 ? 'pos' : 'neg'}`}>
                  {roleSum >= 0 ? '+' : ''}{roleSum.toFixed(2)}
                </span>
                <span className="metric-sub">minutes / usage</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Pace</span>
                <span className={`metric-value ${luckSum >= 0 ? 'pos' : 'neg'}`}>
                  {luckSum >= 0 ? '+' : ''}{luckSum.toFixed(2)}
                </span>
                <span className="metric-sub">external factors</span>
              </div>
            </div>

            {/* ── Legend ───────────────────────────────────── */}
            <div className="chart-legend">
              {LEGEND_ITEMS.map((item) => (
                <span key={item.label} className="legend-item">
                  <span className="legend-dot" style={{ background: item.color }} />
                  {item.label}
                </span>
              ))}
            </div>

            {/* ── Waterfall chart ───────────────────────────── */}
            <div className="chart-wrap">
              <Bar data={chartData} options={chartOptions} plugins={[labelPlugin]} />
            </div>

            {/* ── Driver table + Insights ───────────────────── */}
            <div className="analysis-row">
              <div className="breakdown-panel">
                <h2 className="panel-title">Driver breakdown</h2>
                <table className="drivers-table">
                  <thead>
                    <tr>
                      <th>Driver</th>
                      <th className="num">Change</th>
                      <th className="num">Attribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...result.drivers]
                      .sort((a, b) => (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99))
                      .map((d) => {
                        const catColor = CATEGORY_COLORS[d.category] ?? '#888'
                        const barColor = CATEGORY_COLORS[d.category] ?? '#888'
                        const barPct   = (Math.abs(d.contribution) / maxContrib) * 100
                        return (
                          <tr key={d.key}>
                            <td className="driver-cell">
                              <span className="driver-name">{d.label}</span>
                              <span
                                className="cat-pill"
                                style={{ background: catColor + '20', color: catColor, borderColor: catColor + '40' }}
                              >
                                {CATEGORY_DISPLAY[d.category] ?? d.category}
                              </span>
                            </td>
                            <td className={`num change-val ${d.contribution >= 0 ? 'pos' : 'neg'}`}>
                              {d.contribution >= 0 ? '+' : ''}{d.contribution.toFixed(2)}
                            </td>
                            <td className="attribution-cell">
                              <div
                                className="attr-bar"
                                style={{ width: `${barPct}%`, background: barColor }}
                              />
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>

              <div className="insights-panel">
                <h2 className="panel-title">Key insights</h2>
                <ul className="insights-list">
                  {insights.map((ins, i) => (
                    <li key={i}>
                      <span className="insight-dot" />
                      {ins}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            {shotDiet && (stat === 'pts' || stat === 'fg3m') && (() => {
              // Build per-zone data for courts + bar chart
              const zoneRows = ZONE_ORDER.map(zk => {
                const z = shotDiet.zones.find(r => r.zone === zk) || {
                  zone: zk, label: ZONE_LABELS[zk],
                  fga_a: 0, fga_b: 0, fg_pct_a: 0, fg_pct_b: 0,
                  freq_a: 0, freq_b: 0,
                  diet_effect: 0, efficiency_effect: 0,
                }
                return { ...z, net: z.diet_effect + z.efficiency_effect }
              })

              const courtZonesA = zoneRows.map(z => ({
                zone: z.zone, fg_pct: z.fg_pct_a, fga: z.fga_a, freq: z.freq_a, net: z.net,
              }))
              const courtZonesB = zoneRows.map(z => ({
                zone: z.zone, fg_pct: z.fg_pct_b, fga: z.fga_b, freq: z.freq_b, net: z.net,
              }))

              const zoneLabels  = zoneRows.map(z => ZONE_LABELS[z.zone])
              const attemptChartData = {
                labels: zoneLabels,
                datasets: [
                  {
                    label: 'Baseline',
                    data: zoneRows.map(z => z.freq_a ? +(z.freq_a * 100).toFixed(1) : 0),
                    backgroundColor: '#3a4470',
                    borderRadius: 2,
                  },
                  {
                    label: 'Comparison',
                    data: zoneRows.map(z => z.freq_b ? +(z.freq_b * 100).toFixed(1) : 0),
                    backgroundColor: '#4dffb4',
                    borderRadius: 2,
                  },
                ],
              }

              const attemptChartOptions = {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    display: true,
                    labels: {
                      color: '#555',
                      font: { family: "'DM Mono', monospace", size: 10 },
                      boxWidth: 10,
                    },
                  },
                  tooltip: {
                    backgroundColor: '#1c1c1c',
                    borderColor: '#2a2a2a',
                    borderWidth: 1,
                    titleColor: '#555',
                    bodyColor: '#e8e8e8',
                    titleFont: { family: "'DM Mono', monospace", size: 10 },
                    bodyFont:  { family: "'DM Mono', monospace", size: 12 },
                    padding: 10,
                    cornerRadius: 4,
                  },
                  datalabels: {
                    labels: {
                      count: {
                        anchor: 'end',
                        align: 'end',
                        formatter: (val) => val > 0 ? `${Math.round(val)}%` : null,
                        color: '#9aa0b8',
                        font: { family: "'DM Mono', monospace", size: 9 },
                      },
                      pct: {
                        anchor: 'center',
                        align: 'center',
                        formatter: (val, ctx) => {
                          if (val === 0) return null
                          const z = zoneRows[ctx.dataIndex]
                          if (!z) return null
                          const pct = ctx.datasetIndex === 0 ? z.fg_pct_a : z.fg_pct_b
                          const fga = ctx.datasetIndex === 0 ? z.fga_a : z.fga_b
                          return fga > 0 ? `${Math.round(pct * 100)}FG%` : null
                        },
                        color: (ctx) => ctx.datasetIndex === 0 ? 'rgba(255,255,255,0.75)' : '#0d1a14',
                        font: { family: "'DM Mono', monospace", size: 9, weight: '500' },
                      },
                    },
                  },
                },
                scales: {
                  x: {
                    grid: { color: '#1a1a1a', drawTicks: false },
                    border: { color: '#222' },
                    ticks: { color: '#888', font: { family: "'DM Mono', monospace", size: 10 } },
                  },
                  y: {
                    grid: { color: '#1a1a1a' },
                    border: { color: '#222' },
                    ticks: {
                      color: '#888',
                      font: { family: "'DM Mono', monospace", size: 10 },
                      callback: (v) => `${v}%`,
                    },
                    title: { display: true, text: '% of FGA', color: '#888', font: { family: "'DM Mono', monospace", size: 9 } },
                  },
                },
              }

              return (
                <div className="shot-diet-section">
                  <h2 className="panel-title">Shot diet analysis</h2>

                  {/* Summary metrics */}
                  <div className="shot-summary">
                    <div className="shot-metric">
                      <span className="metric-label">Baseline FG%</span>
                      <span className="metric-value">{(shotDiet.fg_pct_a * 100).toFixed(1)}%</span>
                    </div>
                    <div className="shot-metric">
                      <span className="metric-label">Comparison FG%</span>
                      <span className="metric-value">{(shotDiet.fg_pct_b * 100).toFixed(1)}%</span>
                      <span className={`metric-sub metric-delta ${shotDiet.delta >= 0 ? 'pos' : 'neg'}`}>
                        {shotDiet.delta >= 0 ? '+' : ''}{(shotDiet.delta * 100).toFixed(1)}pp
                      </span>
                    </div>
                    <div className="shot-metric">
                      <span className="metric-label">Selection effect</span>
                      <span className={`metric-value ${shotDiet.diet_total >= 0 ? 'pos' : 'neg'}`}>
                        {shotDiet.diet_total >= 0 ? '+' : ''}{(shotDiet.diet_total * 100).toFixed(1)}pp
                      </span>
                      <span className="metric-sub">shot mix shift</span>
                    </div>
                    <div className="shot-metric">
                      <span className="metric-label">Efficiency effect</span>
                      <span className={`metric-value ${shotDiet.efficiency_total >= 0 ? 'pos' : 'neg'}`}>
                        {shotDiet.efficiency_total >= 0 ? '+' : ''}{(shotDiet.efficiency_total * 100).toFixed(1)}pp
                      </span>
                      <span className="metric-sub">zone accuracy</span>
                    </div>
                  </div>

                  {/* Courts + bar chart */}
                  <div className="shot-diet-body">
                    <div className="courts-row">
                      <div className="court-wrap">
                        <div className="court-label">Baseline</div>
                        <CourtDiagram zones={courtZonesA} period={`${result.period_a.start} – ${result.period_a.end}`} />
                      </div>
                      <div className="court-wrap">
                        <div className="court-label">Comparison</div>
                        <CourtDiagram zones={courtZonesB} period={`${result.period_b.start} – ${result.period_b.end}`} />
                      </div>
                    </div>
                    <div className="attempt-chart-wrap">
                      <Bar data={attemptChartData} options={attemptChartOptions} />
                    </div>
                  </div>

                  {/* Zone detail table */}
                  <table className="shot-table">
                    <thead>
                      <tr>
                        <th>Zone</th>
                        <th className="num">Baseline freq</th>
                        <th className="num">Baseline FG%</th>
                        <th className="num">Comp freq</th>
                        <th className="num">Comp FG%</th>
                        <th className="num">Selection FG% impact</th>
                        <th className="num">Efficiency FG% impact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zoneRows.filter(z => z.fga_a > 0 || z.fga_b > 0).map(z => {
                        const fgShift   = Math.round((z.fg_pct_b - z.fg_pct_a) * 100)
                        const freqShift = Math.round((z.freq_b - z.freq_a) * 100)
                        return (
                          <tr key={z.zone}>
                            <td>{ZONE_LABELS[z.zone]}</td>
                            <td className="num mono">{z.freq_a > 0 ? `${Math.round(z.freq_a * 100)}%` : '—'}</td>
                            <td className="num mono">{z.fga_a > 0 ? `${Math.round(z.fg_pct_a * 100)}%` : '—'}</td>
                            <td className="num mono">{z.freq_b > 0 ? `${Math.round(z.freq_b * 100)}% (${freqShift >= 0 ? '+' : ''}${freqShift}%)` : '—'}</td>
                            <td className="num mono">{z.fga_b > 0 ? `${Math.round(z.fg_pct_b * 100)}% (${fgShift >= 0 ? '+' : ''}${fgShift}%)` : '—'}</td>
                            <td className={`num mono ${z.diet_effect >= 0 ? 'pos' : 'neg'}`}>
                              {z.diet_effect >= 0 ? '+' : ''}{(z.diet_effect * 100).toFixed(1)}
                            </td>
                            <td className={`num mono ${z.efficiency_effect >= 0 ? 'pos' : 'neg'}`}>
                              {z.efficiency_effect >= 0 ? '+' : ''}{(z.efficiency_effect * 100).toFixed(1)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })()}

            {gameLog && gameLog.length > 0 && (
              <div className="gamelog-section">
                <h2 className="panel-title">Game log</h2>
                <div className="gamelog-wrap">
                  <table className="gamelog-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Opp</th>
                        <th className="num">Min</th>
                        <th className="num">Pts</th>
                        <th className="num">Reb</th>
                        <th className="num">Ast</th>
                        <th className="num">Stl</th>
                        <th className="num">Blk</th>
                        <th className="num">Tov</th>
                        <th className="num">FG</th>
                        <th className="num">FG%</th>
                        <th className="num">3P</th>
                        <th className="num">3P%</th>
                        <th className="num">FT</th>
                        <th className="num">FT%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gameLog.map((g, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'row-even' : ''}>
                          <td className="mono">{g.game_date}</td>
                          <td>
                            <span className="opp-cell">
                              <span className="ha-badge">{g.home_away}</span>
                              {g.opponent}
                            </span>
                          </td>
                          <td className="num mono">{g.min}</td>
                          <td className="num mono">{g.pts}</td>
                          <td className="num mono">{g.reb}</td>
                          <td className="num mono">{g.ast}</td>
                          <td className="num mono">{g.stl}</td>
                          <td className="num mono">{g.blk}</td>
                          <td className="num mono">{g.tov}</td>
                          <td className="num mono">{g.fgm}-{g.fga}</td>
                          <td className="num mono">{g.fga > 0 ? (g.fgm / g.fga * 100).toFixed(0) + '%' : '—'}</td>
                          <td className="num mono">{g.fg3m}-{g.fg3a}</td>
                          <td className="num mono">{g.fg3a > 0 ? (g.fg3m / g.fg3a * 100).toFixed(0) + '%' : '—'}</td>
                          <td className="num mono">{g.ftm}-{g.fta}</td>
                          <td className="num mono">{g.fta > 0 ? (g.ftm / g.fta * 100).toFixed(0) + '%' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </>}

      </main>
    </>
  )
}
