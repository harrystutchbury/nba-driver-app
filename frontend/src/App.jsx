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
  Filler,
} from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import './App.css'

ChartJS.register(CategoryScale, LinearScale, RadialLinearScale, BarElement, LineElement, PointElement, Tooltip, Legend, Filler, ChartDataLabels)

// ── Auth helper ───────────────────────────────────────────────────────────────

function apiFetch(url, opts = {}) {
  const token = localStorage.getItem('nba_token')
  const headers = { ...(opts.headers || {}) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return fetch(url, { ...opts, headers }).then(res => {
    if (res.status === 401) {
      localStorage.removeItem('nba_token')
      window.location.reload()
    }
    return res
  })
}

// ── Account settings modal ────────────────────────────────────────────────────

// ── Fantasy connections section (inside Account modal) ─────────────────────────

function FantasyConnectionsSection() {
  const [status,   setStatus]   = useState(null)
  const [espnS2,   setEspnS2]   = useState('')
  const [swid,     setSwid]     = useState('')
  const [leagueId, setLeagueId] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [msg,      setMsg]      = useState(null)

  useEffect(() => { loadStatus() }, [])

  function loadStatus() {
    apiFetch('/api/fantasy/status').then(r => r.ok ? r.json() : null).then(d => { if (d) setStatus(d) }).catch(() => {})
  }

  async function handleEspnConnect(e) {
    e.preventDefault(); setLoading(true); setMsg(null)
    try {
      const res = await apiFetch('/api/fantasy/espn/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ espn_s2: espnS2, swid, league_id: leagueId }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed') }
      setShowForm(false); setEspnS2(''); setSwid(''); setLeagueId('')
      setMsg({ type: 'ok', text: 'ESPN connected! Visit the Fantasy tab to select your team.' })
      loadStatus()
    } catch (e) { setMsg({ type: 'err', text: e.message }) }
    setLoading(false)
  }

  async function handleEspnDisconnect() {
    if (!confirm('Disconnect ESPN Fantasy?')) return
    await apiFetch('/api/fantasy/espn/disconnect', { method: 'DELETE' })
    loadStatus()
  }

  async function handleYahooConnect() {
    setLoading(true)
    try {
      const res = await apiFetch('/api/fantasy/yahoo/auth-url')
      if (!res.ok) throw new Error()
      const { url } = await res.json()
      window.location.href = url
    } catch { setMsg({ type: 'err', text: 'Could not start Yahoo auth' }); setLoading(false) }
  }

  async function handleYahooDisconnect() {
    if (!confirm('Disconnect Yahoo Fantasy?')) return
    await apiFetch('/api/fantasy/disconnect', { method: 'DELETE' })
    loadStatus()
  }

  if (!status) return <p className="modal-loading">Loading…</p>

  const espn  = status.espn  || {}
  const yahoo = status.yahoo || {}

  return (
    <div className="acct-fantasy-section">
      <div className="acct-section-title">Fantasy Connections</div>
      {msg && <div className={msg.type === 'ok' ? 'acct-ok' : 'login-error'} style={{marginBottom:8}}>{msg.text}</div>}

      {/* ESPN */}
      <div className="acct-provider-row">
        <span className="acct-provider-name">ESPN</span>
        {espn.connected ? (
          <div className="acct-provider-connected">
            <span className="acct-connected-badge">Connected ✓</span>
            <button className="acct-disconnect-btn" onClick={handleEspnDisconnect}>Disconnect</button>
          </div>
        ) : (
          <button className="acct-connect-btn" onClick={() => setShowForm(s => !s)}>
            {showForm ? 'Cancel' : 'Connect ESPN'}
          </button>
        )}
      </div>
      {showForm && !espn.connected && (
        <form onSubmit={handleEspnConnect} className="acct-espn-form">
          <p className="fantasy-connect-sub">In Chrome on espn.com: DevTools → Application → Cookies → copy <code>espn_s2</code> and <code>SWID</code>.</p>
          <input className="login-input" type="text" placeholder="espn_s2 cookie" value={espnS2} onChange={e => setEspnS2(e.target.value)} />
          <input className="login-input" type="text" placeholder="SWID cookie  {xxxx-...}" value={swid} onChange={e => setSwid(e.target.value)} />
          <input className="login-input" type="text" placeholder="League ID (from URL)" value={leagueId} onChange={e => setLeagueId(e.target.value)} />
          <button className="login-btn" type="submit" disabled={loading || !espnS2 || !swid || !leagueId}>
            {loading ? 'Connecting…' : 'Connect'}
          </button>
        </form>
      )}

      {/* Yahoo */}
      <div className="acct-provider-row">
        <span className="acct-provider-name">Yahoo</span>
        {yahoo.connected ? (
          <div className="acct-provider-connected">
            <span className="acct-connected-badge">Connected ✓</span>
            <button className="acct-disconnect-btn" onClick={handleYahooDisconnect}>Disconnect</button>
          </div>
        ) : (
          <button className="acct-connect-btn" onClick={handleYahooConnect} disabled={loading}>
            Connect Yahoo
          </button>
        )}
      </div>
    </div>
  )
}

function AccountModal({ onClose, onTokenRefresh }) {
  const [me,          setMe]          = useState(null)
  const [displayName, setDisplayName] = useState('')
  const [email,       setEmail]       = useState('')
  const [curPw,       setCurPw]       = useState('')
  const [newPw,       setNewPw]       = useState('')
  const [saving,      setSaving]      = useState(false)
  const [msg,         setMsg]         = useState(null) // {type:'ok'|'err', text}

  useEffect(() => {
    apiFetch('/api/auth/me').then(r => r.json()).then(d => {
      setMe(d)
      setEmail(d.email)
      setDisplayName(d.display_name || '')
    }).catch(() => {})
  }, [])

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    const body = {}
    if (displayName !== (me?.display_name || '')) body.display_name = displayName
    if (email !== me?.email) { body.email = email; body.current_password = curPw }
    if (newPw) { body.new_password = newPw; body.current_password = curPw }
    if (!Object.keys(body).length) { setSaving(false); setMsg({ type: 'ok', text: 'Nothing to change' }); return }

    try {
      const res = await apiFetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setMsg({ type: 'err', text: data.detail || 'Save failed' }); setSaving(false); return }
      onTokenRefresh(data.token)
      setCurPw(''); setNewPw('')
      setMe(prev => ({ ...prev, email: email, display_name: displayName }))
      setMsg({ type: 'ok', text: 'Saved' })
    } catch {
      setMsg({ type: 'err', text: 'Request failed — please try again' })
    }
    setSaving(false)
  }

  const needsCurPw = email !== (me?.email || '') || !!newPw

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Account</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {!me ? <p className="modal-loading">Loading…</p> : (
          <form onSubmit={handleSave} className="acct-form">
            <label className="acct-label">Display name</label>
            <input className="login-input" type="text" value={displayName}
              onChange={e => setDisplayName(e.target.value)} placeholder="Your name" />

            <label className="acct-label">Email</label>
            <input className="login-input" type="email" value={email}
              onChange={e => setEmail(e.target.value)} autoComplete="email" />

            <label className="acct-label">New password <span className="acct-optional">(leave blank to keep)</span></label>
            <input className="login-input" type="password" value={newPw}
              onChange={e => setNewPw(e.target.value)} autoComplete="new-password" placeholder="New password" />

            {needsCurPw && <>
              <label className="acct-label">Current password <span className="acct-required">required</span></label>
              <input className="login-input" type="password" value={curPw}
                onChange={e => setCurPw(e.target.value)} autoComplete="current-password" placeholder="Current password" />
            </>}

            {msg && <div className={msg.type === 'ok' ? 'acct-ok' : 'login-error'}>{msg.text}</div>}

            <button className="login-btn" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        )}
        <FantasyConnectionsSection />
      </div>
    </div>
  )
}

// ── Login page ────────────────────────────────────────────────────────────────

function LoginPage({ onLogin }) {
  const resetToken = new URLSearchParams(window.location.search).get('reset_token')
  const [username,  setUsername]  = useState('')
  const [password,  setPassword]  = useState('')
  const [error,     setError]     = useState(null)
  const [info,      setInfo]      = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [mode,      setMode]      = useState(resetToken ? 'reset' : 'login')

  function setModeClean(m) { setMode(m); setError(null); setInfo(null) }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); setError(null); setInfo(null)

    if (mode === 'forgot') {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: username }),
      }).catch(() => null)
      setLoading(false)
      setInfo('If that email is registered you\'ll receive a reset link shortly.')
      return
    }

    if (mode === 'reset') {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, password }),
      }).catch(() => null)
      if (!res?.ok) {
        const data = await res?.json().catch(() => ({}))
        setError(data?.detail || 'Reset failed — the link may have expired')
        setLoading(false); return
      }
      const { token } = await res.json()
      window.history.replaceState({}, '', '/')
      onLogin(token)
      return
    }

    const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login'
    const res = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).catch(() => null)
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}))
      setError(data?.detail || (mode === 'register' ? 'Registration failed — please try again' : 'Invalid email or password'))
      setLoading(false); return
    }
    const { token } = await res.json()
    onLogin(token)
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">NBA Driver</h1>
        <p className="login-subtitle">Fantasy basketball intelligence</p>
        <form onSubmit={handleSubmit} className="login-form">
          {mode === 'reset' ? <>
            <p className="login-reset-hint">Enter your new password below.</p>
            <input className="login-input" type="password" placeholder="New password"
              value={password} onChange={e => setPassword(e.target.value)} autoFocus autoComplete="new-password" />
          </> : <>
            <input className="login-input" type="email" placeholder="Email"
              value={username} onChange={e => setUsername(e.target.value)} autoFocus autoComplete="email" />
            {mode !== 'forgot' && (
              <input className="login-input" type="password" placeholder="Password"
                value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
            )}
          </>}
          {error && <div className="login-error">{error}</div>}
          {info  && <div className="acct-ok">{info}</div>}
          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? '…' : mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Set new password' : 'Sign in'}
          </button>
        </form>
        <div className="login-footer">
          {mode === 'login' && <>
            <button className="login-toggle" onClick={() => setModeClean('forgot')}>Forgot password?</button>
            <button className="login-toggle" onClick={() => setModeClean('register')}>Create an account</button>
          </>}
          {mode !== 'login' && mode !== 'reset' && (
            <button className="login-toggle" onClick={() => setModeClean('login')}>← Back to sign in</button>
          )}
        </div>
      </div>
    </div>
  )
}

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

const POS_SHORT = {
  'Guard': 'G', 'Forward': 'F', 'Center': 'C',
  'Guard-Forward': 'G/F', 'Forward-Center': 'F/C',
}
function posAbbr(pos) { return POS_SHORT[pos] || pos || '—' }

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
  const labels       = ['Baseline', ...drivers.map(d => LABEL_DISPLAY[d.label] ?? d.label), 'Comparison']
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
  tipLabels.push(`Comparison: ${period_b.value.toFixed(2)}`)
  displayLabels.push(period_b.value.toFixed(1))

  return { labels, floatData, barData, colors, tipLabels, displayLabels }
}

function generateInsights(result, statLabel) {
  const pct        = ((result.delta / result.period_a.value) * 100)
  const skillSum   = result.drivers.filter(d => d.category === 'skill').reduce((s, d) => s + d.contribution, 0)
  const luckSum    = result.drivers.filter(d => d.category === 'opponent' || d.category === 'team').reduce((s, d) => s + d.contribution, 0)
  const roleSum    = result.drivers.filter(d => d.category === 'role').reduce((s, d) => s + d.contribution, 0)
  const sorted     = [...result.drivers].sort((a, b) => b.contribution - a.contribution)
  const biggestPos = sorted.find(d => d.contribution > 0)
  const biggestNeg = [...sorted].reverse().find(d => d.contribution < 0)
  const sd         = result.schedule_difficulty

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

  // Schedule difficulty insight
  if (sd) {
    const diff    = sd.period_a - sd.period_b  // positive = A easier, B harder
    const pctDiff = Math.abs(diff) * 100
    const improved = result.delta > 0
    if (pctDiff >= 2) {
      const pctStr = pctDiff.toFixed(0)
      if (diff > 0 && improved)
        ins.push(`Schedule difficulty: the comparison period faced harder opposition (${pctStr}% fewer ${statLabel} allowed to ${sd.position}s). The improvement came despite this headwind — suggesting a genuine performance gain.`)
      else if (diff < 0 && improved)
        ins.push(`Schedule difficulty: the comparison period faced easier opposition (${pctStr}% more ${statLabel} allowed to ${sd.position}s). This may partially explain the improvement — treat with some caution.`)
      else if (diff > 0 && !improved)
        ins.push(`Schedule difficulty: the comparison period faced harder opposition (${pctStr}% fewer ${statLabel} allowed to ${sd.position}s). This may partially explain the decline.`)
      else
        ins.push(`Schedule difficulty: the comparison period faced easier opposition (${pctStr}% more ${statLabel} allowed to ${sd.position}s) yet ${statLabel} still declined — suggesting a genuine performance drop.`)
    } else {
      ins.push(`Schedule difficulty was similar across both periods for ${sd.position} ${statLabel} — the change reflects genuine performance.`)
    }
  }

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
    const net = z.net
    const intensity = Math.min(Math.abs(net) / 0.03, 1)
    const alpha = 0.15 + intensity * 0.4
    // Pre-blend with dark background (#141828 = rgb(20,24,40)) so stacked zones don't mix
    const bg = [20, 24, 40]
    if (net > 0.002) {
      const fg = [77, 255, 180]
      return `rgb(${Math.round(fg[0]*alpha+bg[0]*(1-alpha))},${Math.round(fg[1]*alpha+bg[1]*(1-alpha))},${Math.round(fg[2]*alpha+bg[2]*(1-alpha))})`
    }
    if (net < -0.002) {
      const fg = [255, 107, 107]
      return `rgb(${Math.round(fg[0]*alpha+bg[0]*(1-alpha))},${Math.round(fg[1]*alpha+bg[1]*(1-alpha))},${Math.round(fg[2]*alpha+bg[2]*(1-alpha))})`
    }
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
    return `${(freq * 100).toFixed(0)}%`
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
      {/* Free throw circle — upper semicircle only (dashed) */}
      <path d="M 190,190 A 60,60 0 0,1 310,190" fill="none" stroke={stroke} strokeWidth={1} strokeDasharray="4 4" />
      {/* Free throw line */}
      <line x1={160} y1={190} x2={340} y2={190} stroke={stroke} strokeWidth={1.5} />

      {/* Restricted area arc — small semicircle around basket */}
      <path d="M 215,20 A 35,35 0 0,0 285,20" fill="none" stroke={stroke} strokeWidth={1.5} />

      {/* 3pt line */}
      <line x1={60} y1={0}   x2={60}  y2={140} stroke={stroke} strokeWidth={1.5} />
      <line x1={440} y1={0}  x2={440} y2={140} stroke={stroke} strokeWidth={1.5} />
      <path d={`M 60,140 A 237,237 0 0,0 440,140`} fill="none" stroke={stroke} strokeWidth={1.5} />

      {/* Backboard */}
      <line x1={210} y1={0} x2={290} y2={0} stroke="#4a5070" strokeWidth={4} />
      {/* Rim */}
      <circle cx={250} cy={20} r={15} fill="none" stroke="#4a5070" strokeWidth={2} />

      {/* ── Labels (freq % only, heatmap communicates efficiency) ── */}
      <text x={250} y={58}  textAnchor="middle" fill={text} fontSize={11} fontFamily="DM Mono,monospace" stroke="#141828" strokeWidth={2} paintOrder="stroke fill">{freqLabel('restricted_area')}</text>
      <text x={250} y={155} textAnchor="middle" fill={text} fontSize={11} fontFamily="DM Mono,monospace" stroke="#141828" strokeWidth={2} paintOrder="stroke fill">{freqLabel('paint_non_ra')}</text>
      <text x={110} y={88}  textAnchor="middle" fill={text} fontSize={11} fontFamily="DM Mono,monospace" stroke="#141828" strokeWidth={2} paintOrder="stroke fill">{freqLabel('mid_range')}</text>
      <text x={30}  y={88}  textAnchor="middle" fill={text} fontSize={9} fontFamily="DM Mono,monospace" stroke="#141828" strokeWidth={2} paintOrder="stroke fill">{freqLabel('corner_3')}</text>
      <text x={250} y={305} textAnchor="middle" fill={text} fontSize={11} fontFamily="DM Mono,monospace" stroke="#141828" strokeWidth={2} paintOrder="stroke fill">{freqLabel('above_break_3')}</text>

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
  { value: 'season', label: '2025-26 Season' },
  { value: 'l30',    label: 'Last 30 Days' },
  { value: 'l14',    label: 'Last 14 Days' },
]

function RankingsPage({ onSelectPlayer }) {
  const [period,   setPeriod]   = useState('season')
  const [position, setPosition] = useState('all')
  const [players,  setPlayers]  = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [sortKey,  setSortKey]  = useState('z_total')
  const [sortAsc,  setSortAsc]  = useState(false)
  const [viewMode, setViewMode] = useState('pg')  // 'pg' | 'totals'
  const [puntedCats, setPuntedCats] = useState(new Set())

  useEffect(() => {
    setLoading(true)
    setPlayers(null)
    const pos = position === 'all' ? 'all' : position
    apiFetch(`/api/rankings?period=${period}&position=${encodeURIComponent(pos)}`)
      .then(r => r.json())
      .then(d => { setPlayers(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [period, position])

  function handleSort(key) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(key === 'tov') }
  }

  const PCT_KEYS = new Set(['fg_pct', 'ft_pct'])
  const TOTALS_COUNTING = RANK_COLS.filter(c => !PCT_KEYS.has(c.key)).map(c => c.key)
  const isTotalsKey = (key) => viewMode === 'totals' && !PCT_KEYS.has(key) && !key.startsWith('z_') && key !== 'z_total' && key !== 'gp' && key !== 'min_pg'
  const totalsVal = (p, key) => {
    const v = p[key]
    if (v == null) return null
    return Math.round(v * (p.gp ?? 0))
  }

  // Compute totals Z-scores from the current player set
  const totalsZStats = (() => {
    if (!players || viewMode !== 'totals') return {}
    const stats = {}
    for (const key of TOTALS_COUNTING) {
      const vals = players.map(p => totalsVal(p, key)).filter(v => v != null)
      if (!vals.length) continue
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length
      const std  = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1
      stats[key] = { mean, std }
    }
    return stats
  })()

  const getTotalsZ = (p, key) => {
    const s = totalsZStats[key]
    if (!s) return null
    const v = totalsVal(p, key)
    if (v == null) return null
    return +((v - s.mean) / s.std).toFixed(2)
  }

  const getTotalsZTotal = (p) => {
    let sum = 0
    for (const c of RANK_COLS) {
      if (puntedCats.has(c.key)) continue
      if (PCT_KEYS.has(c.key)) {
        sum += p[`z_${c.key}`] ?? 0
      } else {
        const z = getTotalsZ(p, c.key)
        if (z == null) continue
        sum += c.lowerBetter ? -z : z
      }
    }
    return +sum.toFixed(2)
  }

  const getEffectiveZTotal = (p) => {
    if (viewMode === 'totals') return getTotalsZTotal(p)
    let sum = 0
    for (const c of RANK_COLS) {
      if (puntedCats.has(c.key)) continue
      const z = p[`z_${c.key}`]
      if (z == null) continue
      sum += c.lowerBetter ? -z : z
    }
    return +sum.toFixed(2)
  }

  const getSortVal = (p, key) => {
    if (key === 'z_total') return getEffectiveZTotal(p)
    if (viewMode === 'totals' && isTotalsKey(key)) return totalsVal(p, key) ?? -Infinity
    return p[key] ?? -Infinity
  }

  const sorted = players ? [...players].sort((a, b) => {
    const av = getSortVal(a, sortKey)
    const bv = getSortVal(b, sortKey)
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
        <div className="rank-filter-group">
          <span className="ctrl-label">View</span>
          <div className="rank-pills">
            <button className={`rank-pill${viewMode === 'pg' ? ' active' : ''}`} onClick={() => setViewMode('pg')}>Per Game</button>
            <button className={`rank-pill${viewMode === 'totals' ? ' active' : ''}`} onClick={() => setViewMode('totals')}>Totals</button>
          </div>
        </div>
        <div className="rank-filter-group">
          <span className="ctrl-label">Punt</span>
          <div className="rank-pills">
            {RANK_COLS.map(c => {
              const punted = puntedCats.has(c.key)
              return (
                <button
                  key={c.key}
                  className={`rank-pill rank-pill-punt${punted ? ' punted' : ''}`}
                  onClick={() => setPuntedCats(prev => {
                    const next = new Set(prev)
                    punted ? next.delete(c.key) : next.add(c.key)
                    return next
                  })}
                >{c.label}</button>
              )
            })}
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
                  <th key={c.key} className="num" onClick={() => handleSort(c.key)}
                      style={{ cursor: 'pointer', opacity: puntedCats.has(c.key) ? 0.3 : 1 }}>
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
                      <div className="rank-player-name rank-player-link" onClick={() => onSelectPlayer(p)}>
                        {p.name}
                        {p.injury && <InjuryBadge injury={p.injury} compact />}
                      </div>
                      <div className="rank-player-team">{p.team}</div>
                    </td>
                    <td className="muted" style={{ fontSize: '11px' }}>{posAbbr(p.position)}</td>
                    <td className="num mono">{p.gp ?? '—'}</td>
                    <td className="num mono">{p.min_pg != null ? p.min_pg.toFixed(1) : '—'}</td>
                    {RANK_COLS.map(c => {
                      const punted = puntedCats.has(c.key)
                      const z     = viewMode === 'totals' && !PCT_KEYS.has(c.key) ? getTotalsZ(p, c.key) : p[`z_${c.key}`]
                      const zAdj  = (z != null && c.lowerBetter) ? -z : z
                      const zColor = punted ? '#333' : zAdj == null ? '' : zAdj >= 1 ? 'var(--skill)' : zAdj <= -1 ? '#ff6b6b' : '#888'
                      const displayFmt = isTotalsKey(c.key)
                        ? (totalsVal(p, c.key) == null ? '—' : totalsVal(p, c.key))
                        : fmt(p[c.key], c.pct)
                      return (
                        <td key={c.key} className="num mono rank-stat-cell" style={{ opacity: punted ? 0.3 : 1 }}>
                          <div>{displayFmt}</div>
                          <div className="rank-z" style={{ color: zColor }}>{fmtZ(z)}</div>
                        </td>
                      )
                    })}
                    <td className="num mono z-total-cell">
                      {fmtZ(getEffectiveZTotal(p))}
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

// ─── Box Score Page ───────────────────────────────────────────────────────────

const BS_STATS = ['pts','reb','ast','stl','blk','tov']
const BS_LABELS = { pts:'PTS', reb:'REB', ast:'AST', stl:'STL', blk:'BLK', tov:'TOV' }
const BS_COL_ORDER = ['pts','reb','ast','stl','blk','tov']

function ZCell({ value, z, isTov }) {
  // For TOV, high z is bad; for everything else high z is good
  const good = isTov ? z < -0.5 : z > 0.5
  const bad  = isTov ? z > 0.5  : z < -0.5
  const cls  = good ? 'z-pos' : bad ? 'z-neg' : 'z-neu'
  return (
    <td className={`bs-stat-cell ${cls}`}>
      <span className="bs-val">{value}</span>
      <span className="bs-z">{z > 0 ? '+' : ''}{z.toFixed(1)}</span>
    </td>
  )
}

// ── Injury badge ────────────────────────────────────────────────────────────

const INJ_COLORS = {
  'Out':          { bg: '#ff4444', text: '#fff' },
  'Doubtful':     { bg: '#ff7700', text: '#fff' },
  'Questionable': { bg: '#ccaa00', text: '#000' },
  'Day-To-Day':   { bg: '#ccaa00', text: '#000' },
}

function InjuryBadge({ injury, compact }) {
  if (!injury?.designation) return null
  const colors = INJ_COLORS[injury.designation] ?? { bg: '#555', text: '#fff' }
  const label  = compact
    ? (injury.designation === 'Questionable' || injury.designation === 'Day-To-Day' ? 'GTD' : injury.designation === 'Doubtful' ? 'DBT' : 'OUT')
    : injury.designation
  return (
    <span
      className="inj-badge"
      style={{ background: colors.bg, color: colors.text }}
      title={injury.description || injury.designation}
    >
      {label}
    </span>
  )
}

// ── Injuries page ────────────────────────────────────────────────────────────

function NewsSection() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    apiFetch('/api/news')
      .then(async r => {
        const text = await r.text()
        if (!r.ok) {
          try { return Promise.reject(JSON.parse(text).detail || text.slice(0, 120)) }
          catch { return Promise.reject(`HTTP ${r.status}`) }
        }
        try { return JSON.parse(text) }
        catch { return Promise.reject(`HTTP ${r.status}: unexpected response`) }
      })
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [])

  if (loading) return <div className="inj-loading">Loading news…</div>
  if (error)   return <div className="bs-error">News unavailable: {error}</div>
  if (!data?.articles?.length) return <div className="bs-empty">No news articles found.</div>

  // ESPN generic headshot URL — skip it, only show real player images
  const isGenericImage = url => !url || url.includes('nophoto')

  return (
    <div className="news-list">
      {data.articles.map((a, i) => (
        <div key={i} className="news-item">
          {!isGenericImage(a.image) && (
            <img className="news-img" src={a.image} alt="" />
          )}
          <div className="news-title">
            {a.link
              ? <a href={a.link} target="_blank" rel="noopener noreferrer">{a.title}</a>
              : a.title}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Depth Charts Page ────────────────────────────────────────────────────────

const DEPTH_POS_ORDER = ['PG', 'SG', 'SF', 'PF', 'C']
const DEPTH_SHOW = 3   // starters + first two backups per position

function DepthChartsPage({ onSelectPlayer }) {
  const [teams, setTeams]         = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [conference, setConference] = useState('all')

  useEffect(() => {
    setLoading(true)
    apiFetch('/api/depth-charts')
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail || 'Failed to load')))
      .then(d => { setTeams(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [])

  const filtered = teams
    ? teams.filter(t => conference === 'all' || t.conference === conference)
    : []

  return (
    <div className="rankings-page">
      <div className="rankings-controls">
        <div className="rank-filter-group">
          <span className="ctrl-label">Conference</span>
          <div className="rank-pills">
            {['all', 'East', 'West'].map(c => (
              <button key={c} className={`rank-pill${conference === c ? ' active' : ''}`}
                onClick={() => setConference(c)}>
                {c === 'all' ? 'All' : c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && <p className="rankings-loading">Loading depth charts…</p>}
      {error   && <div className="bs-error">{error}</div>}

      {!loading && filtered.length > 0 && (
        <div className="depth-grid">
          {filtered.map(team => (
            <div key={team.team} className="depth-card">
              <div className="depth-card-header">
                <span className="depth-team-abv">{team.team}</span>
                <span className="depth-team-name">{team.team_name}</span>
              </div>
              <div className="depth-positions">
                {DEPTH_POS_ORDER.map(pos => {
                  const players = (team.positions[pos] || []).slice(0, DEPTH_SHOW)
                  if (!players.length) return null
                  return (
                    <div key={pos} className="depth-pos-row">
                      <span className="depth-pos-label">{pos}</span>
                      <div className="depth-pos-players">
                        {players.map((p, i) => (
                          <div key={i} className={`depth-player${i === 0 ? ' depth-starter' : ''}`}>
                            {p.slug
                              ? <span className="rank-player-link" onClick={() => onSelectPlayer({ slug: p.slug, name: p.name })}>{p.name}</span>
                              : <span>{p.name}</span>
                            }
                            {p.injury && <InjuryBadge injury={p.injury} compact />}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function InjuriesPage({ onSelectPlayer }) {
  const [tab, setTab]         = useState('injuries')
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    apiFetch('/api/injuries')
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail || 'Error')))
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [])

  const DES_ORDER = { 'Out': 0, 'Doubtful': 1, 'Questionable': 2, 'Day-To-Day': 3 }

  return (
    <div className="inj-page">
      <div className="inj-header">
        <h2 className="inj-title">{tab === 'injuries' ? 'Injury Report' : 'Player News'}</h2>
        <div className="inj-tabs">
          <button className={`inj-tab${tab === 'injuries' ? ' active' : ''}`} onClick={() => setTab('injuries')}>Injuries</button>
          <button className={`inj-tab${tab === 'news' ? ' active' : ''}`} onClick={() => setTab('news')}>News</button>
        </div>
        {tab === 'injuries' && data?.updated_at && (
          <span className="inj-updated">Updated {data.updated_at.slice(0, 16).replace('T', ' ')} UTC</span>
        )}
      </div>

      {tab === 'news' ? (
        <NewsSection />
      ) : loading ? (
        <div className="inj-loading">Loading injury report…</div>
      ) : error ? (
        <div className="bs-error">{error}</div>
      ) : !data || !Object.keys(data.teams).length ? (
        <div className="bs-empty">No injuries on record.</div>
      ) : (
        <div className="inj-grid">
          {Object.entries(data.teams).sort(([a], [b]) => a.localeCompare(b)).map(([team, players]) => (
            <div key={team} className="inj-team-card">
              <div className="inj-team-name">{team}</div>
              {[...players].sort((a, b) => (DES_ORDER[a.designation] ?? 9) - (DES_ORDER[b.designation] ?? 9)).map((p, i) => (
                <div key={i} className="inj-player-row">
                  <InjuryBadge injury={p} compact={false} />
                  <span
                    className={`inj-player-name${p.slug && onSelectPlayer ? ' rank-player-link' : ''}`}
                    onClick={() => p.slug && onSelectPlayer && onSelectPlayer(p)}
                  >{p.name}</span>
                  {p.description && <span className="inj-desc">{p.description}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BoxScoreTable({ players, onSelectPlayer }) {
  if (!players.length) return null
  return (
    <table className="bs-table">
      <thead>
        <tr>
          <th className="bs-name">Player</th>
          <th className="bs-ctr">MIN</th>
          <th className="bs-ctr">+/-</th>
          <th className="bs-ctr">PF</th>
          <th className="bs-ctr bs-stat-head">PTS</th>
          <th className="bs-ctr">3PM</th>
          <th className="bs-ctr bs-stat-head">REB</th>
          <th className="bs-ctr bs-stat-head">AST</th>
          <th className="bs-ctr bs-stat-head">STL</th>
          <th className="bs-ctr bs-stat-head">BLK</th>
          <th className="bs-ctr bs-stat-head">TOV</th>
          <th className="bs-ctr">FG</th>
          <th className="bs-ctr">FG%</th>
          <th className="bs-ctr">FT</th>
          <th className="bs-ctr">FT%</th>
          <th className="bs-ctr bs-ztotal-head">Z</th>
        </tr>
      </thead>
      <tbody>
        {players.filter(p => p.min > 0).map((p, i) => (
          <tr key={i}>
            <td className="bs-name">
              <span
                className={p.slug && onSelectPlayer ? 'rank-player-link' : undefined}
                onClick={() => p.slug && onSelectPlayer && onSelectPlayer({ slug: p.slug, name: p.name })}
              >{p.name}</span>
              {p.injury && <InjuryBadge injury={p.injury} compact />}
            </td>
            <td className="bs-ctr">{p.min}</td>
            <td className={`bs-ctr bs-pm ${p.plus_minus?.startsWith('+') ? 'z-pos' : p.plus_minus?.startsWith('-') ? 'z-neg' : ''}`}>{p.plus_minus}</td>
            <td className="bs-ctr bs-muted">{p.pf}</td>
            <ZCell value={p.pts} z={p.z_pts} isTov={false} />
            <ZCell value={p.fg3m} z={p.z_fg3m} isTov={false} />
            <ZCell value={p.reb} z={p.z_reb} isTov={false} />
            <ZCell value={p.ast} z={p.z_ast} isTov={false} />
            <ZCell value={p.stl} z={p.z_stl} isTov={false} />
            <ZCell value={p.blk} z={p.z_blk} isTov={false} />
            <ZCell value={p.tov} z={p.z_tov} isTov={true} />
            <td className="bs-ctr bs-muted">{p.fg}</td>
            <ZCell value={p.fg_pct != null ? `${(p.fg_pct*100).toFixed(0)}%` : '—'} z={p.z_fg_pct} isTov={false} />
            <td className="bs-ctr bs-muted">{p.ft}</td>
            <ZCell value={p.ft_pct != null ? `${(p.ft_pct*100).toFixed(0)}%` : '—'} z={p.z_ft_pct} isTov={false} />
            <td className={`bs-ctr bs-ztotal ${p.z_total > 0 ? 'z-pos' : p.z_total < 0 ? 'z-neg' : 'z-neu'}`}>{p.z_total > 0 ? '+' : ''}{p.z_total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BoxScorePage({ onSelectPlayer }) {
  const clientET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const [todayEt, setTodayEt] = useState(clientET)
  const [date, setDate]       = useState(clientET)
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  // Fetch authoritative ET date from server on mount (avoids browser Intl quirks)
  useEffect(() => {
    apiFetch('/api/today')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.date) return
        setTodayEt(d.date)
        setDate(prev => prev > d.date ? d.date : prev)
      })
      .catch(() => {})
  }, [])

  const fetchScores = useCallback(() => {
    apiFetch(`/api/box-score?date=${date}`)
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail || 'Error')))
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [date])

  useEffect(() => {
    setLoading(true)
    setError(null)
    setData(null)
    fetchScores()

    // Auto-refresh every 30s for today only
    const isToday = date === todayEt
    if (!isToday) return
    const interval = setInterval(fetchScores, 30000)
    return () => clearInterval(interval)
  }, [date, todayEt, fetchScores])

  function shiftDate(days) {
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + days)
    setDate(d.toISOString().slice(0, 10))
  }

  return (
    <div className="bs-page">
      <div className="bs-date-nav">
        <button className="bs-nav-btn" onClick={() => shiftDate(-1)}>←</button>
        <input
          type="date"
          className="bs-date-input"
          value={date}
          onChange={e => setDate(e.target.value)}
        />
        <button className="bs-nav-btn" onClick={() => shiftDate(1)} disabled={date >= todayEt}>→</button>
        {date === todayEt && <span className="bs-live-pill">● LIVE</span>}
      </div>

      {loading && <div className="bs-loading">Loading box scores…</div>}
      {error   && <div className="bs-error">{error}</div>}

      {data && data.games.length === 0 && !loading && (
        <div className="bs-empty">No games on this date.</div>
      )}

      {data && data.games.map(game => (
        <div key={game.game_id} className="bs-game">
          <div className="bs-game-header">
            <div className="bs-matchup">
              <span className={`bs-team ${game.away_pts < game.home_pts ? 'bs-loser' : ''}`}>
                {game.away_abbr}
              </span>
              <span className="bs-score">
                {game.away_pts ?? '–'} – {game.home_pts ?? '–'}
              </span>
              <span className={`bs-team ${game.home_pts < game.away_pts ? 'bs-loser' : ''}`}>
                {game.home_abbr}
              </span>
            </div>
            <div className="bs-game-meta">
              <span className={`bs-status ${game.status === 'Completed' ? 'bs-final' : 'bs-live'}`}>
                {game.status === 'Completed' ? 'Final' : game.game_clock || game.status}
              </span>
              {game.blowout && <span className="bs-blowout">Blowout +{game.margin}</span>}
            </div>
          </div>

          <div className="bs-teams-wrap">
            <div className="bs-team-section">
              <div className="bs-team-label">{game.away} <span className="bs-team-abbr">{game.away_abbr}</span></div>
              <BoxScoreTable players={game.away_players} onSelectPlayer={onSelectPlayer} />
            </div>
            <div className="bs-team-section">
              <div className="bs-team-label">{game.home} <span className="bs-team-abbr">{game.home_abbr}</span></div>
              <BoxScoreTable players={game.home_players} onSelectPlayer={onSelectPlayer} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Projections page ─────────────────────────────────────────────────────────

const PROJ_PERIODS = [
  { label: '7d',  days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: 'ROS', fixedEnd: '2026-06-30' },
]

const PROJ_POSITIONS = ['All', 'Guard', 'Forward', 'Center', 'Guard-Forward', 'Forward-Center']

const PROJ_COLS = [
  { key: 'min_pg', label: 'MIN',  noZ: true },
  { key: 'pts',    label: 'PTS' },
  { key: 'reb',    label: 'REB' },
  { key: 'ast',    label: 'AST' },
  { key: 'stl',    label: 'STL' },
  { key: 'blk',    label: 'BLK' },
  { key: 'tov',    label: 'TOV', lowerBetter: true },
  { key: 'fg3m',   label: '3PM' },
  { key: 'fg_pct', label: 'FG%', pct: true },
]

const PROJ_PCT_KEYS   = new Set(['fg_pct'])
const PROJ_PUNT_COLS  = PROJ_COLS.filter(c => !c.noZ)   // puntable = cols with Z-scores
const PROJ_COUNTING   = PROJ_PUNT_COLS.filter(c => !PROJ_PCT_KEYS.has(c.key)).map(c => c.key)

function ProjectionsPage({ onSelectPlayer }) {
  function todayStr() { return new Date().toISOString().slice(0, 10) }
  function addDays(n) {
    const d = new Date(todayStr() + 'T12:00:00')
    d.setDate(d.getDate() + n)
    return d.toISOString().slice(0, 10)
  }

  const [start, setStart]           = useState(todayStr)
  const [end, setEnd]               = useState(() => addDays(14))
  const [position, setPosition]     = useState('all')
  const [sortKey, setSortKey]       = useState('period_value')
  const [sortAsc, setSortAsc]       = useState(false)
  const [players, setPlayers]       = useState(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [viewMode, setViewMode]     = useState('pg')
  const [showRanges, setShowRanges] = useState(false)
  const [puntedCats, setPuntedCats] = useState(new Set())

  useEffect(() => {
    if (!start || !end || start > end) return
    setLoading(true)
    setError(null)
    apiFetch(`/api/projections?start=${start}&end=${end}`)
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail || 'Error')))
      .then(d => { setPlayers(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [start, end])

  function setPeriod(days, fixedEnd) {
    const t = todayStr()
    setStart(t)
    setEnd(fixedEnd ?? addDays(days))
  }

  function handleSort(key) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(key === 'tov') }
  }

  const activePeriod = PROJ_PERIODS.find(p => {
    const t = todayStr()
    if (start !== t) return false
    return p.fixedEnd ? end === p.fixedEnd : end === addDays(p.days)
  })?.label

  const filtered = players
    ? players.filter(p => position === 'all' || p.position === position)
    : []

  // Totals helpers
  const isTotalsKey = (key) => viewMode === 'totals' && !PROJ_PCT_KEYS.has(key) && key !== 'min_pg' && key !== 'gp'
  const totalsVal   = (p, key) => { const v = p[key]; return v == null ? null : Math.round(v * (p.gp ?? 0)) }

  // Totals Z-stats from current filtered set
  const totalsZStats = (() => {
    if (viewMode !== 'totals' || !filtered.length) return {}
    const stats = {}
    for (const key of PROJ_COUNTING) {
      const vals = filtered.map(p => totalsVal(p, key)).filter(v => v != null)
      if (!vals.length) continue
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length
      const std  = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1
      stats[key] = { mean, std }
    }
    return stats
  })()

  const getTotalsZ = (p, key) => {
    const s = totalsZStats[key]; if (!s) return null
    const v = totalsVal(p, key); if (v == null) return null
    return +((v - s.mean) / s.std).toFixed(2)
  }

  // Effective Value: per-game = Σ unpunted z × gp; totals = Σ unpunted totals-Z
  const getEffectiveValue = (p) => {
    let sum = 0
    for (const c of PROJ_PUNT_COLS) {
      if (puntedCats.has(c.key)) continue
      const z = viewMode === 'totals' && !PROJ_PCT_KEYS.has(c.key)
        ? getTotalsZ(p, c.key)
        : p[`z_${c.key}`]
      if (z == null) continue
      sum += c.lowerBetter ? -z : z
    }
    return viewMode === 'totals' ? +sum.toFixed(2) : +(sum * (p.gp ?? 0)).toFixed(2)
  }

  const getSortVal = (p, key) => {
    if (key === 'period_value') return getEffectiveValue(p)
    if (isTotalsKey(key)) return totalsVal(p, key) ?? -Infinity
    return p[key] ?? -Infinity
  }

  const sorted = [...filtered].sort((a, b) => {
    const av = getSortVal(a, sortKey)
    const bv = getSortVal(b, sortKey)
    if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
    return sortAsc ? av - bv : bv - av
  })

  const fmt  = (val, pct) => val == null ? '—' : pct ? `${val}%` : val.toFixed(1)
  const fmtZ = (z) => z == null ? '' : (z >= 0 ? '+' : '') + z.toFixed(2)

  function SortIcon({ col }) {
    if (sortKey !== col) return <span className="sort-icon muted">↕</span>
    return <span className="sort-icon">{sortAsc ? '↑' : '↓'}</span>
  }

  return (
    <div className="rankings-page">
      <div className="rankings-controls">
        <div className="rank-filter-group">
          <span className="ctrl-label">Window</span>
          <div className="rank-pills">
            {PROJ_PERIODS.map(p => (
              <button
                key={p.label}
                className={`rank-pill${activePeriod === p.label ? ' active' : ''}`}
                onClick={() => setPeriod(p.days, p.fixedEnd)}
              >{p.label}</button>
            ))}
          </div>
          <input type="date" className="proj-date-input" value={start} onChange={e => setStart(e.target.value)} />
          <span className="proj-date-sep">→</span>
          <input type="date" className="proj-date-input" value={end} onChange={e => setEnd(e.target.value)} />
        </div>
        <div className="rank-filter-group">
          <span className="ctrl-label">Position</span>
          <div className="rank-pills">
            {PROJ_POSITIONS.map(p => (
              <button
                key={p}
                className={`rank-pill${position === (p === 'All' ? 'all' : p) ? ' active' : ''}`}
                onClick={() => setPosition(p === 'All' ? 'all' : p)}
              >{p}</button>
            ))}
          </div>
        </div>
        <div className="rank-filter-group">
          <span className="ctrl-label">View</span>
          <div className="rank-pills">
            <button className={`rank-pill${viewMode === 'pg' ? ' active' : ''}`} onClick={() => setViewMode('pg')}>Per Game</button>
            <button className={`rank-pill${viewMode === 'totals' ? ' active' : ''}`} onClick={() => setViewMode('totals')}>Totals</button>
            <button className={`rank-pill${showRanges ? ' active' : ''}`} onClick={() => setShowRanges(r => !r)}>Ranges</button>
          </div>
        </div>
        <div className="rank-filter-group">
          <span className="ctrl-label">Punt</span>
          <div className="rank-pills">
            {PROJ_PUNT_COLS.map(c => {
              const punted = puntedCats.has(c.key)
              return (
                <button
                  key={c.key}
                  className={`rank-pill rank-pill-punt${punted ? ' punted' : ''}`}
                  onClick={() => setPuntedCats(prev => {
                    const next = new Set(prev)
                    punted ? next.delete(c.key) : next.add(c.key)
                    return next
                  })}
                >{c.label}</button>
              )
            })}
          </div>
        </div>
      </div>

      {loading && <p className="rankings-loading">Computing projections…</p>}
      {error   && <div className="bs-error">{error}</div>}

      {!loading && players && sorted.length === 0 && (
        <p className="rankings-loading">No players found — check the schedule table covers this window.</p>
      )}

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
                {PROJ_COLS.map(c => (
                  <th key={c.key} className="num" onClick={() => handleSort(c.key)}
                      style={{ cursor: 'pointer', opacity: puntedCats.has(c.key) ? 0.3 : 1 }}>
                    {c.label} <SortIcon col={c.key} />
                    {!c.noZ && (
                      <div className="th-z" onClick={e => { e.stopPropagation(); handleSort(`z_${c.key}`) }}>
                        z <SortIcon col={`z_${c.key}`} />
                      </div>
                    )}
                  </th>
                ))}
                <th className="num" onClick={() => handleSort('period_value')} style={{ cursor: 'pointer' }}>
                  Value <SortIcon col="period_value" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => (
                <tr key={p.slug} className={i % 2 === 0 ? 'row-even' : 'row-odd'}>
                  <td className="rank-col muted">{i + 1}</td>
                  <td className="name-col">
                    <div className="rank-player-name rank-player-link" onClick={() => onSelectPlayer(p)}>
                      {p.name}
                      {p.injury && <InjuryBadge injury={p.injury} compact />}
                    </div>
                    <div className="rank-player-team">{p.team}</div>
                  </td>
                  <td className="muted" style={{ fontSize: '11px' }}>{posAbbr(p.position)}</td>
                  <td className="num mono">{p.gp}</td>
                  {PROJ_COLS.map(c => {
                    const punted = puntedCats.has(c.key)
                    const z = c.noZ ? null
                      : viewMode === 'totals' && !PROJ_PCT_KEYS.has(c.key)
                        ? getTotalsZ(p, c.key)
                        : p[`z_${c.key}`]
                    const zAdj   = (z != null && c.lowerBetter) ? -z : z
                    const zColor = punted ? '#333' : zAdj == null ? '' : zAdj >= 1 ? 'var(--skill)' : zAdj <= -1 ? '#ff6b6b' : '#888'
                    const displayFmt = isTotalsKey(c.key)
                      ? (totalsVal(p, c.key) == null ? '—' : totalsVal(p, c.key))
                      : fmt(p[c.key], c.pct)
                    const hasRange = showRanges && !c.noZ && !c.pct
                    const rangeLow  = p[`${c.key}_low`]
                    const rangeHigh = p[`${c.key}_high`]
                    const displayLow  = isTotalsKey(c.key) ? Math.round(rangeLow  * (p.gp ?? 0)) : rangeLow
                    const displayHigh = isTotalsKey(c.key) ? Math.round(rangeHigh * (p.gp ?? 0)) : rangeHigh
                    return (
                      <td key={c.key} className="num mono rank-stat-cell" style={{ opacity: punted ? 0.3 : 1 }}>
                        <div>{displayFmt}</div>
                        {!c.noZ && !hasRange && <div className="rank-z" style={{ color: zColor }}>{fmtZ(z)}</div>}
                        {hasRange && rangeLow != null && <div className="rank-range">{displayLow}–{displayHigh}</div>}
                      </td>
                    )
                  })}
                  <td className="num mono z-total-cell">
                    {(() => { const v = getEffectiveValue(p); return v != null ? (v > 0 ? '+' : '') + v.toFixed(1) : '—' })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

// ── Dashboard page ────────────────────────────────────────────────────────────

function DashboardPage({ onSelectPlayer }) {
  const todayET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const [games,    setGames]    = useState(null)
  const [injuries, setInjuries] = useState(null)
  const [news,     setNews]     = useState(null)
  const [comments, setComments] = useState(null)

  useEffect(() => {
    apiFetch(`/api/box-score?date=${todayET()}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setGames(d?.games ?? []))
      .catch(() => setGames([]))

    apiFetch('/api/injuries')
      .then(r => r.ok ? r.json() : null)
      .then(d => setInjuries(d))
      .catch(() => setInjuries(null))

    apiFetch('/api/news')
      .then(r => r.ok ? r.json() : null)
      .then(d => setNews(d))
      .catch(() => setNews(null))

    apiFetch('/api/comments/recent?limit=15')
      .then(r => r.ok ? r.json() : [])
      .then(d => setComments(Array.isArray(d) ? d : []))
      .catch(() => setComments([]))
  }, [])

  const DES_ORDER = { 'Out': 0, 'Doubtful': 1, 'Questionable': 2, 'Day-To-Day': 3 }
  const isGenericImage = url => !url || url.includes('nophoto')

  // Flatten injuries to a sorted list
  const injList = injuries
    ? Object.values(injuries.teams).flat()
        .sort((a, b) => (DES_ORDER[a.designation] ?? 9) - (DES_ORDER[b.designation] ?? 9))
    : null

  return (
    <div className="dash-grid">

      {/* ── Today's Games ──────────────────────────────────── */}
      <div className="dash-card">
        <h2 className="dash-card-title">Today's Games</h2>
        {!games ? <div className="dash-loading">Loading…</div>
          : games.length === 0 ? <div className="dash-empty">No games today.</div>
          : games.map(g => (
            <div key={g.game_id} className="dash-game">
              <div className="dash-game-teams">
                <span className={`dash-game-team${g.away_pts != null && g.home_pts != null && g.away_pts < g.home_pts ? ' dash-loser' : ''}`}>
                  {g.away_abbr}
                </span>
                <span className="dash-game-score">
                  {g.away_pts != null ? `${g.away_pts} – ${g.home_pts}` : 'vs'}
                </span>
                <span className={`dash-game-team${g.away_pts != null && g.home_pts != null && g.home_pts < g.away_pts ? ' dash-loser' : ''}`}>
                  {g.home_abbr}
                </span>
              </div>
              <span className={`dash-game-status${g.status === 'Completed' ? ' dash-final' : ' dash-live'}`}>
                {g.status === 'Completed' ? 'Final' : g.status || 'Scheduled'}
              </span>
            </div>
          ))
        }
      </div>

      {/* ── Latest Comments ────────────────────────────────── */}
      <div className="dash-card">
        <h2 className="dash-card-title">Latest Comments</h2>
        {!comments ? <div className="dash-loading">Loading…</div>
          : comments.length === 0 ? <div className="dash-empty">No comments yet.</div>
          : comments.map(c => (
            <div key={c.id} className="dash-comment">
              <div className="dash-comment-header">
                <span className="dash-comment-player rank-player-link"
                  onClick={() => onSelectPlayer({ slug: c.player_slug, name: c.player_name })}>
                  {c.player_name}
                </span>
                <span className="dash-comment-meta">{c.author} · {timeAgo(c.created_at)}</span>
              </div>
              <p className="dash-comment-body">{c.body}</p>
            </div>
          ))
        }
      </div>

      {/* ── Injuries ───────────────────────────────────────── */}
      <div className="dash-card">
        <h2 className="dash-card-title">Injury Report</h2>
        {!injList ? <div className="dash-loading">Loading…</div>
          : injList.length === 0 ? <div className="dash-empty">No injuries on record.</div>
          : injList.map((p, i) => (
            <div key={i} className="dash-inj-row">
              <InjuryBadge injury={p} compact />
              <span
                className={`dash-inj-name${p.slug ? ' rank-player-link' : ''}`}
                onClick={() => p.slug && onSelectPlayer(p)}
              >{p.name}</span>
              <span className="dash-inj-team">{p.team}</span>
              {p.description && <span className="dash-inj-desc">{p.description}</span>}
            </div>
          ))
        }
      </div>

      {/* ── Player News ────────────────────────────────────── */}
      <div className="dash-card">
        <h2 className="dash-card-title">Player News</h2>
        {!news ? <div className="dash-loading">Loading…</div>
          : !news.articles?.length ? <div className="dash-empty">No news available.</div>
          : news.articles.slice(0, 15).map((a, i) => (
            <div key={i} className="dash-news-item">
              {!isGenericImage(a.image) && <img className="dash-news-img" src={a.image} alt="" />}
              <div>
                <div className="dash-news-title">
                  {a.link
                    ? <a href={a.link} target="_blank" rel="noopener noreferrer">{a.title}</a>
                    : a.title}
                </div>
                {a.description && <div className="dash-news-desc">{a.description}</div>}
              </div>
            </div>
          ))
        }
      </div>

    </div>
  )
}

// ── Comments section ─────────────────────────────────────────────────────────

function timeAgo(iso) {
  const secs = Math.floor((Date.now() - new Date(iso + 'Z')) / 1000)
  if (secs < 60)  return 'just now'
  if (secs < 3600) return `${Math.floor(secs/60)}m ago`
  if (secs < 86400) return `${Math.floor(secs/3600)}h ago`
  return `${Math.floor(secs/86400)}d ago`
}

function CommentsSection({ playerSlug }) {
  const [comments, setComments] = useState([])
  const [draft,    setDraft]    = useState('')
  const [posting,  setPosting]  = useState(false)

  useEffect(() => {
    if (!playerSlug) return
    setComments([])
    apiFetch(`/api/comments?player=${encodeURIComponent(playerSlug)}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setComments(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [playerSlug])

  async function handlePost(e) {
    e.preventDefault()
    if (!draft.trim()) return
    setPosting(true)
    const res = await apiFetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_slug: playerSlug, body: draft.trim() }),
    }).catch(() => null)
    if (res?.ok) {
      const c = await res.json()
      setComments(prev => [c, ...prev])
      setDraft('')
    }
    setPosting(false)
  }

  async function handleVote(commentId, vote) {
    const res = await apiFetch(`/api/comments/${commentId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vote }),
    }).catch(() => null)
    if (res?.ok) {
      const updated = await res.json()
      setComments(prev => prev.map(c =>
        c.id === commentId ? { ...c, ...updated } : c
      ))
    }
  }

  return (
    <div className="comments-section">
      <h3 className="panel-title" style={{ marginBottom: 12 }}>Comments</h3>

      <form onSubmit={handlePost} className="comment-form">
        <textarea
          className="comment-input"
          placeholder="Add a comment…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={2}
        />
        <button className="comment-post-btn" type="submit" disabled={posting || !draft.trim()}>
          {posting ? '…' : 'Post'}
        </button>
      </form>

      {comments.length === 0
        ? <p className="comment-empty">No comments yet. Be the first!</p>
        : comments.map(c => (
          <div key={c.id} className="comment-row">
            <div className="comment-meta">
              <span className="comment-author">{c.author}</span>
              <span className="comment-time">{timeAgo(c.created_at)}</span>
            </div>
            <p className="comment-body">{c.body}</p>
            <div className="comment-votes">
              <button
                className={`vote-btn${c.my_vote === 1 ? ' active-up' : ''}`}
                onClick={() => handleVote(c.id, 1)}
                title="Thumbs up"
              >👍 {c.thumbs_up > 0 ? c.thumbs_up : ''}</button>
              <button
                className={`vote-btn${c.my_vote === -1 ? ' active-down' : ''}`}
                onClick={() => handleVote(c.id, -1)}
                title="Thumbs down"
              >👎 {c.thumbs_down > 0 ? c.thumbs_down : ''}</button>
            </div>
          </div>
        ))
      }
    </div>
  )
}

// ── Fantasy page ──────────────────────────────────────────────────────────────

// ── Shared standings + roster display ─────────────────────────────────────────


// ── Scoring card ───────────────────────────────────────────────────────────────

const SCORING_TYPE_LABEL = {
  H2H_CATEGORY: 'Head-to-Head Categories',
  H2H_POINTS:   'Head-to-Head Points',
  ROTISSERIE:   'Rotisserie',
}

function ScoringCard({ scoring }) {
  if (!scoring) return null
  const label = SCORING_TYPE_LABEL[scoring.scoring_type] || scoring.scoring_type
  const items = (scoring.items || []).filter(it => it.points !== 0)
  return (
    <div className="dash-card">
      <div className="dash-card-title">Scoring — {label}</div>
      {scoring.scoring_type === 'H2H_CATEGORY' ? (
        <div className="scoring-cats">
          {(scoring.categories?.length ? scoring.categories : items.map(i => i.stat)).map(cat => (
            <span key={cat} className="scoring-cat">{cat}</span>
          ))}
        </div>
      ) : (
        <table className="dash-table">
          <thead><tr><th>Stat</th><th>Pts</th></tr></thead>
          <tbody>
            {items.map(it => (
              <tr key={it.stat_id}>
                <td>{it.stat}</td>
                <td className={it.is_reverse ? 'scoring-neg' : 'scoring-pos'}>{it.points > 0 && !it.is_reverse ? '+' : ''}{it.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Team picker ────────────────────────────────────────────────────────────────

function EspnTeamPicker({ onPicked, onDisconnect }) {
  const [teams,   setTeams]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [msg,     setMsg]     = useState(null)

  useEffect(() => {
    setLoading(true)
    apiFetch('/api/fantasy/espn/teams')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setTeams(d.teams || []))
      .catch(() => setMsg('Could not load teams'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSelect(teamId) {
    setLoading(true)
    try {
      const res = await apiFetch('/api/fantasy/espn/select-team', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed') }
      onPicked()
    } catch (e) { setMsg(e.message) }
    setLoading(false)
  }

  return (
    <div className="fantasy-wrap">
      <div className="fantasy-connect-card">
        <h2 className="fantasy-connect-title">Select your team</h2>
        <p className="fantasy-connect-sub">Which team is yours?</p>
        {msg && <div className="login-error">{msg}</div>}
        {loading && <div className="dash-empty">Loading…</div>}
        {teams && (
          <ul className="fantasy-league-list">
            {teams.map(t => (
              <li key={t.team_id} className="fantasy-league-item">
                <span className="fantasy-league-name">{t.name}</span>
                <span className="fantasy-league-meta">{t.owner || ''} · {t.wins}–{t.losses}</span>
                <button className="fantasy-league-btn" onClick={() => handleSelect(t.team_id)} disabled={loading}>Select</button>
              </li>
            ))}
          </ul>
        )}
        <button className="logout-btn" style={{ marginTop: 12 }} onClick={onDisconnect}>Disconnect ESPN</button>
      </div>
    </div>
  )
}

// ── Manager Dashboard ──────────────────────────────────────────────────────────

function ManagerDashboard() {
  const [league,  setLeague]  = useState(null)
  const [roster,  setRoster]  = useState(null)
  const [scoring, setScoring] = useState(null)
  const [matchup, setMatchup] = useState(undefined)
  const [loading, setLoading] = useState(true)
  const [msg,     setMsg]     = useState(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      apiFetch('/api/fantasy/espn/league').then(r => r.ok ? r.json() : null),
      apiFetch('/api/fantasy/espn/roster').then(r => r.ok ? r.json() : null),
      apiFetch('/api/fantasy/espn/scoring').then(r => r.ok ? r.json() : null),
      apiFetch('/api/fantasy/espn/matchup').then(r => r.ok ? r.json() : null),
    ]).then(([l, r, s, m]) => {
      setLeague(l); setRoster(r); setScoring(s)
      setMatchup(m?.matchup ?? null)
    }).catch(() => setMsg('Failed to load fantasy data'))
    .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="dash-empty">Loading…</div>
  if (msg) return <div className="login-error" style={{margin:24}}>{msg}</div>

  return (
    <div className="fantasy-wrap">
      <div className="fantasy-grid fantasy-grid-3">

        {/* Standings */}
        {league && (
          <div className="dash-card">
            <div className="dash-card-title">Standings — {league.league_name || 'My League'}</div>
            <table className="dash-table">
              <thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th></tr></thead>
              <tbody>
                {(league.standings || []).map((t, i) => (
                  <tr key={t.team_id} className={t.is_my_team ? 'fantasy-my-team' : ''}>
                    <td>{i + 1}</td><td>{t.name}</td><td>{t.wins}</td><td>{t.losses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Roster */}
        {roster && (
          <div className="dash-card">
            <div className="dash-card-title">My Roster{roster.team_name ? ` — ${roster.team_name}` : ''}</div>
            <table className="dash-table">
              <thead><tr><th>Player</th><th>Pos</th><th>Status</th></tr></thead>
              <tbody>
                {(roster.players || []).map((p, i) => (
                  <tr key={p.name + i}>
                    <td>{p.name}</td>
                    <td>{p.position || '—'}</td>
                    <td className={p.injury_status && p.injury_status !== 'Active' ? 'inj-out' : ''}>
                      {p.injury_status || 'Active'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Current matchup */}
        <div className="dash-card">
          <div className="dash-card-title">Current Matchup</div>
          {!matchup ? (
            <div className="dash-empty" style={{padding:'16px 0'}}>No active matchup</div>
          ) : (
            <div className="fantasy-matchup">
              <div className="fantasy-matchup-teams">
                <span className="fantasy-matchup-my">{matchup.my_team}</span>
                <span className="fantasy-matchup-vs">vs</span>
                <span className="fantasy-matchup-opp">{matchup.opp_team}</span>
              </div>
              <div className="fantasy-matchup-score">
                <span className={matchup.my_score > matchup.opp_score ? 'score-winning' : matchup.my_score < matchup.opp_score ? 'score-losing' : ''}>
                  {matchup.my_score}
                </span>
                <span className="score-sep">–</span>
                <span className={matchup.opp_score > matchup.my_score ? 'score-winning' : matchup.opp_score < matchup.my_score ? 'score-losing' : ''}>
                  {matchup.opp_score}
                </span>
              </div>
              {matchup.categories?.length > 0 && (
                <table className="dash-table" style={{marginTop:8}}>
                  <thead><tr><th>Cat</th><th>Mine</th><th>Opp</th></tr></thead>
                  <tbody>
                    {matchup.categories.map(c => (
                      <tr key={c.stat} className={c.winning ? 'fantasy-cat-win' : c.tied ? '' : 'fantasy-cat-loss'}>
                        <td>{c.stat}</td><td>{c.my_val}</td><td>{c.opp_val}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* Scoring */}
        <ScoringCard scoring={scoring} />
      </div>
    </div>
  )
}

// ── Projected Standings stub ───────────────────────────────────────────────────

function ProjectedStandings() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [msg,     setMsg]     = useState(null)

  useEffect(() => {
    apiFetch('/api/fantasy/espn/projected-standings')
      .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(d.detail || 'Failed')))
      .then(d => setData(d))
      .catch(e => setMsg(typeof e === 'string' ? e : 'Failed to load projections'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="dash-empty">Simulating standings… this may take a moment</div>
  if (msg)     return <div className="login-error" style={{margin:24}}>{msg}</div>
  if (!data)   return null

  const { projected_standings: standings, remaining_matchups, scoring_type, tracked_cats } = data
  const isCat = scoring_type === 'H2H_CATEGORY'
  const statMap = { PTS:'pts', REB:'reb', AST:'ast', STL:'stl', BLK:'blk', TO:'tov', TOV:'tov', '3PM':'fg3m', 'FG%':'fg_pct', 'FT%':'ft_pct' }

  return (
    <div className="fantasy-wrap">
      <div className="proj-header">
        <h3 className="proj-title">Projected Final Standings</h3>
        <div className="proj-meta">
          {remaining_matchups > 0
            ? <span>{remaining_matchups} remaining matchup{remaining_matchups !== 1 ? 's' : ''} simulated</span>
            : <span>No remaining matchups — season complete</span>}
          <span className="proj-meta-sep">·</span>
          <span>{isCat ? 'H2H Categories' : scoring_type === 'H2H_POINTS' ? 'H2H Points' : scoring_type}</span>
        </div>
      </div>

      <table className="proj-table">
        <thead>
          <tr>
            <th>Proj</th><th>Team</th><th>Current</th>
            <th>+W</th><th>+L</th><th>Proj W-L</th>
          </tr>
        </thead>
        <tbody>
          {standings.map(t => {
            const moved = t.actual_standing - t.proj_standing
            return (
              <tr key={t.team_id} className={t.is_my_team ? 'fantasy-my-team' : ''}>
                <td className="proj-rank">
                  <span>{t.proj_standing}</span>
                  {moved !== 0 && (
                    <span className={moved > 0 ? 'proj-up' : 'proj-down'}>
                      {moved > 0 ? `▲${moved}` : `▼${Math.abs(moved)}`}
                    </span>
                  )}
                </td>
                <td className="proj-team">{t.name}</td>
                <td className="proj-now">{t.actual_wins}–{t.actual_losses}</td>
                <td className="scoring-pos">+{t.proj_wins}</td>
                <td className="scoring-neg">+{t.proj_losses}</td>
                <td><strong>{t.proj_total_wins}–{t.proj_total_losses}</strong></td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <p className="proj-note">
        Based on 2025–26 season averages for matched players.
      </p>

      {isCat && tracked_cats?.length > 0 && standings.length > 0 && (() => {
        const negCats = new Set(['TO', 'TOV'])
        // Per-cat ranks: 1 = best. For neg cats, lower value = rank 1.
        const catRanks = {}
        tracked_cats.forEach(c => {
          const key = statMap[c]
          const neg = negCats.has(c)
          const vals = standings.map(t => ({ id: t.team_id, v: t.team_stats?.[key] ?? 0 }))
          const sorted = [...vals].sort((a, b) => neg ? a.v - b.v : b.v - a.v)
          catRanks[c] = {}
          sorted.forEach((item, i) => { catRanks[c][item.id] = i + 1 })
        })
        const n = standings.length
        function rankBg(rank) {
          const pct = (rank - 1) / Math.max(n - 1, 1)
          if (pct <= 0.25) return 'rgba(10,122,54,0.22)'
          if (pct <= 0.45) return 'rgba(10,122,54,0.10)'
          if (pct >= 0.75) return 'rgba(212,32,32,0.22)'
          if (pct >= 0.55) return 'rgba(212,32,32,0.10)'
          return undefined
        }
        function rankColor(rank) {
          const pct = (rank - 1) / Math.max(n - 1, 1)
          if (pct <= 0.45) return 'var(--skill)'
          if (pct >= 0.55) return 'var(--neg)'
          return undefined
        }
        return (
          <div className="proj-strength">
            <div className="proj-strength-title">Projected team strengths (per game)</div>
            <div className="proj-strength-scroll">
              <table className="proj-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    {tracked_cats.map(c => <th key={c}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {standings.map(t => (
                    <tr key={t.team_id} className={t.is_my_team ? 'fantasy-my-team' : ''}>
                      <td>{t.name}</td>
                      {tracked_cats.map(c => {
                        const key = statMap[c]
                        const raw = t.team_stats?.[key]
                        const val = raw != null ? (raw / 10).toFixed(1) : '—'
                        const rank = catRanks[c][t.team_id]
                        return (
                          <td key={c} style={{background: rankBg(rank), color: rankColor(rank)}}>
                            <div style={{fontWeight: 600}}>{val}</div>
                            <div style={{fontSize:'0.7em', opacity:0.7}}>#{rank}</div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ── Roster Analyser stub ───────────────────────────────────────────────────────

// ── Roster Analysis tab ────────────────────────────────────────────────────────

function RosterAnalysis({ data }) {
  const { my_roster, my_stats, my_cat_z, teams, cat_ranks, tracked_cats, neg_cats, stat_name_map } = data
  const catToKey = {}
  tracked_cats.forEach(cat => { if (stat_name_map[cat]) catToKey[cat] = stat_name_map[cat] })
  const negSet = new Set(neg_cats || [])

  function zCls(z) {
    if (z == null) return ''
    if (z >= 0.5)  return 'ra-z-pos'
    if (z <= -0.5) return 'ra-z-neg'
    return 'ra-z-neu'
  }
  function zFmt(z) {
    if (z == null) return null
    return (z >= 0 ? '+' : '') + z.toFixed(1)
  }
  function zBg(z) {
    if (z == null) return undefined
    if (z >=  2)   return 'rgba(76,175,100,0.45)'
    if (z >=  1)   return 'rgba(76,175,100,0.22)'
    if (z >=  0.3) return 'rgba(76,175,100,0.10)'
    if (z <= -2)   return 'rgba(220,50,50,0.45)'
    if (z <= -1)   return 'rgba(220,50,50,0.22)'
    if (z <= -0.3) return 'rgba(220,50,50,0.10)'
    return undefined
  }

  // All teams sorted by projected EOS win% desc
  const allSorted = [...teams].sort((a, b) =>
    (b.proj_win_pct ?? 0) - (a.proj_win_pct ?? 0)
  )

  // Compute user's category W-L-T vs a team
  function vsRecord(t) {
    if (t.is_my_team) return null
    let w = 0, l = 0, tie = 0
    tracked_cats.forEach(cat => {
      const key = catToKey[cat]; if (!key) return
      const mine  = my_stats?.[key] ?? 0
      const their = t.stats?.[key]  ?? 0
      const diff  = mine - their
      const neg   = negSet.has(cat)
      if (Math.abs(diff) < 0.05) { tie++; return }
      if (neg ? diff < 0 : diff > 0) w++; else l++
    })
    return { w, l, tie }
  }

  return (
    <div className="fantasy-wrap">

      {/* ── Roster ── */}
      <div className="ra-section-title">Roster</div>
      <div className="dash-card ra-card-wide" style={{overflowX:'auto',marginBottom:24}}>
        <table className="dash-table ra-table">
          <thead>
            <tr>
              <th>Player</th>
              {tracked_cats.map(c => <th key={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {my_roster.map((p, i) => (
              <tr key={p.espn_name + i} className={!p.stats ? 'ra-row-unmatched' : ''}>
                <td className="ra-player-name">{p.espn_name}{!p.br_slug && <span className="ra-no-data"> (no data)</span>}</td>
                {tracked_cats.map(cat => {
                  const key = catToKey[cat]
                  const v = p.stats?.[key]
                  const z = p.z_scores?.[key]
                  return (
                    <td key={cat} style={{verticalAlign:'top'}}>
                      <div>{v != null ? v.toFixed(1) : '—'}</div>
                      {z != null && <div className={`ra-z-val ${zCls(z)}`}>{zFmt(z)}</div>}
                    </td>
                  )
                })}
              </tr>
            ))}
            <tr className="ra-totals-row">
              <td>TOTAL</td>
              {tracked_cats.map(cat => {
                const v = my_stats?.[catToKey[cat]]
                return <td key={cat}><strong>{v != null ? v.toFixed(1) : '—'}</strong></td>
              })}
            </tr>
            {my_cat_z && (
              <tr className="ra-rank-row-inline">
                <td className="ra-rank-inline-label">Z SUM</td>
                {tracked_cats.map(cat => {
                  const z = my_cat_z[cat]
                  return <td key={cat} className={zCls(z)}><strong>{zFmt(z) ?? '—'}</strong></td>
                })}
              </tr>
            )}
            <tr className="ra-rank-row-inline">
              <td className="ra-rank-inline-label">RANK</td>
              {tracked_cats.map(cat => {
                const info = cat_ranks[cat]
                if (!info) return <td key={cat}>—</td>
                const { rank, total } = info
                const cls = rank <= Math.ceil(total / 3) ? 'ra-rank-good'
                          : rank >= total - Math.floor(total / 3) ? 'ra-rank-bad'
                          : 'ra-rank-mid'
                return <td key={cat} className={cls}><strong>{rank}/{total}</strong></td>
              })}
            </tr>
          </tbody>
        </table>
        {my_roster.some(p => !p.br_slug) && (
          <div className="ra-unmatched-note">(no data) — player not matched, excluded from projections</div>
        )}
      </div>

      {/* ── VS Each Opponent ── */}
      <div className="ra-section-title">VS Each Opponent</div>
      <div className="dash-card ra-card-wide" style={{overflowX:'auto',marginBottom:24}}>
        <table className="dash-table ra-table">
          <thead>
            <tr>
              <th>Team</th>
              <th style={{whiteSpace:'nowrap'}}>Win%</th>
              <th style={{whiteSpace:'nowrap'}}>You vs</th>
              {tracked_cats.map(c => <th key={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {allSorted.map(t => {
              const rec = vsRecord(t)
              const recCls = rec
                ? rec.w > rec.l ? 'ra-score-win' : rec.w < rec.l ? 'ra-score-loss' : 'ra-score-tie'
                : ''
              return (
                <tr key={t.team_id || t.name} className={t.is_my_team ? 'fantasy-my-team' : ''}>
                  <td className="ra-player-name">{t.name}</td>
                  <td style={{fontFamily:'var(--mono)',fontSize:12,whiteSpace:'nowrap'}}>
                    {t.proj_win_pct != null ? (t.proj_win_pct * 100).toFixed(1) + '%' : '—'}
                  </td>
                  <td className={recCls} style={{whiteSpace:'nowrap',fontWeight:600}}>
                    {rec ? `${rec.w}–${rec.l}${rec.tie ? `–${rec.tie}` : ''}` : '—'}
                  </td>
                  {tracked_cats.map(cat => {
                    const key  = catToKey[cat]
                    const stat = t.stats?.[key]
                    const z    = t.cat_z?.[cat]
                    return (
                      <td key={cat} style={{background: zBg(z), verticalAlign:'top'}}>
                        <div style={{fontFamily:'var(--mono)',fontSize:11}}>
                          {stat != null ? (stat / 10).toFixed(1) : '—'}
                        </div>
                        {z != null && <div className={`ra-z-val ${zCls(z)}`}>{zFmt(z)}</div>}
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
  )
}

// ── Trade Analysis tab ─────────────────────────────────────────────────────────

function TradeAnalysis({ data }) {
  // Unified "leaving my roster" list — used by both trade and waiver
  const [outSlugs,   setOutSlugs]   = useState([])  // {slug, name} — trade outs
  const [dropSlugs,  setDropSlugs]  = useState([])  // {slug, name} — pure drops

  // Trade
  const [tradeTeam,  setTradeTeam]  = useState(null)
  const [tradeTeam2, setTradeTeam2] = useState(null)
  const [getSlugs,   setGetSlugs]   = useState([])  // getting from team 1
  const [getSlugs2,  setGetSlugs2]  = useState([])  // getting from team 2

  // Waiver
  const [freeAgents, setFreeAgents] = useState(null)
  const [faLoading,  setFaLoading]  = useState(false)
  const [faSearch,   setFaSearch]   = useState('')
  const [pickSlugs,  setPickSlugs]  = useState([])  // FAs adding

  // Simulation
  const [baseSim,    setBaseSim]    = useState(null) // baseline (no changes) for "before" standings
  const [simResult,  setSimResult]  = useState(null)
  const [simLoading, setSimLoading] = useState(false)
  const [simErr,     setSimErr]     = useState(null)

  const [dragging,   setDragging]   = useState(null)

  useEffect(() => {
    // Fetch free agents
    setFaLoading(true)
    apiFetch('/api/fantasy/espn/free-agents')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setFreeAgents(d.free_agents || []))
      .catch(() => setFreeAgents([]))
      .finally(() => setFaLoading(false))
    // Fetch baseline projected standings (no roster changes)
    apiFetch('/api/fantasy/espn/roster-analysis/simulate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ add_slugs: [], drop_slugs: [] }),
    }).then(r => r.ok ? r.json() : null).then(d => { if (d) setBaseSim(d) }).catch(() => {})
  }, [])

  const { my_roster, my_stats, teams, tracked_cats, neg_cats, stat_name_map, cat_ranks } = data
  const catToKey = {}
  tracked_cats.forEach(cat => { if (stat_name_map[cat]) catToKey[cat] = stat_name_map[cat] })
  const negSet  = new Set(neg_cats || [])
  const otherTeams = teams.filter(t => !t.is_my_team)

  // Click cycles: normal → trade out (toTeam:1) → drop → normal
  function toggleOut(slug, name) {
    const inTrade = outSlugs.find(p=>p.slug===slug)
    const inDrop  = dropSlugs.find(p=>p.slug===slug)
    if (inTrade) {
      setOutSlugs(prev=>prev.filter(p=>p.slug!==slug))
      setDropSlugs(prev=>[...prev, {slug, name}])
    } else if (inDrop) {
      setDropSlugs(prev=>prev.filter(p=>p.slug!==slug))
    } else {
      setOutSlugs(prev=>[...prev, {slug, name, toTeam: 1}])
    }
    resetSim()
  }

  function toggleOutDest(slug) {
    setOutSlugs(prev => prev.map(p => p.slug===slug ? {...p, toTeam: p.toTeam===1 ? 2 : 1} : p))
    resetSim()
  }

  async function simulate() {
    const addSlugs    = [...getSlugs.map(p=>p.slug), ...getSlugs2.map(p=>p.slug), ...pickSlugs]
    const allDropSlugs = [...outSlugs.map(p=>p.slug), ...dropSlugs.map(p=>p.slug)]
    if (!addSlugs.length && !allDropSlugs.length) return
    setSimLoading(true); setSimErr(null); setSimResult(null)

    // Tell the backend how each trade partner's roster changes
    const toTeam1 = outSlugs.filter(p=>p.toTeam!==2).map(p=>p.slug)
    const toTeam2 = outSlugs.filter(p=>p.toTeam===2).map(p=>p.slug)
    const teamChanges = []
    if (tradeTeam) {
      teamChanges.push({
        team_id:    tradeTeam.team_id,
        add_slugs:  toTeam1,
        drop_slugs: getSlugs.map(p => p.slug),
      })
    }
    if (tradeTeam2) {
      teamChanges.push({
        team_id:    tradeTeam2.team_id,
        add_slugs:  toTeam2,
        drop_slugs: getSlugs2.map(p => p.slug),
      })
    }

    try {
      const res = await apiFetch('/api/fantasy/espn/roster-analysis/simulate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ add_slugs: addSlugs, drop_slugs: allDropSlugs, team_changes: teamChanges }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Simulation failed') }
      setSimResult(await res.json())
    } catch(e) { setSimErr(e.message) }
    setSimLoading(false)
  }

  function resetSim() { setSimResult(null); setSimErr(null) }

  function onDrop(zone) {
    if (!dragging) return
    const addTo = (list, set) => { if (!list.find(p=>p.slug===dragging.slug)) set(prev=>[...prev,{slug:dragging.slug,name:dragging.name}]) }
    if      (zone==='get'  && dragging.source==='theirs')  addTo(getSlugs,  setGetSlugs)
    else if (zone==='get2' && dragging.source==='theirs2') addTo(getSlugs2, setGetSlugs2)
    setDragging(null)
  }
  function onDragOver(e) { e.preventDefault() }

  // Helper: render a roster stats table (for before/after)
  function RosterTable({ roster, totals, ranks, label, beforeTotals, beforeRanks }) {
    const n = roster.filter(p => !p.isOut).length || 1
    return (
      <div className="dash-card" style={{flex:1,minWidth:0,overflowX:'auto'}}>
        <div className="ra-before-after-label">{label}</div>
        <table className="dash-table ra-table">
          <thead>
            <tr><th>Player</th>{tracked_cats.map(c=><th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {roster.map((p,i) => (
              <tr key={p.name+i} className={p.isNew ? 'ra-player-added' : p.isOut ? 'ra-player-out' : ''}>
                <td className="ra-player-name">
                  {p.name}
                  {p.isOut && <span className="ra-out-badge"> OUT</span>}
                </td>
                {tracked_cats.map(cat => {
                  const key = catToKey[cat]; const v = p.stats?.[key]
                  return <td key={cat}>{v != null ? v.toFixed(1) : '—'}</td>
                })}
              </tr>
            ))}
            <tr className="ra-totals-row">
              <td>AVG</td>
              {tracked_cats.map(cat => {
                const key = catToKey[cat]
                const v = totals?.[key] != null ? totals[key] / n : null
                const bv = beforeTotals?.[key] != null ? beforeTotals[key] / n : null
                const delta = (v != null && bv != null) ? v - bv : null
                const isNeg = negSet.has(cat)
                const improved = delta != null && (isNeg ? delta < -0.001 : delta > 0.001)
                const worsened = delta != null && (isNeg ? delta > 0.001 : delta < -0.001)
                return (
                  <td key={cat}>
                    <strong>{v != null ? v.toFixed(1) : '—'}</strong>
                    {delta != null && Math.abs(delta) > 0.001 && (
                      <div className={`ra-delta-inset ${improved?'ra-delta-pos':worsened?'ra-delta-neg':''}`}>
                        {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                      </div>
                    )}
                  </td>
                )
              })}
            </tr>
            {ranks && (
              <tr className="ra-rank-row-inline">
                <td className="ra-rank-inline-label">RANK</td>
                {tracked_cats.map(cat => {
                  const info = ranks[cat]
                  if (!info) return <td key={cat}>—</td>
                  const {rank, total} = info
                  const cls = rank <= Math.ceil(total/3) ? 'ra-rank-good' : rank >= total-Math.floor(total/3) ? 'ra-rank-bad' : 'ra-rank-mid'
                  const bInfo = beforeRanks?.[cat]
                  const rankDelta = bInfo ? bInfo.rank - rank : null  // positive = improved
                  return (
                    <td key={cat} className={cls}>
                      <strong>{rank}/{total}</strong>
                      {rankDelta != null && rankDelta !== 0 && (
                        <div className={`ra-delta-inset ${rankDelta>0?'ra-delta-pos':'ra-delta-neg'}`}>
                          {rankDelta > 0 ? `▲${rankDelta}` : `▼${Math.abs(rankDelta)}`}
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    )
  }

  // Helper: render a projected standings table
  function StandingsTable({ standings, label }) {
    if (!standings) return null
    return (
      <div className="dash-card" style={{flex:1,minWidth:0,overflowX:'auto'}}>
        <div className="ra-before-after-label">{label}</div>
        <table className="dash-table">
          <thead><tr><th style={{textAlign:'center'}}>#</th><th style={{textAlign:'left'}}>Team</th><th style={{textAlign:'center'}}>W</th><th style={{textAlign:'center'}}>L</th><th style={{textAlign:'center'}}>Win%</th></tr></thead>
          <tbody>
            {[...standings].sort((a,b)=>a.proj_standing-b.proj_standing).map(r => (
              <tr key={r.name} className={r.is_my_team ? 'fantasy-my-team' : ''}>
                <td style={{textAlign:'center'}}>{r.proj_standing}</td>
                <td>{r.name}</td>
                <td style={{textAlign:'center'}}>{r.proj_wins}</td>
                <td style={{textAlign:'center'}}>{r.proj_losses}</td>
                <td style={{textAlign:'center'}}>{r.proj_wins != null && r.proj_losses != null
                  ? ((r.proj_wins/(r.proj_wins+r.proj_losses+0.0001))*100).toFixed(1)+'%'
                  : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const addCount    = getSlugs.length + getSlugs2.length + pickSlugs.length
  const dropCount   = outSlugs.length + dropSlugs.length
  const rosterAfter = my_roster.length - dropCount + addCount
  const overLimit   = rosterAfter > 10
  const hasChanges  = addCount > 0 || dropCount > 0

  return (
    <div className="fantasy-wrap">

      {/* ── Player Movement — 3-column layout ── */}
      <div className="dash-card" style={{marginBottom:12}}>
        <div className="ra-movement-grid">

          {/* Col 1: My Roster */}
          <div>
            <div className="ra-trade-col-title ra-my-team-title">My Roster <span className="ra-col-sub">(click: trade out → drop → clear)</span></div>
            {my_roster.filter(p=>p.br_slug).map((p,i) => {
              const inTrade = outSlugs.find(o=>o.slug===p.br_slug)
              const inDrop  = dropSlugs.find(o=>o.slug===p.br_slug)
              return (
                <div key={p.espn_name+i}
                     className={`ra-player-chip${inTrade?' ra-chip-out':inDrop?' ra-chip-drop':''}`}
                     onClick={() => toggleOut(p.br_slug, p.espn_name)}>
                  {p.espn_name}
                </div>
              )
            })}
          </div>

          {/* Col 2: Movement summary */}
          <div className="ra-movement-summary">
            <div className="ra-move-box">
              <div className="ra-zone-label">OUT · Trade</div>
              {outSlugs.length === 0
                ? <span className="ra-zone-hint">1st click from My Roster</span>
                : outSlugs.map(p => (
                    <div key={p.slug} className="ra-zone-chip ra-zone-chip-out" style={{flexWrap:'wrap',gap:2}}>
                      <span style={{flex:1}}>{p.name}</span>
                      {tradeTeam2 && (
                        <button className="ra-chip-dest" onClick={()=>toggleOutDest(p.slug)}
                                title={`Going to: ${p.toTeam===2 ? tradeTeam2?.name : tradeTeam?.name}`}>
                          → {p.toTeam===2 ? 'T2' : 'T1'}
                        </button>
                      )}
                      <button className="ra-chip-remove" onClick={()=>{setOutSlugs(prev=>prev.filter(o=>o.slug!==p.slug));resetSim()}}>✕</button>
                    </div>
                  ))
              }
            </div>
            <div className="ra-move-box">
              <div className="ra-zone-label">IN · Trade</div>
              {getSlugs.length===0 && getSlugs2.length===0
                ? <span className="ra-zone-hint">Click from partner roster</span>
                : [...getSlugs, ...getSlugs2].map(p => (
                    <div key={p.slug} className="ra-zone-chip">
                      {p.name}<button className="ra-chip-remove" onClick={()=>{setGetSlugs(prev=>prev.filter(g=>g.slug!==p.slug));setGetSlugs2(prev=>prev.filter(g=>g.slug!==p.slug));resetSim()}}>✕</button>
                    </div>
                  ))
              }
            </div>
            <div className="ra-move-box">
              <div className="ra-zone-label">OUT · Drop</div>
              {dropSlugs.length === 0
                ? <span className="ra-zone-hint">2nd click from My Roster</span>
                : dropSlugs.map(p => (
                    <div key={p.slug} className="ra-zone-chip ra-zone-chip-out">
                      {p.name}<button className="ra-chip-remove" onClick={()=>{setDropSlugs(prev=>prev.filter(o=>o.slug!==p.slug));resetSim()}}>✕</button>
                    </div>
                  ))
              }
            </div>
            <div className="ra-move-box">
              <div className="ra-zone-label">IN · FA</div>
              {pickSlugs.length===0
                ? <span className="ra-zone-hint">Click from FA list</span>
                : pickSlugs.map(slug => (
                    <div key={slug} className="ra-zone-chip">
                      {freeAgents?.find(p=>p.br_slug===slug)?.espn_name||slug}
                      <button className="ra-chip-remove" onClick={()=>{setPickSlugs(prev=>prev.filter(s=>s!==slug));resetSim()}}>✕</button>
                    </div>
                  ))
              }
            </div>
          </div>

          {/* Col 3: Trade partner(s) + FA list */}
          <div className="ra-movement-selection">
            {/* Trade partner selectors */}
            <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
              <div className="ra-sim-col" style={{flex:1,minWidth:140}}>
                <label className="ra-sim-label">Trade partner</label>
                <select className="ra-sim-select"
                        value={tradeTeam?.team_id||''}
                        onChange={e => {
                          const t = otherTeams.find(t=>t.team_id===e.target.value)
                          setTradeTeam(t||null); setTradeTeam2(null); setGetSlugs([]); setGetSlugs2([]); resetSim()
                        }}>
                  <option value="">— None —</option>
                  {otherTeams.map(t=><option key={t.team_id} value={t.team_id}>{t.name}</option>)}
                </select>
              </div>
              {tradeTeam && (
                <div className="ra-sim-col" style={{flex:1,minWidth:140}}>
                  <label className="ra-sim-label">3rd team (optional)</label>
                  <select className="ra-sim-select"
                          value={tradeTeam2?.team_id||''}
                          onChange={e => {
                            const t = otherTeams.find(t=>t.team_id===e.target.value && t.team_id!==tradeTeam.team_id)
                            setTradeTeam2(t||null); setGetSlugs2([]); resetSim()
                          }}>
                    <option value="">— None —</option>
                    {otherTeams.filter(t=>t.team_id!==tradeTeam.team_id).map(t=><option key={t.team_id} value={t.team_id}>{t.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            {/* Partner roster(s) */}
            {[
              {team:tradeTeam,  gets:getSlugs,  setGets:setGetSlugs,  source:'theirs'},
              ...(tradeTeam2 ? [{team:tradeTeam2,gets:getSlugs2,setGets:setGetSlugs2,source:'theirs2'}] : []),
            ].filter(x=>x.team).map(({team,gets,setGets,source}) => (
              <div key={team.team_id} style={{marginBottom:8}}>
                <div className="ra-trade-col-title">{team.name} <span className="ra-col-sub">(click to get)</span></div>
                <div className="ra-partner-chips">
                  {(team.players||[]).filter(p=>p.br_slug).map((p,i) => (
                    <div key={p.espn_name+i}
                         className={`ra-player-chip${gets.find(g=>g.slug===p.br_slug)?' ra-chip-selected':''}`}
                         draggable
                         onDragStart={() => setDragging({slug:p.br_slug,name:p.espn_name,source})}
                         onClick={() => {
                           if (gets.find(g=>g.slug===p.br_slug)) setGets(prev=>prev.filter(g=>g.slug!==p.br_slug))
                           else setGets(prev=>[...prev,{slug:p.br_slug,name:p.espn_name}])
                           resetSim()
                         }}>
                      {p.espn_name}
                        </div>
                  ))}
                </div>
              </div>
            ))}
            {/* FA list */}
            {faLoading && <div className="dash-empty" style={{fontSize:12}}>Loading free agents…</div>}
            {freeAgents && (
              <div>
                <div className="ra-trade-col-title">Free Agents <span className="ra-col-sub">(click to pick up)</span></div>
                <input className="ra-fa-search" placeholder="Search…" value={faSearch} onChange={e=>setFaSearch(e.target.value)} />
                <div className="ra-waiver-list">
                  {freeAgents.filter(p=>p.stats&&(!faSearch||p.espn_name?.toLowerCase().includes(faSearch.toLowerCase()))).map((p,i)=>(
                    <div key={p.espn_name+i}
                         className={`ra-player-chip${pickSlugs.includes(p.br_slug)?' ra-chip-selected':''}`}
                         onClick={()=>{setPickSlugs(prev=>prev.includes(p.br_slug)?prev.filter(s=>s!==p.br_slug):[...prev,p.br_slug]);resetSim()}}>
                      <span>{p.espn_name}</span>
                      <span className="ra-chip-stats-row">
                        {tracked_cats.slice(0,5).map(cat=>(
                          <span key={cat} className="ra-chip-cat">{cat} {p.stats[catToKey[cat]]?.toFixed(1)??'—'}</span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* ── Simulate ── */}
      {overLimit && (
        <div className="ra-roster-warning">
          Roster would be {rosterAfter} — drop {rosterAfter-10} more player{rosterAfter-10>1?'s':''} to stay at 10
        </div>
      )}
      <button className="ra-simulate-btn" style={{marginTop:8,width:'100%'}}
              disabled={simLoading||!hasChanges||overLimit} onClick={simulate}>
        {simLoading ? 'Simulating…' : 'Simulate'}
      </button>
      {simErr && <div className="login-error" style={{marginTop:12}}>{simErr}</div>}

      {/* ── Results ── */}
      {simResult && (() => {
        const cats = simResult.tracked_cats || tracked_cats
        const neg  = new Set(simResult.neg_cats || [])

        // Build before and after roster lists
        const outSet = new Set([...outSlugs.map(p=>p.slug), ...dropSlugs.map(p=>p.slug)])
        const addedPlayers = [
          ...getSlugs.map(p=>({...p, from: tradeTeam?.name || 'Trade partner 1'})),
          ...getSlugs2.map(p=>({...p, from: tradeTeam2?.name || 'Trade partner 2'})),
          ...pickSlugs.map(slug=>({slug, name: freeAgents?.find(p=>p.br_slug===slug)?.espn_name||slug, from:'FA'}))
        ]
        const beforeRoster = my_roster.map(p => ({
          name: p.espn_name,
          stats: p.stats,
          isOut: outSet.has(p.br_slug),
          isNew: false,
        }))
        const afterRoster = [
          ...my_roster.filter(p=>!outSet.has(p.br_slug)).map(p=>({name:p.espn_name,stats:p.stats,isNew:false,isOut:false})),
          ...addedPlayers.map(a => {
            const fromTeam = [...(tradeTeam?.players||[]),...(tradeTeam2?.players||[])].find(p=>p.br_slug===a.slug)
            const fromFA   = freeAgents?.find(p=>p.br_slug===a.slug)
            return {name:a.name, stats:fromTeam?.stats||fromFA?.stats||null, isNew:true, isOut:false, from:a.from}
          })
        ]

        // Compute "after" cat_ranks from simResult.cat_beats_new
        const afterRanks = {}
        const total = simResult.total_teams || 1
        cats.forEach(cat => {
          const beats = simResult.cat_beats_new?.[cat]
          if (beats != null) afterRanks[cat] = {rank: total + 1 - beats, total: total + 1}
        })

        // Win% lookup helpers
        const myStandBefore = baseSim?.projected_standings?.find(r=>r.is_my_team)
        const myStandAfter  = simResult.projected_standings?.find(r=>r.is_my_team)
        const winPct = r => r ? ((r.proj_wins/(r.proj_wins+r.proj_losses+0.0001))*100).toFixed(1)+'%' : '—'

        return (
          <div style={{marginTop:20}}>

            {/* VS Each Opponent */}
            <div className="ra-section-title" style={{marginTop:0}}>VS Each Opponent</div>
            <div className="dash-card" style={{overflowX:'auto'}}>
              {(() => {
                const myTeam = teams.find(t => t.is_my_team)
                const total = simResult.total_teams ?? 1
                // Δbeats per cat: how many more teams I beat after the trade
                const catDelta = {}
                cats.forEach(cat => {
                  const bo = simResult.cat_beats_orig?.[cat] ?? 0
                  const bn = simResult.cat_beats_new?.[cat]  ?? 0
                  catDelta[cat] = bn - bo
                })
                const dCls = d => d > 0 ? 'ra-z-pos' : d < 0 ? 'ra-z-neg' : ''
                const dFmt = d => d === 0 ? '—' : (d > 0 ? '+' : '') + d
                return (
                  <table className="dash-table ra-table">
                    <thead>
                      <tr>
                        <th>Team</th>
                        <th>Win% Before</th>
                        <th>Win% After</th>
                        <th>H2H Before</th>
                        <th>H2H After</th>
                        {cats.map(c=><th key={c}>Δ{c}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {myTeam && (
                        <tr className="fantasy-my-team">
                          <td className="ra-player-name">{myTeam.name}</td>
                          <td>{winPct(myStandBefore)}</td>
                          <td>{winPct(myStandAfter)}</td>
                          <td>—</td>
                          <td>—</td>
                          {cats.map(cat => {
                            const d = catDelta[cat]
                            return <td key={cat} className={dCls(d)}>{dFmt(d)}</td>
                          })}
                        </tr>
                      )}
                      {otherTeams.map(t => {
                        let wB=0,lB=0,wA=0,lA=0
                        cats.forEach(cat => {
                          const key = catToKey[cat]; if(!key) return
                          const isN = neg.has(cat)
                          const their = t.stats?.[key]??0
                          const bef = simResult.orig_stats?.[key]??0
                          const aft = simResult.new_stats?.[key]??0
                          const dB = bef-their, dA = aft-their
                          if(isN?dB<-0.001:dB>0.001) wB++; else if(isN?dB>0.001:dB<-0.001) lB++
                          if(isN?dA<-0.001:dA>0.001) wA++; else if(isN?dA>0.001:dA<-0.001) lA++
                        })
                        const tStandB = baseSim?.projected_standings?.find(r=>r.name===t.name)
                        const tStandA = simResult.projected_standings?.find(r=>r.name===t.name)
                        const tWinPctB = tStandB ? ((tStandB.proj_wins/(tStandB.proj_wins+tStandB.proj_losses+0.0001))*100).toFixed(1)+'%' : '—'
                        const tWinPctA = tStandA ? ((tStandA.proj_wins/(tStandA.proj_wins+tStandA.proj_losses+0.0001))*100).toFixed(1)+'%' : '—'
                        const cB = wB>lB?'ra-score-win':wB<lB?'ra-score-loss':'ra-score-tie'
                        const cA = wA>lA?'ra-score-win':wA<lA?'ra-score-loss':'ra-score-tie'
                        return (
                          <tr key={t.team_id||t.name}>
                            <td className="ra-player-name">{t.name}</td>
                            <td>{tWinPctB}</td>
                            <td>{tWinPctA}</td>
                            <td className={cB}><strong>{wB}–{lB}</strong></td>
                            <td className={cA}><strong>{wA}–{lA}</strong></td>
                            {cats.map(cat => {
                              const d = catDelta[cat]
                              return <td key={cat} className={dCls(d)}>{dFmt(d)}</td>
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )
              })()}
            </div>

            {/* Squad Before / After */}
            <div className="ra-section-title" style={{marginTop:24}}>Squad Analysis</div>
            <div className="ra-before-after-grid">
              <RosterTable roster={beforeRoster} totals={simResult.orig_stats} ranks={cat_ranks} label="Before" />
              <RosterTable roster={afterRoster}  totals={simResult.new_stats}  ranks={afterRanks}  label="After"
                           beforeTotals={simResult.orig_stats} beforeRanks={cat_ranks} />
            </div>

          </div>
        )
      })()}
    </div>
  )
}

// ── Player Mapping ─────────────────────────────────────────────────────────────

const TIER_LABEL = { 1: 'Exact', 2: 'Fuzzy', 3: 'Manual', null: 'Unmatched' }
const TIER_CLS   = { 1: 'pm-tier-exact', 2: 'pm-tier-fuzzy', 3: 'pm-tier-manual', null: 'pm-tier-none' }

function PlayerMapping({ provider }) {
  const [data,        setData]        = useState(null)
  const [populating,  setPopulating]  = useState(false)
  const [popMsg,      setPopMsg]      = useState(null)
  const [search,      setSearch]      = useState('')
  const [filter,      setFilter]      = useState('all')   // all | unmatched | fuzzy | exact | manual
  const [editId,      setEditId]      = useState(null)    // provider_id being manually linked
  const [brSearch,    setBrSearch]    = useState('')
  const [brResults,   setBrResults]   = useState([])
  const [brLoading,   setBrLoading]   = useState(false)
  const [saveMsg,     setSaveMsg]     = useState(null)

  useEffect(() => { load() }, [provider])

  function load() {
    apiFetch(`/api/fantasy/player-map?provider=${provider}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .catch(() => {})
  }

  async function populate() {
    setPopulating(true); setPopMsg(null)
    try {
      const res = await apiFetch(`/api/fantasy/player-map/populate?provider=${provider}`, { method: 'POST' })
      const d   = await res.json()
      if (!res.ok) throw new Error(d.detail || 'Failed')
      setPopMsg(`Done — ${d.exact} exact, ${d.fuzzy} fuzzy, ${d.unmatched} unmatched out of ${d.total}`)
      load()
    } catch (e) { setPopMsg(e.message) }
    setPopulating(false)
  }

  // Search BR players by name
  useEffect(() => {
    if (brSearch.length < 2) { setBrResults([]); return }
    setBrLoading(true)
    apiFetch(`/api/fantasy/player-map/search-br?q=${encodeURIComponent(brSearch)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setBrResults(d.players || []) })
      .catch(() => {})
      .finally(() => setBrLoading(false))
  }, [brSearch])

  async function saveLink(provId, brSlug) {
    setSaveMsg(null)
    try {
      const res = await apiFetch('/api/fantasy/player-map', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, provider_id: provId, br_slug: brSlug }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed') }
      setEditId(null); setBrSearch(''); setBrResults([])
      load()
    } catch (e) { setSaveMsg(e.message) }
  }

  if (!data) return <div className="dash-empty">Loading…</div>

  const players = (data.players || [])
    .filter(p => !search || p.provider_name.toLowerCase().includes(search.toLowerCase())
                          || (p.br_name || '').toLowerCase().includes(search.toLowerCase()))
    .filter(p => {
      if (filter === 'unmatched') return !p.match_tier
      if (filter === 'fuzzy')    return p.match_tier === 2
      if (filter === 'exact')    return p.match_tier === 1
      if (filter === 'manual')   return p.match_tier === 3
      return true
    })

  const counts = (data.players || []).reduce((acc, p) => {
    const k = p.match_tier == null ? 'unmatched' : p.match_tier === 1 ? 'exact' : p.match_tier === 2 ? 'fuzzy' : 'manual'
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})

  return (
    <div className="fantasy-wrap">
      <div className="pm-header">
        <div className="pm-summary">
          <span className="pm-chip pm-chip-exact" onClick={() => setFilter(f => f === 'exact' ? 'all' : 'exact')}>
            {counts.exact || 0} Exact
          </span>
          <span className="pm-chip pm-chip-fuzzy" onClick={() => setFilter(f => f === 'fuzzy' ? 'all' : 'fuzzy')}>
            {counts.fuzzy || 0} Fuzzy
          </span>
          <span className="pm-chip pm-chip-manual" onClick={() => setFilter(f => f === 'manual' ? 'all' : 'manual')}>
            {counts.manual || 0} Manual
          </span>
          <span className="pm-chip pm-chip-none" onClick={() => setFilter(f => f === 'unmatched' ? 'all' : 'unmatched')}>
            {counts.unmatched || 0} Unmatched
          </span>
        </div>
        <div className="pm-actions">
          <input
            className="pm-search"
            placeholder="Search player…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="acct-connect-btn" onClick={populate} disabled={populating}>
            {populating ? 'Populating…' : 'Populate / Refresh'}
          </button>
        </div>
      </div>
      {popMsg && <div className={popMsg.startsWith('Done') ? 'pm-pop-ok' : 'login-error'}>{popMsg}</div>}
      {saveMsg && <div className="login-error">{saveMsg}</div>}

      <table className="dash-table pm-table">
        <thead>
          <tr><th>ESPN/Yahoo Name</th><th>BR Name</th><th>Match</th><th>Conf</th><th></th></tr>
        </thead>
        <tbody>
          {players.map(p => (
            <Fragment key={p.provider_id}>
              <tr className={!p.match_tier ? 'pm-row-unmatched' : p.match_tier === 2 && p.confidence < 90 ? 'pm-row-low' : ''}>
                <td>{p.provider_name}</td>
                <td>{p.br_name || <span className="pm-none">—</span>}</td>
                <td><span className={`pm-tier ${TIER_CLS[p.match_tier]}`}>{TIER_LABEL[p.match_tier]}</span></td>
                <td>{p.confidence != null ? `${p.confidence}%` : '—'}</td>
                <td>
                  <button className="pm-edit-btn" onClick={() => {
                    setEditId(editId === p.provider_id ? null : p.provider_id)
                    setBrSearch(''); setBrResults([])
                  }}>
                    {editId === p.provider_id ? 'Cancel' : 'Link'}
                  </button>
                </td>
              </tr>
              {editId === p.provider_id && (
                <tr className="pm-edit-row">
                  <td colSpan={5}>
                    <div className="pm-edit-inner">
                      <span className="pm-edit-label">Linking <strong>{p.provider_name}</strong> →</span>
                      <input
                        className="pm-search"
                        placeholder="Search BR name…"
                        value={brSearch}
                        onChange={e => setBrSearch(e.target.value)}
                        autoFocus
                      />
                      {brLoading && <span className="pm-edit-label">Searching…</span>}
                      {brResults.length > 0 && (
                        <ul className="pm-br-results">
                          {brResults.map(br => (
                            <li key={br.slug} className="pm-br-item" onClick={() => saveLink(p.provider_id, br.slug)}>
                              <span className="pm-br-name">{br.full_name}</span>
                              <span className="pm-br-meta">{br.team} · {br.season}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <button className="pm-unlink-btn" onClick={() => saveLink(p.provider_id, null)}>
                        Clear / Unmatch
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {players.length === 0 && (
        <div className="dash-empty">
          {(data.players || []).length === 0
            ? 'No players loaded yet — click "Populate / Refresh" to pull your league rosters.'
            : 'No players match your filter.'}
        </div>
      )}
    </div>
  )
}

// ── FantasyPage ────────────────────────────────────────────────────────────────

function FantasyPage() {
  const [status,      setStatus]      = useState(null)
  const [tab,         setTab]         = useState('dashboard')
  const [rosterData,  setRosterData]  = useState(null)
  const [rosterErr,   setRosterErr]   = useState(null)

  function loadStatus() {
    apiFetch('/api/fantasy/status')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStatus(d) })
      .catch(() => {})
  }

  useEffect(() => { loadStatus() }, [])

  // Fetch roster data once (shared between Roster Analysis + Trade Analysis tabs)
  useEffect(() => {
    if (!status?.espn?.team_key) return
    apiFetch('/api/fantasy/espn/roster-analysis')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setRosterData(d))
      .catch(() => setRosterErr('Failed to load roster — is ESPN connected?'))
  }, [status?.espn?.team_key])

  if (!status) return <div className="dash-empty">Loading…</div>

  const espn = status.espn || {}

  if (!espn.connected) return (
    <div className="fantasy-wrap">
      <div className="fantasy-connect-card">
        <h2 className="fantasy-connect-title">Connect your fantasy league</h2>
        <p className="fantasy-connect-sub">Go to <strong>Account</strong> (top right) to connect your ESPN or Yahoo league, then come back here.</p>
      </div>
    </div>
  )

  if (!espn.team_key) return (
    <EspnTeamPicker
      onPicked={loadStatus}
      onDisconnect={async () => {
        await apiFetch('/api/fantasy/espn/disconnect', { method: 'DELETE' })
        loadStatus()
      }}
    />
  )

  return (
    <div>
      <div className="fantasy-tabs">
        <button className={`fantasy-tab${tab === 'dashboard' ? ' active' : ''}`} onClick={() => setTab('dashboard')}>Dashboard</button>
        <button className={`fantasy-tab${tab === 'standings' ? ' active' : ''}`} onClick={() => setTab('standings')}>Projected Standings</button>
        <button className={`fantasy-tab${tab === 'roster'    ? ' active' : ''}`} onClick={() => setTab('roster')}>Roster Analysis</button>
        <button className={`fantasy-tab${tab === 'trade'     ? ' active' : ''}`} onClick={() => setTab('trade')}>Trade Analysis</button>
      </div>
      {tab === 'dashboard' && <ManagerDashboard />}
      {tab === 'standings' && <ProjectedStandings />}
      {tab === 'roster' && (rosterErr
        ? <div className="login-error" style={{margin:24}}>{rosterErr}</div>
        : !rosterData ? <div className="dash-empty">Loading…</div>
        : <RosterAnalysis data={rosterData} />
      )}
      {tab === 'trade' && (rosterErr
        ? <div className="login-error" style={{margin:24}}>{rosterErr}</div>
        : !rosterData ? <div className="dash-empty">Loading…</div>
        : <TradeAnalysis data={rosterData} />
      )}
    </div>
  )
}


function AppMain({ onLogout, onOpenAccount }) {
  const yahooConnected = new URLSearchParams(window.location.search).get('yahoo_connected')
  const [dark, setDark] = useState(() => localStorage.getItem('theme') !== 'light')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])
  const [page, setPage]               = useState(yahooConnected ? 'fantasy' : 'dashboard')
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
  const [projExpanded, setProjExpanded] = useState(false)
  const [projScenario, setProjScenario] = useState('baseline')
  const [usageExpanded, setUsageExpanded] = useState(false)
  const [usageUsg, setUsageUsg]           = useState(null)   // target USG% (null = use base)
  const [usageMinutes, setUsageMinutes]   = useState(null)   // target min/g (null = use base)
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
  const [schedProj, setSchedProj]           = useState(null)
  const [schedExpanded, setSchedExpanded]   = useState(false)
  const [schedPeriod, setSchedPeriod]       = useState('season')
  const [schedStat, setSchedStat]           = useState('pts')
  const [schedScenario, setSchedScenario]   = useState('mid')
  const [schedStartDate, setSchedStartDate] = useState(() => new Date().toISOString().slice(0, 10))

  // Compare tool state
  const [cmpExpanded, setCmpExpanded] = useState(false)
  const [cmpQuery,    setCmpQuery]    = useState('')
  const [cmpSuggs,    setCmpSuggs]    = useState([])
  const [cmpShow,     setCmpShow]     = useState(false)
  const [cmpPlayers,  setCmpPlayers]  = useState([]) // [{player, stats}]

  const searchRef   = useRef(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    if (yahooConnected) window.history.replaceState({}, '', '/')
  }, [])

  useEffect(() => {
    apiFetch('/api/data-range')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setDataRange(d) })
      .catch(() => {})
    apiFetch('/api/aging-curves')
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
    apiFetch(`/api/players?q=${encodeURIComponent(cmpQuery)}`)
      .then(r => r.json()).then(d => setCmpSuggs(Array.isArray(d) ? d : [])).catch(() => {})
  }, [cmpQuery])

  // Reset compare players when main player changes
  useEffect(() => { setCmpPlayers([]) }, [selectedPlayer])

  const fetchSuggestions = useCallback(async (q) => {
    if (!q.trim()) { setSuggestions([]); return }
    try {
      const res = await apiFetch(`/api/players?q=${encodeURIComponent(q)}`)
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
    setSchedProj(null)
    setMaLookback(20)
    setProjYear(1)
    setProjScenario('baseline')
    setUsageUsg(null)
    setUsageMinutes(null)
    apiFetch(`/api/player-stats?player=${encodeURIComponent(p.slug)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setPlayerStats(d) })
      .catch(() => {})
    apiFetch(`/api/project?player=${encodeURIComponent(p.slug)}&mpg=32`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setProjection(d)
          setProjMpg(Math.round(d.current_mpg))
        }
      })
      .catch(() => {})
    apiFetch(`/api/player-games?player=${encodeURIComponent(p.slug)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setPlayerGames(d)
          setGlEnd(d.length - 1)
          setGlStart(Math.max(0, d.length - 20))
        }
      })
      .catch(() => {})
    apiFetch(`/api/schedule-projection?player=${encodeURIComponent(p.slug)}&period=${schedPeriod}&start_date=${schedStartDate}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !d.error) setSchedProj(d) })
      .catch(() => {})
  }

  function fetchSchedProj(slug, period, startDate) {
    const sd = startDate ?? schedStartDate
    apiFetch(`/api/schedule-projection?player=${encodeURIComponent(slug)}&period=${period}&start_date=${sd}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !d.error) setSchedProj(d) })
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
      const res = await apiFetch(`/api/decompose?${params}`)
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
        apiFetch(`/api/game-log?${logParams}`)
          .then(r => r.ok ? r.json() : null)
          .then(rows => { if (rows) setGameLog(rows) })
          .catch(() => {})

        const shotParams = new URLSearchParams({
          player: selectedPlayer.slug,
          pa_start: periodA.start, pa_end: periodA.end,
          pb_start: periodB.start, pb_end: periodB.end,
        })
        if (stat === 'pts' || stat === 'fg3m') {
          apiFetch(`/api/shot-diet?${shotParams}`)
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

  // Projection row — recomputed whenever slider, year, or scenario changes
  const projScale = projMpg / 30.0
  const activeProjSrc = activeProj
    ? (projScenario === 'baseline' ? activeProj : activeProj[projScenario] ?? activeProj)
    : null
  const projRowData = activeProjSrc ? {
    pts:    +(activeProjSrc.projection_p30.pts    * projScale).toFixed(1),
    reb:    +(activeProjSrc.projection_p30.reb    * projScale).toFixed(1),
    ast:    +(activeProjSrc.projection_p30.ast    * projScale).toFixed(1),
    stl:    +(activeProjSrc.projection_p30.stl    * projScale).toFixed(1),
    blk:    +(activeProjSrc.projection_p30.blk    * projScale).toFixed(1),
    tov:    +(activeProjSrc.projection_p30.tov    * projScale).toFixed(1),
    fg3m:   +(activeProjSrc.projection_p30.fg3m   * projScale).toFixed(1),
    fg_pct: +activeProjSrc.projection_p30.fg_pct.toFixed(1),
    ft_pct: activeProjSrc.projection_p30.ft_pct ?? null,
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
  const getProjVal = (proj, scenario = 'baseline') => {
    const src = scenario === 'baseline' ? proj : (proj[scenario] ?? proj)
    if (projStat === 'z_sum')  return src.z_sum ?? null
    if (projStat === 'ft_pct') return src.projection_p30.ft_pct ?? null
    if (projStat === 'fg_pct') return +src.projection_p30.fg_pct.toFixed(1)
    return +(src.projection_p30[projStat] * projScale).toFixed(1)
  }

  const projLabels  = projection?.projections?.map(p => p.season) ?? []
  const trendLabels = [...trendSeasons.map(s => s.period), ...projLabels]
  const nHist = trendSeasons.length

  // Historical line: season values + nulls for projected slots
  const historicalVals = [
    ...trendSeasons.map(s => getStatVal(s, projStat)),
    ...projLabels.map(() => null),
  ]

  // Helper: build a projection line anchored to the last historical value
  const lastHistVal = nHist > 0 ? getStatVal(trendSeasons[nHist - 1], projStat) : null
  const buildProjLine = (scenario) => [
    ...trendSeasons.map((_, i) => i === nHist - 1 ? lastHistVal : null),
    ...(projection?.projections?.map(p => getProjVal(p, scenario)) ?? []),
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
      // Optimistic band top (filled down to pessimistic)
      {
        label: 'Optimistic',
        data: buildProjLine('optimistic'),
        borderColor: '#7c8cff',
        pointRadius: 0,
        borderWidth: 1.5,
        borderDash: [4, 4],
        tension: 0.2,
        spanGaps: false,
        fill: '+1',  // fill down to next dataset (pessimistic)
        backgroundColor: 'rgba(255,255,255,0.08)',
      },
      // Pessimistic band bottom
      {
        label: 'Pessimistic',
        data: buildProjLine('pessimistic'),
        borderColor: '#ff6b6b',
        pointRadius: 0,
        borderWidth: 1.5,
        borderDash: [4, 4],
        tension: 0.2,
        spanGaps: false,
        fill: false,
      },
      // Baseline — drawn last so it's on top
      {
        label: 'Baseline',
        data: buildProjLine('baseline'),
        borderColor: '#4dffb4',
        pointBackgroundColor: (ctx) => {
          const idx = ctx.dataIndex - nHist + 1
          return idx === projYear ? '#4dffb4' : 'rgba(77,255,180,0.4)'
        },
        pointRadius: (ctx) => {
          const idx = ctx.dataIndex - nHist + 1
          return idx >= 1 ? (idx === projYear ? 6 : 4) : 0
        },
        borderWidth: 2,
        borderDash: [5, 4],
        tension: 0.2,
        spanGaps: false,
        fill: false,
      },
    ],
  } : null

  const trendChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      datalabels: { display: false },
      legend: { display: false },
      tooltip: {
        mode: 'index',
        intersect: false,
        filter: (item) => item.parsed.y !== null,
        itemSort: (a, b) => {
          const order = ['Optimistic', 'Baseline', 'Pessimistic', 'Historical']
          return order.indexOf(a.dataset.label) - order.indexOf(b.dataset.label)
        },
        callbacks: {
          label: (ctx) => {
            const val = ctx.parsed.y
            if (val === null || val === undefined) return null
            const formatted = (projStat === 'fg_pct' || projStat === 'ft_pct') ? `${val}%` : val
            return ` ${ctx.dataset.label}: ${formatted}`
          },
          labelColor: (ctx) => ({
            borderColor: ctx.dataset.borderColor,
            backgroundColor: ctx.dataset.borderColor,
          }),
        },
        backgroundColor: '#1c1c1c',
        borderColor: '#333',
        borderWidth: 1,
        titleColor: '#888',
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

  function ProjectionRow({ label, data, note, scenario }) {
    if (!data) return null
    const scenarioLabel = scenario === 'optimistic' ? 'Optimistic' : scenario === 'pessimistic' ? 'Pessimistic' : 'Baseline'
    const scenarioColor = scenario === 'optimistic' ? '#7c8cff' : scenario === 'pessimistic' ? '#ff6b6b' : '#4dffb4'
    return (
      <tr className="stats-row-projection">
        <td className="stats-period-cell">
          <div>{label}{note && <span className="archetype-transition" title={`Projected archetype: ${note}`}> ↓</span>}</div>
          <div><span className="forecast-badge" style={{ color: scenarioColor, borderColor: scenarioColor }}>{scenarioLabel}</span></div>
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
              <td className="num mono stat-cell" style={{ color: scenarioColor }}>{display}</td>
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
            <button className={`nav-btn${page === 'dashboard' ? ' active' : ''}`} onClick={() => setPage('dashboard')}>Home</button>
            <button className={`nav-btn${page === 'rankings' ? ' active' : ''}`} onClick={() => setPage('rankings')}>Rankings</button>
            <button className={`nav-btn${page === 'boxscores' ? ' active' : ''}`} onClick={() => setPage('boxscores')}>Box Scores</button>
            <button className={`nav-btn${page === 'projections' ? ' active' : ''}`} onClick={() => setPage('projections')}>Projections</button>
            <button className={`nav-btn${page === 'injuries' ? ' active' : ''}`} onClick={() => setPage('injuries')}>Injuries &amp; News</button>
            <button className={`nav-btn${page === 'depth' ? ' active' : ''}`} onClick={() => setPage('depth')}>Depth Charts</button>
            <button className={`nav-btn${page === 'fantasy' ? ' active' : ''}`} onClick={() => setPage('fantasy')}>Fantasy</button>
          </nav>
          <div className="header-search-wrap" ref={searchRef}>
            <input
              className="header-search-input"
              type="text"
              placeholder="Search player…"
              value={query}
              onChange={e => { setQuery(e.target.value); setSelected(null); setShowSugg(true) }}
              onFocus={() => setShowSugg(true)}
            />
            {showSugg && suggestions.length > 0 && (
              <ul className="header-suggestions suggestions">
                {suggestions.map(p => (
                  <li key={p.slug} onMouseDown={() => { selectPlayer(p); setPage('player') }}>
                    <span className="sugg-name">{p.name}</span>
                    <span className="sugg-team">{p.team}</span>
                    {p.injury && <InjuryBadge injury={p.injury} compact />}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="nav-account">
            <button className="theme-toggle" onClick={() => setDark(d => !d)} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
              {dark ? '☀︎' : '☾'}
            </button>
            <button className="acct-btn" onClick={onOpenAccount}>Account</button>
            <button className="logout-btn" onClick={onLogout}>Sign out</button>
          </div>
        </div>
      </header>

      {/* ── Page body ──────────────────────────────────────── */}
      <main className="page-body">

      {page === 'dashboard' && <DashboardPage onSelectPlayer={p => { selectPlayer(p); setPage('player') }} />}

      {page === 'rankings' && <RankingsPage onSelectPlayer={p => { selectPlayer(p); setPage('player') }} />}

      {page === 'boxscores' && <BoxScorePage onSelectPlayer={p => { selectPlayer(p); setPage('player') }} />}

      {page === 'projections' && <ProjectionsPage onSelectPlayer={p => { selectPlayer(p); setPage('player') }} />}

      {page === 'injuries' && <InjuriesPage onSelectPlayer={p => { selectPlayer(p); setPage('player') }} />}

      {page === 'depth' && <DepthChartsPage onSelectPlayer={p => { selectPlayer(p); setPage('player') }} />}

      {page === 'fantasy' && <FantasyPage />}

      {page === 'player' && <>
        {error && <div className="error-banner">{error}</div>}
        {!selectedPlayer && (
          <div className="dash-empty" style={{ textAlign: 'center', paddingTop: 60 }}>
            Search for a player using the bar above.
          </div>
        )}

        {/* ── Player profile ────────────────────────────────── */}
        {selectedPlayer && playerStats && (
          <div className="player-profile">
            <div className="player-profile-header">
              <h2 className="player-name">{playerStats.player.name}</h2>
              <span className="player-team">{teamAbbr(playerStats.player.team)}</span>
              {playerStats.player.position && (
                <span className="player-age">{posAbbr(playerStats.player.position)}</span>
              )}
              {playerStats.player.age && (
                <span className="player-age">Age {playerStats.player.age}</span>
              )}
              {projection?.archetype && (
                <span className="archetype-badge">{projection.archetype}</span>
              )}
              {playerStats.player.injury && (
                <InjuryBadge injury={playerStats.player.injury} compact={false} />
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
                    scenario={projScenario}
                  />
                  <StatsRow label="Career" data={{ ...playerStats.career, rank: null }} highlight="career" />
                </tbody>
              </table>
            </div>

            {/* ── Comments ──────────────────────────────────────── */}
            <CommentsSection playerSlug={selectedPlayer?.slug} />

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
                  apiFetch(`/api/player-stats?player=${p.slug}`)
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
                        {result.schedule_difficulty && (() => {
                          const f = result.schedule_difficulty.period_a
                          const pct = ((f - 1) * 100).toFixed(0)
                          const label = `${pct >= 0 ? '+' : ''}${pct}%`
                          return <span className="metric-sched" style={{ color: f >= 1 ? '#4dffb4' : '#ff6b6b' }}>Sched {label}</span>
                        })()}
                      </div>
                      <div className="metric-card">
                        <span className="metric-label">Rate change</span>
                        <span className="metric-value" style={{ color: CATEGORY_COLORS.skill }}>
                          {skillSum >= 0 ? '+' : ''}{skillSum.toFixed(2)}
                        </span>
                        <span className="metric-sub">rate changes</span>
                      </div>
                      <div className="metric-card">
                        <span className="metric-label">Role</span>
                        <span className="metric-value" style={{ color: CATEGORY_COLORS.role }}>
                          {roleSum >= 0 ? '+' : ''}{roleSum.toFixed(2)}
                        </span>
                        <span className="metric-sub">minutes / usage</span>
                      </div>
                      {(stat === 'stl' || stat === 'blk') && (
                      <div className="metric-card">
                        <span className="metric-label">Pace</span>
                        <span className={`metric-value ${luckSum >= 0 ? 'pos' : 'neg'}`}>
                          {luckSum >= 0 ? '+' : ''}{luckSum.toFixed(2)}
                        </span>
                        <span className="metric-sub">external factors</span>
                      </div>
                      )}
                      <div className="metric-card">
                        <span className="metric-label">Comparison</span>
                        <span className="metric-value">{result.period_b.value.toFixed(1)}</span>
                        <span className={`metric-sub metric-delta ${result.delta >= 0 ? 'pos' : 'neg'}`}>
                          {result.delta >= 0 ? '+' : ''}{result.delta.toFixed(2)}&ensp;
                          ({result.delta >= 0 ? '+' : ''}{((result.delta / result.period_a.value) * 100).toFixed(1)}%)
                        </span>
                        {result.schedule_difficulty && (() => {
                          const f = result.schedule_difficulty.period_b
                          const pct = ((f - 1) * 100).toFixed(0)
                          const label = `${pct >= 0 ? '+' : ''}${pct}%`
                          return <span className="metric-sched" style={{ color: f >= 1 ? '#4dffb4' : '#ff6b6b' }}>Sched {label}</span>
                        })()}
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
                      return (
                        <div className="shot-diet-section">
                          <h2 className="panel-title">Shot diet analysis</h2>
                          <div className="shot-summary">
                            <div className="shot-metric"><span className="metric-label">Baseline FG%</span><span className="metric-value">{(shotDiet.fg_pct_a * 100).toFixed(1)}%</span></div>
                            <div className="shot-metric"><span className="metric-label">Selection effect</span><span className={`metric-value ${shotDiet.diet_total >= 0 ? 'pos' : 'neg'}`}>{shotDiet.diet_total >= 0 ? '+' : ''}{(shotDiet.diet_total * 100).toFixed(1)}pp</span><span className="metric-sub">shot mix shift</span></div>
                            <div className="shot-metric"><span className="metric-label">Efficiency effect</span><span className={`metric-value ${shotDiet.efficiency_total >= 0 ? 'pos' : 'neg'}`}>{shotDiet.efficiency_total >= 0 ? '+' : ''}{(shotDiet.efficiency_total * 100).toFixed(1)}pp</span><span className="metric-sub">zone accuracy</span></div>
                            <div className="shot-metric"><span className="metric-label">Comparison FG%</span><span className="metric-value">{(shotDiet.fg_pct_b * 100).toFixed(1)}%</span><span className={`metric-sub metric-delta ${shotDiet.delta >= 0 ? 'pos' : 'neg'}`}>{shotDiet.delta >= 0 ? '+' : ''}{(shotDiet.delta * 100).toFixed(1)}pp</span></div>
                          </div>
                          <div className="courts-row">
                            <div className="court-wrap"><div className="court-label">Baseline</div><CourtDiagram zones={courtZonesA} period={`${result.period_a.start} – ${result.period_a.end}`} /></div>
                            <div className="court-wrap"><div className="court-label">Comparison</div><CourtDiagram zones={courtZonesB} period={`${result.period_b.start} – ${result.period_b.end}`} /></div>
                          </div>
                          <div className="court-legend">
                            <span className="court-legend-item"><span className="court-legend-swatch" style={{ background: 'rgba(77,255,180,0.45)' }} />Positive net contribution</span>
                            <span className="court-legend-item"><span className="court-legend-swatch" style={{ background: 'rgba(255,107,107,0.45)' }} />Negative net contribution</span>
                            <span className="court-legend-item"><span className="court-legend-swatch" style={{ background: '#1e2235' }} />Neutral / no shots</span>
                            <span className="court-legend-note">Colour intensity = magnitude · Labels = shot frequency</span>
                          </div>
                          <table className="shot-table">
                            <thead><tr><th>Zone</th><th className="num">Baseline FG%</th><th className="num">Selection impact</th><th className="num">Efficiency impact</th><th className="num">Comp FG%</th></tr></thead>
                            <tbody>
                              {zoneRows.filter(z => z.fga_a > 0 || z.fga_b > 0).map(z => {
                                const fgShift = Math.round((z.fg_pct_b - z.fg_pct_a) * 100)
                                return (
                                  <tr key={z.zone}>
                                    <td>{ZONE_LABELS[z.zone]}</td>
                                    <td className="num mono">{z.fga_a > 0 ? `${Math.round(z.fg_pct_a * 100)}%` : '—'}</td>
                                    <td className={`num mono ${z.diet_effect >= 0 ? 'pos' : 'neg'}`}>{z.diet_effect >= 0 ? '+' : ''}{(z.diet_effect * 100).toFixed(1)}</td>
                                    <td className={`num mono ${z.efficiency_effect >= 0 ? 'pos' : 'neg'}`}>{z.efficiency_effect >= 0 ? '+' : ''}{(z.efficiency_effect * 100).toFixed(1)}</td>
                                    <td className="num mono">{z.fga_b > 0 ? `${Math.round(z.fg_pct_b * 100)}% (${fgShift >= 0 ? '+' : ''}${fgShift}pp)` : '—'}</td>
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

            {/* ── Schedule projection ───────────────────────── */}
            {schedProj && schedProj.games.length > 0 && (
              <div className="projection-section">
                <div className="projection-header" onClick={() => setSchedExpanded(e => !e)} style={{ cursor: 'pointer' }}>
                  <h3 className="panel-title">Upcoming Games</h3>
                  <span className="proj-toggle">{schedExpanded ? '▲' : '▼'}</span>
                </div>
                {schedExpanded && (() => {
                  const SCHED_COLS = [
                    { key: 'pts',  label: 'PTS' },
                    { key: 'reb',  label: 'REB' },
                    { key: 'ast',  label: 'AST' },
                    { key: 'stl',  label: 'STL' },
                    { key: 'blk',  label: 'BLK' },
                    { key: 'tov',  label: 'TOV', invert: true },
                    { key: 'fg3m', label: '3PM' },
                  ]
                  const SCHED_STAT_OPTS = [
                    { key: 'pts', label: 'Points' }, { key: 'reb', label: 'Rebounds' },
                    { key: 'ast', label: 'Assists' }, { key: 'stl', label: 'Steals' },
                    { key: 'blk', label: 'Blocks' }, { key: 'tov', label: 'Turnovers' },
                    { key: 'fg3m', label: '3-Pointers' },
                  ]

                  // SOS
                  const sosFactors = schedProj.games.map(g => (g.factors['pts'] ?? 1 + (2 - (g.factors['tov'] ?? 1))) / 2)
                  const sosAvg = sosFactors.reduce((a, b) => a + b, 0) / sosFactors.length
                  const sosPct = Math.min(Math.max((sosAvg - 0.85) / 0.3, 0), 1)
                  const sosLabel = sosAvg > 1.05 ? 'Easy slate' : sosAvg < 0.95 ? 'Hard slate' : 'Neutral difficulty'
                  const sosColor = sosAvg > 1.05 ? '#4dffb4' : sosAvg < 0.95 ? '#ff6b6b' : '#aaa'
                  const periodLabel = { season: 'Season', l30: 'Last 30', l14: 'Last 14' }[schedProj.period] || 'Season'
                  const todayStr = new Date().toISOString().slice(0, 10)

                  // Chart data for selected stat
                  const chartLabels = schedProj.games.map(g => `${g.date.slice(5)} ${g.home_away === 'Home' ? 'vs' : '@'} ${g.opponent.split(' ').pop()}`)
                  const midVals  = schedProj.games.map(g => g.projected[schedStat])
                  const lowVals  = schedProj.games.map(g => g.projected_low?.[schedStat] ?? g.projected[schedStat])
                  const highVals = schedProj.games.map(g => g.projected_high?.[schedStat] ?? g.projected[schedStat])
                  const coneColor = 'rgba(77,255,180,0.12)'
                  const lineColor = '#4dffb4'

                  const chartData = {
                    labels: chartLabels,
                    datasets: [
                      {
                        label: 'High',
                        data: highVals,
                        borderColor: 'transparent',
                        backgroundColor: coneColor,
                        fill: '+1',
                        pointRadius: 0,
                        tension: 0.3,
                      },
                      {
                        label: 'Low',
                        data: lowVals,
                        borderColor: 'transparent',
                        backgroundColor: 'transparent',
                        fill: false,
                        pointRadius: 0,
                        tension: 0.3,
                      },
                      {
                        label: 'Projected',
                        data: midVals,
                        borderColor: lineColor,
                        backgroundColor: 'transparent',
                        fill: false,
                        pointRadius: 4,
                        pointBackgroundColor: lineColor,
                        borderWidth: 2,
                        tension: 0.3,
                      },
                    ],
                  }
                  const chartOptions = {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      datalabels: { display: false },
                      tooltip: {
                        callbacks: {
                          label: (ctx) => {
                            if (ctx.datasetIndex !== 2) return null
                            const i = ctx.dataIndex
                            return [`Mid: ${midVals[i]?.toFixed(1)}`, `Low: ${lowVals[i]?.toFixed(1)}`, `High: ${highVals[i]?.toFixed(1)}`]
                          },
                        },
                      },
                    },
                    scales: {
                      x: { ticks: { color: '#666', font: { size: 10 } }, grid: { color: '#1e2235' } },
                      y: { ticks: { color: '#666' }, grid: { color: '#1e2235' }, beginAtZero: true },
                    },
                  }

                  return (
                    <div className="sched-proj-wrap">
                      {/* Controls */}
                      <div className="sched-controls">
                        <div className="rank-pills">
                          {['season', 'l30', 'l14'].map(p => (
                            <button key={p} className={`rank-pill${schedPeriod === p ? ' active' : ''}`}
                              onClick={() => { setSchedPeriod(p); fetchSchedProj(selectedPlayer.slug, p) }}>
                              {p === 'season' ? 'Season' : p === 'l30' ? 'L30' : 'L14'}
                            </button>
                          ))}
                        </div>
                        <div className="sched-date-wrap">
                          <span className="ctrl-label">From</span>
                          <input type="date" className="proj-date-input" min={todayStr} value={schedStartDate}
                            onChange={e => {
                              const v = e.target.value
                              if (v >= todayStr) { setSchedStartDate(v); fetchSchedProj(selectedPlayer.slug, schedPeriod, v) }
                            }} />
                        </div>
                        <div className="sos-bar-wrap">
                          <span className="sos-label" style={{ color: sosColor }}>{sosLabel}</span>
                          <div className="sos-bar-track">
                            <div className="sos-bar-fill" style={{ width: `${sosPct * 100}%`, background: sosColor }} />
                          </div>
                        </div>
                      </div>
                      <p className="sched-proj-note">
                        Based on {periodLabel} avg · opponent defence vs {schedProj.position}s · {schedProj.games_in_window}G sample
                        {schedProj.b2b_games >= 3 && ` · B2B factor from ${schedProj.b2b_games}G`}
                      </p>

                      {/* Confidence cone chart */}
                      <div className="sched-chart-header">
                        <select className="sched-stat-select" value={schedStat} onChange={e => setSchedStat(e.target.value)}>
                          {SCHED_STAT_OPTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                        </select>
                      </div>
                      <div className="sched-cone-wrap">
                        <Line data={chartData} options={chartOptions} />
                      </div>

                      {/* Table */}
                      <div className="sched-table-header">
                        <div className="rank-pills">
                          {['low', 'mid', 'high'].map(s => (
                            <button key={s} className={`rank-pill${schedScenario === s ? ' active' : ''}`}
                              onClick={() => setSchedScenario(s)}>
                              {s.charAt(0).toUpperCase() + s.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="sched-table-scroll">
                        <table className="sched-proj-table">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Opp</th>
                              <th></th>
                              {SCHED_COLS.map(c => <th key={c.key} className="num">{c.label}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {schedProj.games.map((g, i) => {
                              return (
                                <tr key={i}>
                                  <td className="sched-date">
                                    {g.date.slice(5)}
                                    {g.is_b2b && <span className="b2b-badge">B2B</span>}
                                  </td>
                                  <td className="sched-opp">{g.opponent.split(' ').pop()}</td>
                                  <td className="sched-ha muted">{g.home_away === 'Home' ? 'vs' : '@'}</td>
                                  {SCHED_COLS.map(c => {
                                    // TOV is inverted: pessimistic (low) = more TOV = projected_high
                                    const scenarioForStat = (c.invert && schedScenario !== 'mid')
                                      ? (schedScenario === 'low' ? 'high' : 'low')
                                      : schedScenario
                                    const projData = scenarioForStat === 'low' ? g.projected_low
                                                   : scenarioForStat === 'high' ? g.projected_high
                                                   : g.projected
                                    const val = projData?.[c.key]
                                    return (
                                      <td key={c.key} className="num mono sched-stat">
                                        {val != null ? val.toFixed(1) : '—'}
                                      </td>
                                    )
                                  })}
                                </tr>
                              )
                            })}
                            <tr className="sched-baseline-row">
                              <td colSpan={3} className="sched-baseline-label">{periodLabel} avg</td>
                              {SCHED_COLS.map(c => (
                                <td key={c.key} className="num mono muted">{schedProj.baseline[c.key] != null ? schedProj.baseline[c.key].toFixed(1) : '—'}</td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}

            {/* ── Usage / Minutes Projector ─────────────────── */}
            {playerStats?.seasons?.[0] && (() => {
              const base    = playerStats.seasons[0]
              const baseMpg = base.min_pg  ?? 30
              const baseUsg = base.usg_pct ?? 20
              const effMin  = usageMinutes ?? baseMpg
              const effUsg  = usageUsg    ?? baseUsg

              const minScale = effMin / baseMpg
              const deltaUsg = effUsg - baseUsg
              const usgScale = effUsg / baseUsg

              // PTS/3PM: usage volume scale + small efficiency decay on FG%
              // Empirical: -0.045% FG% per +1% USG (Part 1 YoY analysis, n=1430)
              // Decay only when usage increases; no boost for lower usage
              const fgDecay  = deltaUsg > 0 ? Math.max(0.90, 1 - deltaUsg * 0.00045) : 1.0

              // Defensive stats: sub-linear with minutes (α=0.75, Parts 2 confirmed)
              // Usage → defense: no penalty — YoY data shows no negative relationship
              const defScale = Math.pow(minScale, 0.75)

              // FG%/FT%: apply usage decay to FG% only; FT% has no meaningful causal signal
              // Minutes → shooting: positive in data but selection effect, not applied causally
              const projFgPct = base.fg_pct != null
                ? +(base.fg_pct + deltaUsg * (-0.045)).toFixed(1)
                : null
              const projFtPct = base.ft_pct != null
                ? +base.ft_pct.toFixed(1)   // unchanged — no causal relationship found
                : null

              const proj = {
                pts:    +(base.pts  * minScale * usgScale * fgDecay).toFixed(1),
                ast:    +(base.ast  * minScale * usgScale).toFixed(1),
                tov:    +(base.tov  * minScale * usgScale * 1.08).toFixed(1),
                fg3m:   +(base.fg3m * minScale * usgScale * fgDecay).toFixed(1),
                reb:    +(base.reb  * defScale).toFixed(1),
                stl:    +(base.stl  * defScale).toFixed(1),
                blk:    +(base.blk  * defScale).toFixed(1),
                fg_pct: projFgPct,
                ft_pct: projFtPct,
              }

              const changed = effMin !== baseMpg || effUsg !== baseUsg

              const USAGE_ROWS = [
                { key: 'pts',    label: 'PTS',  tag: 'USG', pct: false },
                { key: 'ast',    label: 'AST',  tag: 'USG', pct: false },
                { key: 'tov',    label: 'TOV',  tag: 'USG', pct: false },
                { key: 'fg3m',   label: '3PM',  tag: 'USG', pct: false },
                { key: 'fg_pct', label: 'FG%',  tag: 'USG', pct: true  },
                { key: 'ft_pct', label: 'FT%',  tag: '—',   pct: true  },
                { key: 'reb',    label: 'REB',  tag: 'MIN', pct: false },
                { key: 'stl',    label: 'STL',  tag: 'MIN', pct: false },
                { key: 'blk',    label: 'BLK',  tag: 'MIN', pct: false },
              ]

              return (
                <div className="projection-section">
                  <div className="projection-header" onClick={() => setUsageExpanded(e => !e)} style={{ cursor: 'pointer' }}>
                    <h3 className="panel-title">Usage Projector</h3>
                    <span className="proj-toggle">{usageExpanded ? '▲' : '▼'}</span>
                  </div>
                  {usageExpanded && (
                    <>
                    <div className="usage-sliders">
                      <div className="mpg-slider-row">
                        <span className="ctrl-label">Minutes/game</span>
                        <input
                          type="range" min={10} max={42} step={0.5}
                          value={effMin}
                          onChange={e => setUsageMinutes(+e.target.value)}
                          className="mpg-slider"
                        />
                        <span className="mpg-value">{effMin.toFixed(1)}</span>
                        {usageMinutes !== null && (
                          <button className="usage-reset-btn" onClick={() => setUsageMinutes(null)}>reset</button>
                        )}
                      </div>
                      <div className="mpg-slider-row">
                        <span className="ctrl-label">Usage%</span>
                        <input
                          type="range" min={5} max={45} step={0.5}
                          value={effUsg}
                          onChange={e => setUsageUsg(+e.target.value)}
                          className="mpg-slider"
                        />
                        <span className="mpg-value">{effUsg.toFixed(1)}%</span>
                        {usageUsg !== null && (
                          <button className="usage-reset-btn" onClick={() => setUsageUsg(null)}>reset</button>
                        )}
                      </div>
                    </div>

                    {changed && defScale !== minScale && (
                      <p className="usage-decay-note">
                        REB/STL/BLK scaled at min^0.75 (sub-linear — empirically confirmed).
                        {deltaUsg > 5 ? ` FG% adjusted ${(deltaUsg * -0.045).toFixed(2)}% for USG increase.` : ''}
                      </p>
                    )}

                    <table className="usage-table">
                      <thead>
                        <tr>
                          <th className="usage-th-stat"></th>
                          <th className="usage-th-num">Base</th>
                          <th className="usage-th-num">Projected</th>
                          <th className="usage-th-num">Δ</th>
                          <th className="usage-th-tag"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {USAGE_ROWS.map(({ key, label, tag, pct }) => {
                          const bv  = base[key] ?? null
                          const pv  = proj[key] ?? null
                          if (bv === null || pv === null) return null
                          const delta = pv - bv
                          const fmt = v => pct ? `${v.toFixed(1)}%` : v.toFixed(1)
                          const fmtD = d => `${d >= 0 ? '+' : ''}${pct ? d.toFixed(1) + '%' : d.toFixed(1)}`
                          return (
                            <tr key={key}>
                              <td className="usage-td-stat">{label}</td>
                              <td className="usage-td-num muted">{fmt(bv)}</td>
                              <td className="usage-td-num">{fmt(pv)}</td>
                              <td className="usage-td-num usage-delta">
                                {changed ? fmtD(delta) : '—'}
                              </td>
                              <td className="usage-td-tag">
                                <span className={`usage-tag${tag === 'MIN' ? ' usage-tag-min' : tag === '—' ? ' usage-tag-min' : ''}`}>{tag}</span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <p className="usage-note">
                      Base: {base.period} avg · {baseMpg.toFixed(1)} min/g · {baseUsg.toFixed(1)}% USG
                      {changed && effUsg !== baseUsg && ` → ${effUsg.toFixed(1)}% USG`}
                    </p>
                    </>
                  )}
                </div>
              )
            })()}

            {/* ── Projection controls + trend chart ────────── */}
            {projection && (
              <div className="projection-section">
                <div className="projection-header" onClick={() => setProjExpanded(e => !e)} style={{ cursor: 'pointer' }}>
                  <h3 className="panel-title">Career Projection</h3>
                  <span className="proj-toggle">{projExpanded ? '▲' : '▼'}</span>
                </div>

                {projExpanded && <>
                <div className="proj-scenario-row">
                  {['pessimistic', 'baseline', 'optimistic'].map(s => (
                    <button
                      key={s}
                      className={`proj-scenario-btn${projScenario === s ? ' active' : ''} proj-scenario-${s}`}
                      onClick={() => setProjScenario(s)}
                    >
                      {s === 'pessimistic' ? 'Pessimistic' : s === 'baseline' ? 'Baseline' : 'Optimistic'}
                    </button>
                  ))}
                </div>
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

export default function App() {
  const [token,       setToken]       = useState(() => localStorage.getItem('nba_token'))
  const [showAccount, setShowAccount] = useState(false)

  function handleLogin(t)      { localStorage.setItem('nba_token', t); setToken(t) }
  function handleLogout()      { localStorage.removeItem('nba_token'); setToken(null) }
  function handleTokenRefresh(t) { localStorage.setItem('nba_token', t); setToken(t) }

  if (!token) return <LoginPage onLogin={handleLogin} />
  return <>
    <AppMain onLogout={handleLogout} onOpenAccount={() => setShowAccount(true)} />
    {showAccount && (
      <AccountModal
        onClose={() => setShowAccount(false)}
        onTokenRefresh={t => { handleTokenRefresh(t); setShowAccount(false) }}
      />
    )}
  </>
}
