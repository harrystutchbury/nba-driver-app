import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from 'react'
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
    if (res.status === 401 && token) {
      localStorage.removeItem('nba_token')
      window.location.reload()
    }
    return res
  })
}

// ── Account settings modal ────────────────────────────────────────────────────

// ── Fantasy connections section (inside Account modal) ─────────────────────────

function FantasyConnectionsSection() {
  const [status,       setStatus]      = useState(null)
  const [espnS2,       setEspnS2]      = useState('')
  const [swid,         setSwid]        = useState('')
  const [leagueId,     setLeagueId]    = useState('')
  const [showForm,     setShowForm]    = useState(false)
  const [loading,      setLoading]     = useState(false)
  const [msg,          setMsg]         = useState(null)
  const [yahooLeagues, setYahooLeagues] = useState(null)
  const [yahooLoading, setYahooLoading] = useState(false)

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

      {/* Yahoo league picker — shown when connected but no league selected */}
      {yahoo.connected && (
        <div style={{marginTop:8,paddingLeft:4}}>
          {yahoo.league_key ? (
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:13,color:'var(--muted)'}}>League selected ✓</span>
              <button className="acct-disconnect-btn" onClick={() => {
                setYahooLeagues(null)
                setYahooLoading(true)
                apiFetch('/api/fantasy/leagues').then(r => r.ok ? r.json() : Promise.reject()).then(d => setYahooLeagues(d)).catch(() => setYahooLeagues([])).finally(() => setYahooLoading(false))
              }}>Change league</button>
            </div>
          ) : (
            <div>
              <p style={{fontSize:13,color:'var(--muted)',marginBottom:8}}>Select your Yahoo Fantasy Basketball league:</p>
              {!yahooLeagues && !yahooLoading && (
                <button className="acct-connect-btn" onClick={() => {
                  setYahooLoading(true)
                  apiFetch('/api/fantasy/leagues').then(r => r.ok ? r.json() : Promise.reject()).then(d => setYahooLeagues(d)).catch(() => setYahooLeagues([])).finally(() => setYahooLoading(false))
                }}>Load my leagues</button>
              )}
              {yahooLoading && <span style={{fontSize:13,color:'var(--muted)'}}>Loading leagues…</span>}
              {yahooLeagues && yahooLeagues.length === 0 && <span style={{fontSize:13,color:'var(--muted)'}}>No NBA leagues found.</span>}
              {yahooLeagues && yahooLeagues.length > 0 && yahooLeagues.map(l => (
                <div key={l.league_key} style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                                                padding:'8px 12px',marginBottom:4,borderRadius:6,
                                                background:'var(--surface-2)',border:'1px solid var(--border)'}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:600,color:'var(--text)'}}>{l.name}</div>
                    <div style={{fontSize:11,color:'var(--muted)'}}>{l.num_teams} teams · {l.season}</div>
                  </div>
                  <button className="acct-connect-btn" style={{marginLeft:12}} onClick={async () => {
                    setYahooLoading(true); setMsg(null)
                    try {
                      const res = await apiFetch('/api/fantasy/select-league', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({league_key:l.league_key}) })
                      if (!res.ok) { const d=await res.json(); throw new Error(d.detail||'Failed') }
                      setMsg({ type:'ok', text:'League selected!' })
                      setYahooLeagues(null)
                      loadStatus()
                    } catch(e) { setMsg({ type:'err', text:e.message }) }
                    setYahooLoading(false)
                  }}>Select</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AccountModal({ onClose, onTokenRefresh, autoUpgrade = null }) {
  const [me,          setMe]          = useState(null)
  const [displayName, setDisplayName] = useState('')
  const [email,       setEmail]       = useState('')
  const [curPw,       setCurPw]       = useState('')
  const [newPw,       setNewPw]       = useState('')
  const [saving,      setSaving]      = useState(false)
  const [msg,         setMsg]         = useState(null) // {type:'ok'|'err', text}
  const [upgrading,   setUpgrading]   = useState(null) // 'pro' | 'elite' | null

  useEffect(() => {
    apiFetch('/api/auth/me').then(r => r.json()).then(d => {
      setMe(d)
      setEmail(d.email)
      setDisplayName(d.display_name || '')
      if (autoUpgrade && (d.tier === 'free' || !d.tier)) {
        handleUpgrade(autoUpgrade)
      }
    }).catch(() => {})
  }, [])

  async function handleUpgrade(tier) {
    setUpgrading(tier)
    try {
      const res = await apiFetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      })
      const data = await res.json()
      if (!res.ok) { setMsg({ type: 'err', text: data.detail || 'Checkout failed' }); setUpgrading(null); return }
      window.location.href = data.url
    } catch {
      setMsg({ type: 'err', text: 'Request failed — please try again' })
      setUpgrading(null)
    }
  }

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

        {me && (
          <div className="acct-plan-section">
            <div className="acct-plan-header">
              <span className="acct-plan-label">Plan</span>
              <span className={`acct-tier-badge acct-tier-${me.tier || 'free'}`}>
                {(me.tier || 'free').charAt(0).toUpperCase() + (me.tier || 'free').slice(1)}
              </span>
            </div>
            {(me.tier === 'free' || !me.tier) && (
              <div className="acct-upgrade-row">
                <div className="acct-upgrade-card">
                  <div className="acct-upgrade-name">Pro</div>
                  <div className="acct-upgrade-price">$20<span>/yr</span></div>
                  <button
                    className="acct-upgrade-btn"
                    onClick={() => handleUpgrade('pro')}
                    disabled={!!upgrading}
                  >
                    {upgrading === 'pro' ? 'Redirecting…' : 'Upgrade to Pro'}
                  </button>
                </div>
                <div className="acct-upgrade-card">
                  <div className="acct-upgrade-name">Elite</div>
                  <div className="acct-upgrade-price">$40<span>/yr</span></div>
                  <button
                    className="acct-upgrade-btn acct-upgrade-btn-elite"
                    onClick={() => handleUpgrade('elite')}
                    disabled={!!upgrading}
                  >
                    {upgrading === 'elite' ? 'Redirecting…' : 'Upgrade to Elite'}
                  </button>
                </div>
              </div>
            )}
            {me.tier === 'pro' && (
              <p className="acct-plan-note">You're on Pro. Email us to upgrade to Elite or manage your subscription.</p>
            )}
            {me.tier === 'elite' && (
              <p className="acct-plan-note">You're on Elite — the best plan. Email us to manage your subscription.</p>
            )}
          </div>
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
  { value: 'z_scores', label: 'Z-Scores (all cats)' },
  { value: 'pts',    label: 'Points' },
  { value: 'reb',    label: 'Rebounds' },
  { value: 'ast',    label: 'Assists' },
  { value: 'stl',    label: 'Steals' },
  { value: 'blk',    label: 'Blocks' },
  { value: 'tov',    label: 'Turnovers' },
  { value: 'fg3m',   label: '3-Pointers' },
  { value: 'fg_pct', label: 'FG%' },
  { value: 'ft_pct', label: 'FT%' },
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
  { value: 5,  label: '5' },
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: 40, label: '40' },
  { value: 80, label: '80' },
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
  return { backgroundColor: `rgba(0,230,118,${(intensity * 0.55).toFixed(2)})` }
}

function rollingAverage(games, key, window) {
  return games.map((g, i) => {
    const slice = games.slice(Math.max(0, i - window + 1), i + 1)
    const vals = slice.map(r => r[key]).filter(v => v !== null && v !== undefined)
    if (!vals.length) return null
    return vals.reduce((a, b) => a + b, 0) / vals.length
  })
}

function linReg(vals) {
  const pts = vals.map((v, i) => [i, v]).filter(([, v]) => v !== null && v !== undefined)
  if (pts.length < 2) return vals.map(() => null)
  const n = pts.length
  const sumX  = pts.reduce((s, [x]) => s + x, 0)
  const sumY  = pts.reduce((s, [, y]) => s + y, 0)
  const sumXY = pts.reduce((s, [x, y]) => s + x * y, 0)
  const sumX2 = pts.reduce((s, [x]) => s + x * x, 0)
  const denom = n * sumX2 - sumX * sumX
  if (Math.abs(denom) < 1e-10) return vals.map(() => sumY / n)
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return vals.map((_, i) => slope * i + intercept)
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
  // ESPN/Yahoo granular positions are already abbreviated
  'PG': 'PG', 'SG': 'SG', 'SF': 'SF', 'PF': 'PF',
}
function posAbbr(pos) { return POS_SHORT[pos] || pos || '—' }

const STAT_LABELS_SHORT = {
  pts: 'Pts/g', reb: 'Rebounds/g', ast: 'Ast/g',
  stl: 'Stl/g', blk: 'Blk/g', tov: 'Tov/g',
  fg3m: '3PM/g', fg_pct: 'FG%', ft_pct: 'FT%',
}

const CATEGORY_COLORS = {
  role:     '#7c8cff',
  skill:    '#00e676',
  opponent: '#ffb84d',
  team:     '#ff7cf5',
}

const TOTAL_COLOR    = '#555555'
function isDark() { return document.documentElement.getAttribute('data-theme') !== 'light' }

function getBarColor(category) {
  return CATEGORY_COLORS[category] ?? '#888'
}

const CAT_ORDER = { skill: 0, role: 1, team: 2, opponent: 3 }

function buildWaterfall(result) {
  const { period_a, period_b } = result
  const drivers = [...result.drivers].sort(
    (a, b) => (CAT_ORDER[a.category] ?? 99) - (CAT_ORDER[b.category] ?? 99)
  )
  const labels        = ['Baseline', ...drivers.map(d => LABEL_DISPLAY[d.label] ?? d.label), 'Comparison']
  const barRanges     = []   // [from, to] — proper floating bars
  const colors        = []
  const tipLabels     = []
  const displayLabels = []
  const isNegative    = []

  const baselineColor = isDark() ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'
  barRanges.push([0, period_a.value])
  colors.push(baselineColor)
  tipLabels.push(`Baseline: ${period_a.value.toFixed(2)}`)
  displayLabels.push(period_a.value.toFixed(1))
  isNegative.push(false)

  let running = period_a.value
  for (const d of drivers) {
    const c = d.contribution
    barRanges.push([Math.min(running, running + c), Math.max(running, running + c)])
    colors.push(getBarColor(d.category))
    tipLabels.push(`${d.label}: ${c >= 0 ? '+' : ''}${c.toFixed(3)}`)
    displayLabels.push(`${c >= 0 ? '+' : ''}${c.toFixed(2)}`)
    isNegative.push(c < 0)
    running += c
  }

  barRanges.push([0, period_b.value])
  colors.push(TOTAL_COLOR)
  tipLabels.push(`Comparison: ${period_b.value.toFixed(2)}`)
  displayLabels.push(period_b.value.toFixed(1))
  isNegative.push(false)

  return { labels, barRanges, colors, tipLabels, displayLabels, isNegative }
}

function buildZWaterfall(zResult) {
  const { period_a, period_b, categories } = zResult
  const baselineColor = isDark() ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'
  const labels        = ['Baseline', ...categories.map(c => c.label), 'Comparison']
  const barRanges     = []
  const colors        = []
  const tipLabels     = []
  const displayLabels = []
  const isNegative    = []

  barRanges.push([0, period_a.z_total])
  colors.push(baselineColor)
  tipLabels.push(`Baseline Z: ${period_a.z_total.toFixed(2)}`)
  displayLabels.push(period_a.z_total.toFixed(1))
  isNegative.push(false)

  let running = period_a.z_total
  for (const c of categories) {
    const d = c.delta
    barRanges.push([Math.min(running, running + d), Math.max(running, running + d)])
    colors.push(d >= 0 ? '#00e676' : '#ff6b6b')
    tipLabels.push(`${c.label}: ${d >= 0 ? '+' : ''}${d.toFixed(3)} (A: ${c.z_a.toFixed(2)}, B: ${c.z_b.toFixed(2)})`)
    displayLabels.push(`${d >= 0 ? '+' : ''}${d.toFixed(2)}`)
    isNegative.push(d < 0)
    running += d
  }

  barRanges.push([0, period_b.z_total])
  colors.push(TOTAL_COLOR)
  tipLabels.push(`Comparison Z: ${period_b.z_total.toFixed(2)}`)
  displayLabels.push(period_b.z_total.toFixed(1))
  isNegative.push(false)

  return { labels, barRanges, colors, tipLabels, displayLabels, isNegative }
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
function ordinal(n) {
  if (n == null) return null
  const s = ['th','st','nd','rd'], v = n % 100
  return `${n}${s[(v-20)%10] || s[v] || s[0]}`
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

const POSITIONS = ['All', 'PG', 'SG', 'SF', 'PF', 'C']

const SEASON_START = '2025-10-22'
const SEASON_END   = '2026-04-19'
const RANK_PERIODS = [
  { label: '2025-26 Season', start: SEASON_START, end: SEASON_END },
  { label: 'Last 30 Days',   start: () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0,10) }, end: () => new Date().toISOString().slice(0,10) },
  { label: 'Last 14 Days',   start: () => { const d = new Date(); d.setDate(d.getDate() - 14); return d.toISOString().slice(0,10) }, end: () => new Date().toISOString().slice(0,10) },
]

function RankingsPage({ onSelectPlayer, ownership }) {
  const [rankStart, setRankStart] = useState(SEASON_START)
  const [rankEnd,   setRankEnd]   = useState(SEASON_END)
  const [position, setPosition] = useState('all')
  const [players,  setPlayers]  = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [sortKey,  setSortKey]  = useState('z_total')
  const [sortAsc,  setSortAsc]  = useState(false)
  const [viewMode, setViewMode] = useState('pg')  // 'pg' | 'totals'
  const [showRaw, setShowRaw]   = useState(true)
  const [showZ, setShowZ]       = useState(true)
  const [showCTW, setShowCTW]   = useState(false)
  const [puntedCats, setPuntedCats] = useState(new Set())
  const [faOnly, setFaOnly] = useState(false)

  const activePeriod = RANK_PERIODS.find(p => {
    const s = typeof p.start === 'function' ? p.start() : p.start
    const e = typeof p.end   === 'function' ? p.end()   : p.end
    return rankStart === s && rankEnd === e
  })?.label

  function setPreset(p) {
    setRankStart(typeof p.start === 'function' ? p.start() : p.start)
    setRankEnd(typeof p.end === 'function' ? p.end() : p.end)
  }

  useEffect(() => {
    if (!rankStart || !rankEnd || rankStart > rankEnd) return
    setLoading(true)
    setPlayers(null)
    const pos = position === 'all' ? 'all' : position
    apiFetch(`/api/rankings?start=${rankStart}&end=${rankEnd}&position=${encodeURIComponent(pos)}`)
      .then(r => r.json())
      .then(d => { setPlayers(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [rankStart, rankEnd, position])

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
    if (key === 'ctw') return p.ctw ?? -Infinity
    if (viewMode === 'totals' && isTotalsKey(key)) return totalsVal(p, key) ?? -Infinity
    return p[key] ?? -Infinity
  }

  const hasOwnership = Object.keys(ownership).length > 0
  const sorted = players ? [...players]
    .filter(p => !faOnly || !ownership[p.slug])
    .sort((a, b) => {
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
          <span className="ctrl-label">Window</span>
          <div className="rank-pills">
            {RANK_PERIODS.map(p => (
              <button key={p.label} className={`rank-pill${activePeriod === p.label ? ' active' : ''}`}
                onClick={() => setPreset(p)}>{p.label}</button>
            ))}
          </div>
          <input type="date" className="proj-date-input" value={rankStart} onChange={e => setRankStart(e.target.value)} />
          <span className="proj-date-sep">→</span>
          <input type="date" className="proj-date-input" value={rankEnd}   onChange={e => setRankEnd(e.target.value)} />
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
          <span className="ctrl-label">Show</span>
          <div className="rank-pills">
            <button className={`rank-pill${showRaw ? ' active' : ''}`} onClick={() => setShowRaw(v => !v)}>Raw</button>
            <button className={`rank-pill${showZ ? ' active' : ''}`} onClick={() => setShowZ(v => !v)}>Z</button>
            <button className={`rank-pill rank-pill-ctw${showCTW ? ' active' : ''}`} onClick={() => setShowCTW(v => !v)}>CTW</button>
          </div>
        </div>
        {hasOwnership && (
          <div className="rank-filter-group">
            <span className="ctrl-label">Availability</span>
            <div className="rank-pills">
              <button className={`rank-pill${faOnly ? ' active' : ''}`} onClick={() => setFaOnly(f => !f)}>
                Free agents only
              </button>
            </div>
          </div>
        )}
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

{!loading && sorted.length > 0 && (() => {
  function downloadRankingsCSV() {
    const headers = ['#','Player','Team','Pos','GP','MIN']
    RANK_COLS.forEach(c => {
      if (showRaw) headers.push(c.label)
      if (showZ)   headers.push(`z_${c.label}`)
      if (showCTW) headers.push(`CTW_${c.label}`)
    })
    if (showZ)   headers.push('Value')
    if (showCTW) headers.push('CTW')
    const rows = sorted.map(p => {
      const row = [p.rank, p.name, p.team, p.position || '', p.gp ?? '', p.min_pg != null ? p.min_pg.toFixed(1) : '']
      RANK_COLS.forEach(c => {
        const raw = isTotalsKey(c.key) ? (totalsVal(p, c.key) ?? '') : (p[c.key] != null ? (c.pct ? `${p[c.key]}%` : p[c.key].toFixed(1)) : '')
        const z   = viewMode === 'totals' && !PCT_KEYS.has(c.key) ? (getTotalsZ(p, c.key) ?? '') : (p[`z_${c.key}`] ?? '')
        const ctw = p[`ctw_${c.key}`]
        if (showRaw) row.push(raw)
        if (showZ)   row.push(z !== '' && z != null ? Number(z).toFixed(2) : '')
        if (showCTW) row.push(ctw != null ? ctw.toFixed(2) : '')
      })
      if (showZ)   row.push(getEffectiveZTotal(p)?.toFixed(2) ?? '')
      if (showCTW) row.push(p.ctw != null ? p.ctw.toFixed(2) : '')
      return row
    })
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv],{type:'text/csv'})), download: `rankings_${rankStart}_${rankEnd}.csv` })
    a.click()
  }
  return (
        <div className="rankings-table-wrap">
          <div className="rankings-export-row">
            <button className="export-csv-btn" onClick={downloadRankingsCSV}>↓ Export CSV</button>
          </div>
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
                <th className="num ctw-col-header" onClick={() => handleSort('ctw')} style={{ cursor: 'pointer' }} title="Contribution To Winning — expected category wins (10-team league)">
                  CTW <SortIcon col="ctw" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => {
                const isTopVal = sortKey === 'z_total'
                const ctwVal = p.ctw
                return (
                  <tr key={p.slug} className={i % 2 === 0 ? 'row-even' : 'row-odd'}>
                    <td className="rank-col muted">{p.rank}</td>
                    <td className="name-col">
                      <div className="name-col-inner">
                        <div>
                          <div className="rank-player-name rank-player-link" onClick={() => onSelectPlayer(p)}>
                            {p.name}
                            {p.injury && <InjuryBadge injury={p.injury} compact />}
                          </div>
                          <div className="rank-player-team">{p.team}</div>
                        </div>
                        {hasOwnership && <OwnBadge slug={p.slug} ownership={ownership} />}
                      </div>
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
                      const ctwCatVal = showCTW ? p[`ctw_${c.key}`] : null
                      return (
                        <td key={c.key} className="num mono rank-stat-cell" style={{ opacity: punted ? 0.3 : 1 }}>
                          {showRaw && <div>{displayFmt}</div>}
                          {showZ && <div className="rank-z" style={{ color: zColor }}>{fmtZ(z)}</div>}
                          {showCTW && <div className="rank-ctw">{ctwCatVal != null ? ctwCatVal.toFixed(2) : ''}</div>}
                        </td>
                      )
                    })}
                    <td className="num mono z-total-cell">
                      {fmtZ(getEffectiveZTotal(p))}
                    </td>
                    <td className="num mono ctw-cell">
                      {ctwVal != null ? ctwVal.toFixed(2) : <span className="muted">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
  )
})()}

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

function OwnBadge({ slug, ownership }) {
  if (!ownership || !slug) return null
  const info = ownership[slug]
  if (!info) return Object.keys(ownership).length > 0
    ? <span className="own-badge own-fa">FA</span>
    : null
  return info.is_mine
    ? <span className="own-badge own-mine">Mine</span>
    : <span className="own-badge own-taken" title={info.team}>Taken</span>
}

function InjuryBadge({ injury, compact }) {
  if (!injury?.designation) return null
  const colors = INJ_COLORS[injury.designation] ?? { bg: '#555', text: '#fff' }
  const label  = compact
    ? (injury.designation === 'Questionable' || injury.designation === 'Day-To-Day' ? 'GTD' : injury.designation === 'Doubtful' ? 'DBT' : 'OUT')
    : injury.designation
  const fmtReturn = d => { const [y,m,day] = d.split('-'); return new Date(+y, +m-1, +day).toLocaleDateString('en-US', {month:'long', day:'numeric'}) }
  const tooltip = [injury.description || injury.designation, injury.return_date ? `Expected Return: ${fmtReturn(injury.return_date)}` : null].filter(Boolean).join(' · ')
  return (
    <span className="inj-badge-wrap">
      <span
        className="inj-badge"
        style={{ background: colors.bg, color: colors.text }}
        title={tooltip}
      >
        {label}
      </span>
      {!compact && injury.return_date && (
        <span className="inj-return-date">Expected Return {fmtReturn(injury.return_date)}</span>
      )}
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

  const today = new Date().toISOString().slice(0, 10)

  // Group articles by fetched_date, newest first
  const groups = []
  let currentDate = null
  for (const a of data.articles) {
    const d = a.fetched_date || today
    if (d !== currentDate) {
      currentDate = d
      groups.push({ date: d, articles: [] })
    }
    groups[groups.length - 1].articles.push(a)
  }

  return (
    <div className="news-list">
      {groups.map((g, gi) => (
        <div key={g.date}>
          {gi > 0 && (
            <div className="news-date-sep">
              <span className="news-date-sep-label">
                {g.date === today ? 'Today' : g.date}
              </span>
            </div>
          )}
          {g.articles.map((a, i) => (
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
      ))}
    </div>
  )
}

// ─── Shot Zone Court ──────────────────────────────────────────────────────────
// SVG half-court using NBA coordinate system: origin = basket centre,
// x: -250→250 (sideline to sideline), y: -47.5 (baseline) → 422.5 (half-court)
// SVG transform: x_svg = x_court + 250,  y_svg = 422.5 - y_court
// (basket at SVG 250,422.5 · FT line at y_svg 280 · 3pt junctions at y_svg 333.5)

function ShotZoneCourt({ id, title, zones }) {
  const byZone = Object.fromEntries((zones || []).map(z => [z.zone, z]))
  const absVals = (zones || []).map(z => Math.abs(z.delta))
  const maxDelta = absVals.length > 0 ? Math.max(...absVals) : 1

  function zoneColor(key) {
    const z = byZone[key]
    if (!z || Math.abs(z.delta) < 0.0001) return '#141828'
    const t = Math.min(Math.abs(z.delta) / maxDelta, 1)
    const bg = [20, 24, 40]
    const fg = z.delta > 0 ? [0, 230, 118] : [255, 77, 106]
    return `rgb(${Math.round(bg[0]+(fg[0]-bg[0])*t)},${Math.round(bg[1]+(fg[1]-bg[1])*t)},${Math.round(bg[2]+(fg[2]-bg[2])*t)})`
  }

  function lbl(key) { return byZone[key]?.label || '' }

  const lc = '#2a3055'
  const gradId = `szg-${id}`
  const maxLabel = zones.length > 0 ? (zones[0]?.unit === 'pp'
    ? `${(maxDelta * 100).toFixed(1)}pp`
    : `${(maxDelta * 100).toFixed(1)}%`) : ''

  return (
    <div className="shot-zone-court">
      <div className="shot-zone-title">{title}</div>
      <svg viewBox="0 0 500 470" style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* Zone fills — layered back to front */}
        <rect x={0} y={0} width={500} height={470} fill={zoneColor('above_break_3')} />
        <rect x={0} y={333.5} width={30} height={136.5} fill={zoneColor('corner_3')} />
        <rect x={470} y={333.5} width={30} height={136.5} fill={zoneColor('corner_3')} />
        {/* mid_range: inside 3pt arc, sweep=1 */}
        <path d="M 30,470 L 30,333.5 A 237.5,237.5 0 0,1 470,333.5 L 470,470 Z" fill={zoneColor('mid_range')} />
        <rect x={170} y={280} width={160} height={190} fill={zoneColor('paint_non_ra')} />
        {/* restricted_area: D-shape, sweep=1 */}
        <path d="M 210,422.5 A 40,40 0 0,1 290,422.5 Z" fill={zoneColor('restricted_area')} />

        {/* Court lines */}
        <rect x={0} y={0} width={500} height={470} fill="none" stroke={lc} strokeWidth={2} />
        <line x1={0} y1={0} x2={500} y2={0} stroke={lc} strokeWidth={1} strokeDasharray="4 4" />
        {/* Paint outer + inner */}
        <rect x={170} y={280} width={160} height={190} fill="none" stroke={lc} strokeWidth={1.5} />
        <rect x={190} y={280} width={120} height={190} fill="none" stroke={lc} strokeWidth={1} />
        {/* FT line */}
        <line x1={170} y1={280} x2={330} y2={280} stroke={lc} strokeWidth={1.5} />
        {/* FT arc solid (into mid-range, sweep=1) */}
        <path d="M 190,280 A 60,60 0 0,1 310,280" fill="none" stroke={lc} strokeWidth={1} />
        {/* FT arc dashed (into paint, sweep=0) */}
        <path d="M 190,280 A 60,60 0 0,0 310,280" fill="none" stroke={lc} strokeWidth={1} strokeDasharray="4 4" />
        {/* Restricted area arc */}
        <path d="M 210,422.5 A 40,40 0 0,1 290,422.5" fill="none" stroke={lc} strokeWidth={1.5} />
        {/* Corner 3 straight lines */}
        <line x1={30} y1={470} x2={30} y2={333.5} stroke={lc} strokeWidth={1.5} />
        <line x1={470} y1={470} x2={470} y2={333.5} stroke={lc} strokeWidth={1.5} />
        {/* 3pt arc, sweep=1 */}
        <path d="M 30,333.5 A 237.5,237.5 0 0,1 470,333.5" fill="none" stroke={lc} strokeWidth={1.5} />
        {/* Backboard + rim */}
        <line x1={220} y1={430} x2={280} y2={430} stroke={lc} strokeWidth={3} />
        <circle cx={250} cy={422.5} r={7.5} fill="none" stroke={lc} strokeWidth={2} />

        {/* Zone labels */}
        <text x={250} y={413} textAnchor="middle" fill="#fff" fontSize={10} fontFamily="DM Mono,monospace" stroke="#0a0e1a" strokeWidth={2.5} paintOrder="stroke fill">{lbl('restricted_area')}</text>
        <text x={250} y={355} textAnchor="middle" fill="#fff" fontSize={10} fontFamily="DM Mono,monospace" stroke="#0a0e1a" strokeWidth={2.5} paintOrder="stroke fill">{lbl('paint_non_ra')}</text>
        <text x={250} y={250} textAnchor="middle" fill="#fff" fontSize={10} fontFamily="DM Mono,monospace" stroke="#0a0e1a" strokeWidth={2.5} paintOrder="stroke fill">{lbl('mid_range')}</text>
        <text x={250} y={150} textAnchor="middle" fill="#fff" fontSize={10} fontFamily="DM Mono,monospace" stroke="#0a0e1a" strokeWidth={2.5} paintOrder="stroke fill">{lbl('above_break_3')}</text>
        <text x={15} y={402} textAnchor="middle" fill="#fff" fontSize={9} fontFamily="DM Mono,monospace" stroke="#0a0e1a" strokeWidth={2} paintOrder="stroke fill" transform="rotate(-90,15,402)">{lbl('corner_3')}</text>
        <text x={485} y={402} textAnchor="middle" fill="#fff" fontSize={9} fontFamily="DM Mono,monospace" stroke="#0a0e1a" strokeWidth={2} paintOrder="stroke fill" transform="rotate(90,485,402)">{lbl('corner_3')}</text>
      </svg>

      {/* Gradient legend */}
      <div className="shot-zone-legend">
        <span className="shot-zone-legend-neg">−{maxLabel}</span>
        <svg width="120" height="14" style={{ display: 'block', flexShrink: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stopColor="rgb(255,77,106)" />
              <stop offset="50%"  stopColor="#141828" />
              <stop offset="100%" stopColor="rgb(0,230,118)" />
            </linearGradient>
          </defs>
          <rect x={0} y={1} width={120} height={12} rx={2} fill={`url(#${gradId})`} />
        </svg>
        <span className="shot-zone-legend-pos">+{maxLabel}</span>
      </div>
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

function InjuriesPage({ onSelectPlayer, ownership }) {
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
                  <OwnBadge slug={p.slug} ownership={ownership} />
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

function BoxScoreTable({ players, onSelectPlayer, ownership }) {
  if (!players.length) return null
  return (
    <table className="bs-table">
      <colgroup>
        <col className="bs-col-name" />
        <col className="bs-col-pos" />
        <col className="bs-col-num" />
        <col className="bs-col-num" />
        <col className="bs-col-num" />
        <col className="bs-col-num bs-col-stat" />
        <col className="bs-col-num" />
        <col className="bs-col-num bs-col-stat" />
        <col className="bs-col-num bs-col-stat" />
        <col className="bs-col-num bs-col-stat" />
        <col className="bs-col-num bs-col-stat" />
        <col className="bs-col-num bs-col-stat" />
        <col className="bs-col-fg" />
        <col className="bs-col-num" />
        <col className="bs-col-fg" />
        <col className="bs-col-num" />
        <col className="bs-col-z" />
      </colgroup>
      <thead>
        <tr>
          <th className="bs-name">Player</th>
          <th className="bs-pos">Pos</th>
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
              <OwnBadge slug={p.slug} ownership={ownership} />
            </td>
            <td className="bs-pos">{posAbbr(p.pos) || '—'}</td>
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

function BoxScorePage({ onSelectPlayer, ownership, initialDate }) {
  const clientET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const [todayEt, setTodayEt] = useState(clientET)
  const [date, setDate]       = useState(() => initialDate || clientET())
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
      .then(r => r.ok ? r.json() : r.text().then(t => {
        try { const e = JSON.parse(t); return Promise.reject(e.detail || 'Failed to load box scores') }
        catch { return Promise.reject('Failed to load box scores') }
      }))
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [date])

  useEffect(() => {
    setLoading(true)
    setError(null)
    setData(null)
    fetchScores()

    if (date !== todayEt) return

    // Use SSE for live updates — single backend poll shared across all users
    const token = localStorage.getItem('nba_token')
    if (!token) return
    const es = new EventSource(`/api/box-score/stream?token=${encodeURIComponent(token)}`)
    es.onmessage = e => {
      try { const d = JSON.parse(e.data); setData(d); setLoading(false) } catch {}
    }
    return () => es.close()
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
              <BoxScoreTable players={game.away_players} onSelectPlayer={onSelectPlayer} ownership={ownership} />
            </div>
            <div className="bs-team-section">
              <div className="bs-team-label">{game.home} <span className="bs-team-abbr">{game.home_abbr}</span></div>
              <BoxScoreTable players={game.home_players} onSelectPlayer={onSelectPlayer} ownership={ownership} />
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

const PROJ_POSITIONS = ['All', 'PG', 'SG', 'SF', 'PF', 'C']

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

function ProjectionsPage({ onSelectPlayer, ownership }) {
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
  const [showRaw, setShowRaw]       = useState(true)
  const [showZ, setShowZ]           = useState(true)
  const [showCTW, setShowCTW]       = useState(false)
  const [puntedCats, setPuntedCats] = useState(new Set())
  const [faOnly, setFaOnly] = useState(false)

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

  const hasOwnership = Object.keys(ownership).length > 0
  const filtered = players
    ? players.filter(p =>
        (position === 'all' || p.position === position) &&
        (!faOnly || !ownership[p.slug])
      )
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
    if (key === 'ctw') return p.ctw ?? -Infinity
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
          <span className="ctrl-label">Show</span>
          <div className="rank-pills">
            <button className={`rank-pill${showRaw ? ' active' : ''}`} onClick={() => setShowRaw(v => !v)}>Raw</button>
            <button className={`rank-pill${showZ ? ' active' : ''}`} onClick={() => setShowZ(v => !v)}>Z</button>
            <button className={`rank-pill rank-pill-ctw${showCTW ? ' active' : ''}`} onClick={() => setShowCTW(v => !v)}>CTW</button>
          </div>
        </div>
        {hasOwnership && (
          <div className="rank-filter-group">
            <span className="ctrl-label">Availability</span>
            <div className="rank-pills">
              <button className={`rank-pill${faOnly ? ' active' : ''}`} onClick={() => setFaOnly(f => !f)}>
                Free agents only
              </button>
            </div>
          </div>
        )}
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

      {!loading && sorted.length > 0 && (() => {
  function downloadProjectionsCSV() {
    const headers = ['#','Player','Team','Pos','GP']
    PROJ_COLS.forEach(c => {
      if (showRaw) headers.push(c.label)
      if (showZ && !c.noZ) headers.push(`z_${c.label}`)
      if (showRanges && !c.noZ && !c.pct) headers.push(`${c.label}_Low`, `${c.label}_High`)
      if (showCTW && !c.noZ) headers.push(`CTW_${c.label}`)
    })
    if (showZ) headers.push('Value')
    if (showCTW) headers.push('CTW')
    const rows = sorted.map((p, i) => {
      const row = [i+1, p.name, p.team, p.position || '', p.gp ?? '']
      PROJ_COLS.forEach(c => {
        const raw = isTotalsKey(c.key) ? (totalsVal(p,c.key)??'') : (p[c.key]!=null ? (c.pct?`${p[c.key]}%`:p[c.key].toFixed(1)) : '')
        const z = c.noZ ? '' : viewMode==='totals' && !PROJ_PCT_KEYS.has(c.key) ? (getTotalsZ(p,c.key)??'') : (p[`z_${c.key}`]??'')
        if (showRaw) row.push(raw)
        if (showZ && !c.noZ) row.push(z!==''&&z!=null?Number(z).toFixed(2):'')
        if (showRanges && !c.noZ && !c.pct) {
          const lo = p[`${c.key}_low`]; const hi = p[`${c.key}_high`]
          row.push(lo!=null?lo.toFixed(1):'', hi!=null?hi.toFixed(1):'')
        }
        if (showCTW && !c.noZ) row.push(p[`ctw_${c.key}`]!=null?p[`ctw_${c.key}`].toFixed(2):'')
      })
      if (showZ) { const v=getEffectiveValue(p); row.push(v!=null?v.toFixed(1):'') }
      if (showCTW) row.push(p.ctw!=null?p.ctw.toFixed(2):'')
      return row
    })
    const csv = [headers,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
    const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([csv],{type:'text/csv'})),download:`projections_${start}_${end}.csv`})
    a.click()
  }
  return (
        <div className="rankings-table-wrap">
          <div className="rankings-export-row">
            <button className="export-csv-btn" onClick={downloadProjectionsCSV}>↓ Export CSV</button>
          </div>
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
                <th className="num ctw-col-header" onClick={() => handleSort('ctw')} style={{ cursor: 'pointer' }} title="Contribution To Winning — expected category wins (10-team league)">
                  CTW <SortIcon col="ctw" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => {
                const ctwVal = p.ctw
                return (
                <tr key={p.slug} className={i % 2 === 0 ? 'row-even' : 'row-odd'}>
                  <td className="rank-col muted">{i + 1}</td>
                  <td className="name-col">
                    <div className="name-col-inner">
                      <div>
                        <div className="rank-player-name rank-player-link" onClick={() => onSelectPlayer(p)}>
                          {p.name}
                          {p.is_adjusted && <span className="adj-proj-badge" title="Projection adjusted">adj</span>}
                          {p.injury && <InjuryBadge injury={p.injury} compact />}
                        </div>
                        <div className="rank-player-team">{p.team}</div>
                      </div>
                      {hasOwnership && <OwnBadge slug={p.slug} ownership={ownership} />}
                    </div>
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
                    const ctwCatVal = showCTW && !c.noZ ? p[`ctw_${c.key}`] : null
                    return (
                      <td key={c.key} className="num mono rank-stat-cell" style={{ opacity: punted ? 0.3 : 1 }}>
                        {showRaw && <div>{displayFmt}</div>}
                        {showZ && !c.noZ && !hasRange && <div className="rank-z" style={{ color: zColor }}>{fmtZ(z)}</div>}
                        {hasRange && rangeLow != null && <div className="rank-range">{displayLow}–{displayHigh}</div>}
                        {showCTW && !c.noZ && <div className="rank-ctw">{ctwCatVal != null ? ctwCatVal.toFixed(2) : ''}</div>}
                      </td>
                    )
                  })}
                  <td className="num mono z-total-cell">
                    {(() => { const v = getEffectiveValue(p); return v != null ? (v > 0 ? '+' : '') + v.toFixed(1) : '—' })()}
                  </td>
                  <td className="num mono ctw-cell">
                    {ctwVal != null ? ctwVal.toFixed(2) : <span className="muted">—</span>}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
  )
})()}
    </div>
  )
}

// ─── Draft Tool ───────────────────────────────────────────────────────────────

const VS_CATS = [
  { key: 'pts',    label: 'PTS', invert: false, threshold: 5   },
  { key: 'reb',    label: 'REB', invert: false, threshold: 2   },
  { key: 'ast',    label: 'AST', invert: false, threshold: 2   },
  { key: 'stl',    label: 'STL', invert: false, threshold: 0.5 },
  { key: 'blk',    label: 'BLK', invert: false, threshold: 0.5 },
  { key: 'tov',    label: 'TO',  invert: true,  threshold: 1   },
  { key: 'fg3m',   label: '3PM', invert: false, threshold: 1   },
  { key: 'fg_pct', label: 'FG%', invert: false, threshold: 3   },
  { key: 'ft_pct', label: 'FT%', invert: false, threshold: 5   },
]

const NAME_SUFFIXES = new Set(['jr.', 'sr.', 'ii', 'iii', 'iv', 'v'])
function _stripSuffixes(parts) {
  const p = [...parts]
  while (p.length > 1 && NAME_SUFFIXES.has(p[p.length - 1].toLowerCase())) p.pop()
  return p
}
function draftLastName(fullName) {
  const parts = _stripSuffixes(fullName.trim().split(/\s+/))
  return parts[parts.length - 1]
}
function draftShortName(fullName) {
  const parts = _stripSuffixes(fullName.trim().split(/\s+/))
  if (parts.length < 2) return fullName
  return `${parts[0][0]}. ${parts[parts.length - 1]}`
}

const DRAFT_CATS = [
  { key: 'pts',    label: 'PTS', zKey: 'z_pts',     invert: false },
  { key: 'reb',    label: 'REB', zKey: 'z_reb',     invert: false },
  { key: 'ast',    label: 'AST', zKey: 'z_ast',     invert: false },
  { key: 'stl',    label: 'STL', zKey: 'z_stl',     invert: false },
  { key: 'blk',    label: 'BLK', zKey: 'z_blk',     invert: false },
  { key: 'tov',    label: 'TOV', zKey: 'z_tov',     invert: true  },
  { key: 'fg3m',   label: '3PM', zKey: 'z_fg3m',    invert: false },
  { key: 'fg_pct', label: 'FG%', zKey: 'z_fg_pct', invert: false },
  { key: 'ft_pct', label: 'FT%', zKey: 'z_ft_pct', invert: false },
]

function computeDraftScore(player, myRoster, scoringType) {
  if (scoringType === 'points' || myRoster.length === 0) return player.z_total || 0
  const myTotals = {}
  for (const cat of DRAFT_CATS) {
    myTotals[cat.key] = myRoster.reduce((s, p) => {
      const v = p[cat.zKey] || 0
      return s + (cat.invert ? -v : v)
    }, 0)
  }
  const vals = DRAFT_CATS.map(c => myTotals[c.key])
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1
  return DRAFT_CATS.reduce((s, cat) => {
    const pv = cat.invert ? -(player[cat.zKey] || 0) : (player[cat.zKey] || 0)
    const need = 1 - (myTotals[cat.key] - min) / range
    return s + pv * (0.5 + need)
  }, 0)
}

// snake draft pick order: returns [{round, slot}] for each overall pick index
function buildPickOrder(leagueSize, numRounds) {
  const order = []
  for (let r = 0; r < numRounds; r++) {
    for (let i = 0; i < leagueSize; i++) {
      order.push({ round: r, slot: r % 2 === 0 ? i : leagueSize - 1 - i })
    }
  }
  return order
}

function DraftSetupScreen({ onStart }) {
  const [leagueSize, setLeagueSize]   = useState(12)
  const [scoringType, setScoringType] = useState('cats')
  const [myPickSlot, setMyPickSlot]   = useState(1)
  const [numRounds, setNumRounds]     = useState(13)
  return (
    <div className="draft-setup-wrap">
      <div className="draft-setup-card">
        <h2 className="draft-setup-title">Draft Setup</h2>
        <div className="draft-setup-fields">
          <label className="draft-setup-label">League size
            <select value={leagueSize} onChange={e => { setLeagueSize(Number(e.target.value)); setMyPickSlot(1) }} className="draft-setup-select">
              {[8,10,12,14,16].map(n => <option key={n} value={n}>{n} teams</option>)}
            </select>
          </label>
          <label className="draft-setup-label">Scoring format
            <select value={scoringType} onChange={e => setScoringType(e.target.value)} className="draft-setup-select">
              <option value="cats">9-Category</option>
              <option value="points">Points</option>
            </select>
          </label>
          <label className="draft-setup-label">My draft slot
            <select value={myPickSlot} onChange={e => setMyPickSlot(Number(e.target.value))} className="draft-setup-select">
              {Array.from({ length: leagueSize }, (_, i) => i + 1).map(n =>
                <option key={n} value={n}>Pick #{n}</option>
              )}
            </select>
          </label>
          <label className="draft-setup-label">Rounds
            <select value={numRounds} onChange={e => setNumRounds(Number(e.target.value))} className="draft-setup-select">
              {[10,12,13,14,15,16].map(n => <option key={n} value={n}>{n} rounds</option>)}
            </select>
          </label>
        </div>
        <button className="draft-start-btn" onClick={() => onStart({ leagueSize, scoringType, myPickSlot, numRounds })}>
          Start Draft
        </button>
      </div>
    </div>
  )
}

function DraftPage() {
  const [setup, setSetup]       = useState(null)
  const [picks, setPicks]       = useState([])   // player objects in pick order
  const [rankData, setRankData] = useState([])
  const [loading, setLoading]   = useState(false)
  const [search, setSearch]     = useState('')
  const searchRef               = useRef(null)

  useEffect(() => {
    if (!setup) return
    setLoading(true)
    apiFetch('/api/rankings?period=season')
      .then(r => r.json())
      .then(d => { setRankData(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [setup])

  const pickOrder = useMemo(() =>
    setup ? buildPickOrder(setup.leagueSize, setup.numRounds) : []
  , [setup])

  // board[round][slot] = player | null
  const board = useMemo(() => {
    if (!setup) return []
    const b = Array.from({ length: setup.numRounds }, () => Array(setup.leagueSize).fill(null))
    picks.forEach((p, i) => { const o = pickOrder[i]; if (o) b[o.round][o.slot] = p })
    return b
  }, [picks, pickOrder, setup])

  const currentIdx   = picks.length
  const currentOrder = pickOrder[currentIdx]
  const isComplete   = setup && currentIdx >= setup.leagueSize * setup.numRounds
  const isMyTurn     = currentOrder && setup && currentOrder.slot === setup.myPickSlot - 1

  const myRoster = useMemo(() =>
    picks.filter((_, i) => pickOrder[i]?.slot === (setup?.myPickSlot ?? 0) - 1)
  , [picks, pickOrder, setup])

  const drafted = useMemo(() => new Set(picks.map(p => p.slug)), [picks])

  const available = useMemo(() => {
    let list = rankData.filter(p => !drafted.has(p.slug))
    if (search) { const q = search.toLowerCase(); list = list.filter(p => p.name.toLowerCase().includes(q)) }
    return list
      .map(p => ({ ...p, draftScore: computeDraftScore(p, myRoster, setup?.scoringType) }))
      .sort((a, b) => b.draftScore - a.draftScore)
  }, [rankData, drafted, myRoster, setup, search])

  // Per-team category totals (from all picks on the board)
  const teamCatTotals = useMemo(() => {
    if (!setup) return {}
    const teams = {}
    picks.forEach((p, i) => {
      const { slot } = pickOrder[i]
      if (!teams[slot]) teams[slot] = {}
      for (const cat of DRAFT_CATS) {
        const v = p[cat.zKey] || 0
        teams[slot][cat.key] = (teams[slot][cat.key] || 0) + (cat.invert ? -v : v)
      }
    })
    return teams
  }, [picks, pickOrder, setup])

  const myCatSummary = useMemo(() => {
    const mySlot = setup ? setup.myPickSlot - 1 : -1
    const teamsWithPicks = Object.entries(teamCatTotals).filter(([, t]) => Object.keys(t).length > 0)
    return DRAFT_CATS.map(cat => {
      const total = myRoster.reduce((s, p) => { const v = p[cat.zKey] || 0; return s + (cat.invert ? -v : v) }, 0)
      // Rank among teams that have at least 1 pick
      let rank = null, outOf = null
      if (teamsWithPicks.length > 1) {
        const sorted = [...teamsWithPicks].sort((a, b) => (b[1][cat.key] ?? -99) - (a[1][cat.key] ?? -99))
        rank  = sorted.findIndex(([s]) => Number(s) === mySlot) + 1
        outOf = teamsWithPicks.length
      }
      return { ...cat, total, rank, outOf }
    })
  }, [myRoster, teamCatTotals, setup])

  const vsTable = useMemo(() => {
    if (!setup) return []
    const mySlot = setup.myPickSlot - 1
    // Build per-team averages for all slots that have picks
    const allSlots = [...new Set(picks.map((_, i) => pickOrder[i].slot))]
    const teamAvgs = {}
    for (const slot of allSlots) {
      const roster = picks.filter((_, i) => pickOrder[i].slot === slot)
      if (roster.length === 0) continue
      const avgs = {}
      for (const cat of VS_CATS) {
        const vals = roster.map(p => p[cat.key] ?? 0)
        avgs[cat.key] = vals.reduce((a, b) => a + b, 0) / vals.length
      }
      teamAvgs[slot] = avgs
    }
    const teamsWithPicks = Object.keys(teamAvgs).map(Number)
    if (teamsWithPicks.length < 2) return []
    const myAvgs = teamAvgs[mySlot]
    // For each team, compute overall win% vs every other team
    return teamsWithPicks.map(slot => {
      const isMe = slot === mySlot
      const teamA = teamAvgs[slot]
      const others = teamsWithPicks.filter(s => s !== slot)
      let totalWins = 0, totalLosses = 0
      for (const other of others) {
        const teamB = teamAvgs[other]
        for (const cat of VS_CATS) {
          const delta = cat.invert ? teamB[cat.key] - teamA[cat.key] : teamA[cat.key] - teamB[cat.key]
          if (delta > 0) totalWins++
          else if (delta < 0) totalLosses++
        }
      }
      const overallWinPct = (totalWins + totalLosses) > 0 ? totalWins / (totalWins + totalLosses) : 0
      // Per-cat: show this team's avgs; delta = my advantage vs them (from my POV)
      const cats = VS_CATS.map(cat => {
        const delta = !isMe && myAvgs
          ? (cat.invert ? teamA[cat.key] - myAvgs[cat.key] : myAvgs[cat.key] - teamA[cat.key])
          : null
        return { key: cat.key, label: cat.label, val: teamA[cat.key], delta, threshold: cat.threshold }
      })
      return {
        slot,
        isMe,
        teamLabel: isMe ? 'You' : `T${slot + 1}`,
        overallWinPct,
        totalWins,
        totalLosses,
        cats,
      }
    }).sort((a, b) => b.overallWinPct - a.overallWinPct)
  }, [picks, pickOrder, setup])

  function draftPlayer(player) {
    if (isComplete) return
    setPicks(prev => [...prev, player])
    setSearch('')
    searchRef.current?.focus()
  }
  function undoPick() { setPicks(prev => prev.slice(0, -1)) }
  function resetDraft() { if (window.confirm('Reset this draft?')) { setPicks([]); setSetup(null) } }

  if (!setup) return <DraftSetupScreen onStart={setSetup} />

  const { leagueSize, numRounds, myPickSlot } = setup
  const currentRound = currentOrder ? currentOrder.round + 1 : numRounds

  return (
    <div className="draft-page">
      {/* ── Header ────────────────────────────────── */}
      <div className="draft-header">
        <div className="draft-meta">
          <span className="draft-meta-pill">{leagueSize}-team</span>
          <span className="draft-meta-pill">{setup.scoringType === 'cats' ? '9-Cat' : 'Points'}</span>
          {!isComplete
            ? <span className={`draft-meta-pill draft-meta-round${isMyTurn ? ' my-turn' : ''}`}>
                Round {currentRound} · Pick {currentIdx + 1}
              </span>
            : <span className="draft-meta-pill">Draft complete</span>
          }
        </div>
        <div className="draft-header-btns">
          <button onClick={undoPick} disabled={picks.length === 0} className="draft-hdr-btn">↩ Undo</button>
          <button onClick={resetDraft} className="draft-hdr-btn draft-hdr-reset">Reset</button>
        </div>
      </div>

      <div className="draft-body">
        {/* ── Left: board + analysis ────────────────── */}
        <div className="draft-left">
          {/* Snake draft board */}
          <div className="draft-board-scroll">
            <div className="draft-board" style={{ gridTemplateColumns: `36px repeat(${leagueSize}, minmax(80px, 1fr))` }}>
              <div className="db-corner" />
              {Array.from({ length: leagueSize }, (_, i) => (
                <div key={i} className={`db-col-hdr${i === myPickSlot - 1 ? ' my-col' : ''}`}>
                  {i === myPickSlot - 1 ? 'You' : `T${i + 1}`}
                </div>
              ))}
              {board.map((row, r) => (
                <Fragment key={r}>
                  <div className="db-row-hdr">R{r + 1}</div>
                  {row.map((player, c) => {
                    const isCur = currentOrder?.round === r && currentOrder?.slot === c
                    const isMe  = c === myPickSlot - 1
                    return (
                      <div
                        key={c}
                        onClick={() => isCur && searchRef.current?.focus()}
                        className={`db-cell${isCur ? ' current' : ''}${isMe ? ' my-col' : ''}${player ? ' filled' : ''}`}
                      >
                        {player
                          ? <><span className="dbc-name">{draftLastName(player.name)}</span><span className="dbc-pos">{player.position}</span></>
                          : isCur ? <span className="dbc-cursor">▸</span> : null
                        }
                      </div>
                    )
                  })}
                </Fragment>
              ))}
            </div>
          </div>

          {/* Category analysis */}
          {myRoster.length > 0 && (
            <div className="draft-analysis">
              <div className="draft-analysis-header">
                <span className="draft-analysis-title">My Team · Category Rankings</span>
                <span className="draft-analysis-sub">
                  Your team ranked against other teams in this draft so far.
                  {myCatSummary[0]?.outOf == null && ' Rankings appear once 2+ teams have picks.'}
                </span>
              </div>
              <div className="draft-cat-grid">
                {myCatSummary.map(cat => {
                  const { rank, outOf } = cat
                  const rankPct = rank && outOf ? (outOf - rank) / (outOf - 1) : null
                  const barColor = rankPct == null ? '#555'
                    : rankPct >= 0.66 ? '#00e676'
                    : rankPct >= 0.33 ? '#f5a623'
                    : '#ff6b6b'
                  const rankLabel = rank == null ? '—'
                    : rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : `${rank}th`
                  return (
                    <div key={cat.key} className="draft-cat-item">
                      <div className="draft-cat-item-header">
                        <span className="draft-cat-label">{cat.label}</span>
                        <span className="draft-cat-rank" style={{ color: barColor }}>
                          {rankLabel}{outOf ? ` / ${outOf}` : ''}
                        </span>
                      </div>
                      <div className="draft-cat-track">
                        <div className="draft-cat-fill" style={{ width: `${(rankPct ?? 0.5) * 100}%`, background: barColor }} />
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="draft-roster-chips">
                {myRoster.map((p, i) => (
                  <span key={p.slug} className="draft-roster-chip">
                    <span className="drc-round">R{i + 1}</span>{draftShortName(p.name)}
                  </span>
                ))}
              </div>

              {/* VS Each Opponent table */}
              {vsTable.length > 0 && (
                <div className="draft-vs-wrap">
                  <span className="draft-vs-title">Team Rankings</span>
                  <div className="draft-vs-scroll">
                    <table className="draft-vs-table">
                      <thead>
                        <tr>
                          <th className="dvt-th dvt-rank">#</th>
                          <th className="dvt-th dvt-team">Team</th>
                          <th className="dvt-th dvt-winpct">Win%</th>
                          <th className="dvt-th dvt-record">W–L</th>
                          {VS_CATS.map(c => <th key={c.key} className="dvt-th dvt-stat">{c.label}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {vsTable.map((row, rank) => (
                          <tr key={row.slot} className={`dvt-row${row.isMe ? ' mine' : ''}`}>
                            <td className="dvt-td dvt-rank">{rank + 1}</td>
                            <td className="dvt-td dvt-team">{row.teamLabel}</td>
                            <td className="dvt-td dvt-winpct">{Math.round(row.overallWinPct * 100)}%</td>
                            <td className="dvt-td dvt-record">{row.totalWins}–{row.totalLosses}</td>
                            {row.cats.map(cat => {
                              const decimals = cat.key === 'stl' || cat.key === 'blk' ? 2 : 1
                              const hasDelta = cat.delta !== null
                              const intensity = hasDelta ? Math.min(Math.abs(cat.delta) / cat.threshold, 1) * 0.45 : 0
                              const bg = hasDelta && cat.delta > 0
                                ? `rgba(0,230,118,${intensity})`
                                : hasDelta && cat.delta < 0
                                ? `rgba(255,107,107,${intensity})`
                                : 'transparent'
                              return (
                                <td key={cat.key} className="dvt-td dvt-stat" style={{ background: bg }}>
                                  <span className="dvt-opp">{cat.val.toFixed(decimals)}</span>
                                  {hasDelta && (
                                    <span className={`dvt-delta ${cat.delta >= 0 ? 'pos' : 'neg'}`}>
                                      {cat.delta >= 0 ? '+' : ''}{cat.delta.toFixed(decimals)}
                                    </span>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right: player list ────────────────────── */}
        <div className="draft-right">
          <div className={`draft-pick-header${isMyTurn ? ' my-turn' : ''}`}>
            {!isComplete
              ? <span className="draft-pick-label">{isMyTurn ? `Your pick — Round ${currentRound}` : `Opponent's pick — Round ${currentRound}`}</span>
              : <span className="draft-pick-label">Draft complete</span>
            }
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search players…"
              className="draft-pick-search"
              autoFocus
            />
          </div>
          <div className="draft-player-list">
            {loading && <div className="draft-loading">Loading players…</div>}
            {available.map((p, i) => (
              <button key={p.slug} onClick={() => draftPlayer(p)} className="draft-player-row" disabled={isComplete}>
                <span className="dp-rank">{i + 1}</span>
                <div className="dp-info">
                  <span className="dp-name">{draftShortName(p.name)}</span>
                  <span className="dp-meta">{p.position} · {p.team}</span>
                </div>
                <span className={`dp-score ${p.draftScore >= 0 ? 'pos' : 'neg'}`}>
                  {p.draftScore >= 0 ? '+' : ''}{p.draftScore.toFixed(1)}
                </span>
              </button>
            ))}
            {!loading && available.length === 0 && <div className="draft-loading">No players found</div>}
          </div>
          <div className="draft-list-legend">
            <span>PTS · REB · AST</span>
            <span>Draft value{myRoster.length === 0 ? ' (raw z-score)' : ' (need-adjusted)'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Forum ────────────────────────────────────────────────────────────────────

function timeAgo(dt) {
  const diff = (Date.now() - new Date(dt.endsWith('Z') ? dt : dt + 'Z').getTime()) / 1000
  if (diff < 60)       return 'just now'
  if (diff < 3600)     return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400)    return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400*7)  return `${Math.floor(diff / 86400)}d ago`
  return new Date(dt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

function ForumVote({ score, myVote, onVote, sm }) {
  return (
    <div className={`forum-vote-col${sm ? ' sm' : ''}`}>
      <button className={`forum-vote-btn up${myVote === 1 ? ' active' : ''}${sm ? ' sm' : ''}`}
        onClick={e => { e.stopPropagation(); onVote(myVote === 1 ? 0 : 1) }}>▲</button>
      <span className={`forum-score${sm ? ' sm' : ''} ${score > 0 ? 'pos' : score < 0 ? 'neg' : ''}`}>{score}</span>
      <button className={`forum-vote-btn dn${myVote === -1 ? ' active' : ''}${sm ? ' sm' : ''}`}
        onClick={e => { e.stopPropagation(); onVote(myVote === -1 ? 0 : -1) }}>▼</button>
    </div>
  )
}

function ForumCommentBox({ postId, parentId, onSubmit, placeholder, onCancel }) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  function submit() {
    if (!body.trim()) return
    setBusy(true)
    onSubmit(postId, body.trim(), parentId)
      .then(() => { setBody(''); setBusy(false); onCancel?.() })
      .catch(() => setBusy(false))
  }
  return (
    <div className="forum-comment-box">
      <textarea className="forum-textarea sm" rows={3} placeholder={placeholder || 'Write a reply…'}
        value={body} onChange={e => setBody(e.target.value)} />
      <div className="forum-form-actions">
        {onCancel && <button className="forum-btn secondary" onClick={onCancel}>Cancel</button>}
        <button className="forum-btn primary" onClick={submit} disabled={busy || !body.trim()}>
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  )
}

function ForumComment({ comment, postId, onVote, onReply, onDelete, depth }) {
  const [showReply, setShowReply] = useState(false)
  const indent = Math.min(depth, 3) * 24
  return (
    <div className="forum-comment" style={{ marginLeft: indent }}>
      <ForumVote score={comment.score} myVote={comment.my_vote} sm
        onVote={v => onVote(comment.id, v)} />
      <div className="forum-comment-body-wrap">
        <div className="forum-comment-meta">
          <span className="forum-author">{comment.author}</span>
          <span className="forum-dot">·</span>
          <span>{timeAgo(comment.created_at)}</span>
          <button className="forum-text-btn" onClick={() => setShowReply(v => !v)}>
            {showReply ? 'Cancel' : 'Reply'}
          </button>
          {comment.is_mine && (
            <button className="forum-text-btn danger" onClick={() => onDelete(comment.id)}>Delete</button>
          )}
        </div>
        <div className="forum-comment-text">{comment.body}</div>
        {showReply && (
          <ForumCommentBox postId={postId} parentId={comment.id} onSubmit={onReply}
            placeholder="Write a reply…" onCancel={() => setShowReply(false)} />
        )}
        {comment.replies?.map(r => (
          <ForumComment key={r.id} comment={r} postId={postId}
            onVote={onVote} onReply={onReply} onDelete={onDelete} depth={depth + 1} />
        ))}
      </div>
    </div>
  )
}

function ForumPage() {
  const [view,        setView]        = useState('feed')
  const [posts,       setPosts]       = useState(null)
  const [currentPost, setCurrentPost] = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [showForm,    setShowForm]    = useState(false)
  const [newTitle,    setNewTitle]    = useState('')
  const [newBody,     setNewBody]     = useState('')
  const [busy,        setBusy]        = useState(false)

  useEffect(() => { if (view === 'feed') loadPosts() }, [view])

  function loadPosts() {
    setLoading(true)
    apiFetch('/api/forum/posts').then(r => r.json())
      .then(d => { setPosts(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  function openPost(id) {
    setLoading(true)
    apiFetch(`/api/forum/posts/${id}`).then(r => r.json())
      .then(d => { setCurrentPost(d); setView('post'); setLoading(false) })
      .catch(() => setLoading(false))
  }

  function submitPost() {
    if (!newTitle.trim() || !newBody.trim()) return
    setBusy(true)
    apiFetch('/api/forum/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim(), body: newBody.trim() }),
    }).then(r => r.json()).then(() => {
      setShowForm(false); setNewTitle(''); setNewBody(''); setBusy(false); loadPosts()
    }).catch(() => setBusy(false))
  }

  function votePost(id, vote) {
    apiFetch(`/api/forum/posts/${id}/vote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vote }),
    }).then(r => r.json()).then(d => {
      setPosts(prev => prev?.map(p => p.id === id ? { ...p, score: d.score, my_vote: vote } : p))
      if (currentPost?.id === id) setCurrentPost(prev => ({ ...prev, score: d.score, my_vote: vote }))
    })
  }

  function voteComment(commentId, vote) {
    apiFetch(`/api/forum/comments/${commentId}/vote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vote }),
    }).then(r => r.json()).then(d => {
      setCurrentPost(prev => ({
        ...prev, comments: patchComment(prev.comments, commentId, { score: d.score, my_vote: vote })
      }))
    })
  }

  function patchComment(list, id, patch) {
    return list.map(c => c.id === id
      ? { ...c, ...patch }
      : { ...c, replies: patchComment(c.replies || [], id, patch) })
  }

  function addComment(postId, body, parentId) {
    return apiFetch(`/api/forum/posts/${postId}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, parent_id: parentId || null }),
    }).then(r => r.json()).then(nc => {
      setCurrentPost(prev => ({
        ...prev,
        comments: parentId
          ? patchComment(prev.comments, parentId, { replies: [...(prev.comments.find(c => findById(prev.comments, parentId))?.replies || []), nc] })
          : [...prev.comments, nc],
      }))
      if (!parentId) {
        setCurrentPost(prev => ({ ...prev, comments: [...prev.comments.filter(c => c.id !== nc.id), ...(prev.comments.some(c => c.id === nc.id) ? [] : [nc])] }))
      }
    })
  }

  // Simpler addComment that reloads the post
  function addCommentReload(postId, body, parentId) {
    return apiFetch(`/api/forum/posts/${postId}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, parent_id: parentId || null }),
    }).then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(() => apiFetch(`/api/forum/posts/${postId}`).then(r => r.json())
        .then(d => setCurrentPost(d)))
  }

  function deletePost(id) {
    if (!window.confirm('Delete this post?')) return
    apiFetch(`/api/forum/posts/${id}`, { method: 'DELETE' }).then(() => {
      if (view === 'post') setView('feed')
      else setPosts(prev => prev.filter(p => p.id !== id))
    })
  }

  function deleteComment(id) {
    if (!window.confirm('Delete this comment?')) return
    apiFetch(`/api/forum/comments/${id}`, { method: 'DELETE' })
      .then(() => apiFetch(`/api/forum/posts/${currentPost.id}`).then(r => r.json()).then(d => setCurrentPost(d)))
  }

  // ── Feed view ─────────────────────────────────────────────────────────────
  if (view === 'feed') return (
    <div className="forum-page">
      <div className="forum-header">
        <h1 className="forum-title">Community</h1>
        <button className="forum-btn primary" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : '+ New Post'}
        </button>
      </div>

      {showForm && (
        <div className="forum-new-post-form">
          <input className="forum-input" placeholder="Title" maxLength={200}
            value={newTitle} onChange={e => setNewTitle(e.target.value)} />
          <textarea className="forum-textarea" rows={5} placeholder="What's on your mind?"
            value={newBody} onChange={e => setNewBody(e.target.value)} />
          <div className="forum-form-actions">
            <button className="forum-btn secondary" onClick={() => { setShowForm(false); setNewTitle(''); setNewBody('') }}>Cancel</button>
            <button className="forum-btn primary" onClick={submitPost}
              disabled={busy || !newTitle.trim() || !newBody.trim()}>
              {busy ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      )}

      {loading && <p className="forum-loading">Loading…</p>}
      {!loading && posts?.length === 0 && <p className="forum-empty">No posts yet — be the first!</p>}

      <div className="forum-feed">
        {posts?.map(post => (
          <div key={post.id} className="forum-post-card" onClick={() => openPost(post.id)}>
            <ForumVote score={post.score} myVote={post.my_vote} onVote={v => { votePost(post.id, v) }} />
            <div className="forum-post-main">
              <div className="forum-post-title">{post.title}</div>
              <div className="forum-post-preview">{post.body.slice(0, 120)}{post.body.length > 120 ? '…' : ''}</div>
              <div className="forum-post-meta">
                <span className="forum-author">{post.author}</span>
                <span className="forum-dot">·</span>
                <span>{timeAgo(post.created_at)}</span>
                <span className="forum-dot">·</span>
                <span>{post.comment_count} {post.comment_count === 1 ? 'reply' : 'replies'}</span>
              </div>
            </div>
            {post.is_mine && (
              <button className="forum-del-btn" onClick={e => { e.stopPropagation(); deletePost(post.id) }}>×</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )

  // ── Post detail view ──────────────────────────────────────────────────────
  return (
    <div className="forum-page">
      <button className="forum-back-btn" onClick={() => setView('feed')}>← Community</button>

      {loading && <p className="forum-loading">Loading…</p>}

      {currentPost && (
        <>
          <div className="forum-post-detail">
            <ForumVote score={currentPost.score} myVote={currentPost.my_vote}
              onVote={v => votePost(currentPost.id, v)} />
            <div className="forum-post-body-wrap">
              <h2 className="forum-detail-title">{currentPost.title}</h2>
              <div className="forum-post-meta">
                <span className="forum-author">{currentPost.author}</span>
                <span className="forum-dot">·</span>
                <span>{timeAgo(currentPost.created_at)}</span>
                {currentPost.is_mine && (
                  <button className="forum-text-btn danger" onClick={() => deletePost(currentPost.id)}>Delete</button>
                )}
              </div>
              <div className="forum-detail-body">{currentPost.body}</div>
            </div>
          </div>

          <div className="forum-comment-area">
            <div className="forum-section-label">Leave a comment</div>
            <ForumCommentBox postId={currentPost.id} parentId={null}
              onSubmit={addCommentReload} placeholder="Share your thoughts…" />
          </div>

          <div className="forum-comments-section">
            <div className="forum-section-label">
              {currentPost.comments.length} {currentPost.comments.length === 1 ? 'Reply' : 'Replies'}
            </div>
            {currentPost.comments.map(c => (
              <ForumComment key={c.id} comment={c} postId={currentPost.id}
                onVote={voteComment} onReply={addCommentReload} onDelete={deleteComment} depth={0} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

// ── Dashboard page ────────────────────────────────────────────────────────────

function DashboardPage({ onSelectPlayer, onSelectBlogPost }) {
  const todayET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const [games,     setGames]     = useState(null)
  const [injuries,  setInjuries]  = useState(null)
  const [news,      setNews]      = useState(null)
  const [comments,  setComments]  = useState(null)
  const [trending,  setTrending]  = useState([])
  const [blogPosts, setBlogPosts] = useState([])

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

    // Fetch trending players (up + down, 7-day window) — fire independently
    const mergeTrending = (up, dn) => {
      const upP = (up?.players || []).map(p => ({ ...p, dir: 'up' }))
      const dnP = (dn?.players || []).map(p => ({ ...p, dir: 'down' }))
      const merged = []
      const max = Math.max(upP.length, dnP.length)
      for (let i = 0; i < max; i++) {
        if (i < upP.length) merged.push(upP[i])
        if (i < dnP.length) merged.push(dnP[i])
      }
      return merged
    }
    let trendUp = null, trendDn = null
    apiFetch('/api/trending?window=14&direction=up&limit=10')
      .then(r => r.ok ? r.json() : null)
      .then(d => { trendUp = d; setTrending(mergeTrending(trendUp, trendDn)) })
      .catch(() => {})
    apiFetch('/api/trending?window=14&direction=down&limit=10')
      .then(r => r.ok ? r.json() : null)
      .then(d => { trendDn = d; setTrending(mergeTrending(trendUp, trendDn)) })
      .catch(() => {})

    apiFetch('/api/blog/posts')
      .then(r => r.ok ? r.json() : null)
      .then(d => setBlogPosts((d?.posts || []).filter(p => p.is_published).slice(0, 8)))
      .catch(() => {})
  }, [])

  const DES_ORDER = { 'Out': 0, 'Doubtful': 1, 'Questionable': 2, 'Day-To-Day': 3 }
  const isGenericImage = url => !url || url.includes('nophoto')

  // Flatten injuries to a sorted list
  const injList = injuries?.teams
    ? Object.values(injuries.teams).flat()
        .sort((a, b) => (DES_ORDER[a.designation] ?? 9) - (DES_ORDER[b.designation] ?? 9))
    : injuries ? [] : null

  const TICKER_STAT = { pts:'PTS', reb:'REB', ast:'AST', stl:'STL', blk:'BLK', tov:'TOV', fg3m:'3PM', fg_pct:'FG%', ft_pct:'FT%' }
  function tickerLabel(p) {
    try {
      const d     = p.drivers?.[0]
      const stat  = d ? (TICKER_STAT[d.stat] || d.stat) : null
      const delta = (d && d.delta != null) ? `${d.delta > 0 ? '+' : ''}${Number(d.delta).toFixed(1)} ${stat}` : null
      const dz    = p.delta_z != null ? `${p.delta_z > 0 ? '+' : ''}${Number(p.delta_z).toFixed(1)}ΔZ` : ''
      return `${p.name}  ${p.dir === 'up' ? '▲' : '▼'}  ${delta ? `${delta} · ` : ''}${dz}`
    } catch { return p.name || '' }
  }

  return (
    <>
    {/* ── Trending Ticker ────────────────────────────────── */}
    {trending.length > 0 && (
      <div className="dash-ticker-wrap">
        <span className="dash-ticker-label">TRENDING · 14D</span>
        <div className="dash-ticker-viewport">
          <div className="dash-ticker-track" style={{ animationDuration: `${trending.length * 4}s` }}>
            {[...trending, ...trending].map((p, i) => (
              <span
                key={i}
                className={`dash-ticker-item ${p.dir === 'up' ? 'dash-ticker-up' : 'dash-ticker-down'}`}
                onClick={() => onSelectPlayer?.({ slug: p.slug, name: p.name })}
              >
                {tickerLabel(p)}
              </span>
            ))}
          </div>
        </div>
      </div>
    )}

    <div className="dash-outer">
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
            <div key={`${c.comment_type}-${c.id}`} className="dash-comment">
              <div className="dash-comment-header">
                {c.comment_type === 'blog'
                  ? <span className="dash-comment-player rank-player-link" onClick={() => onSelectBlogPost?.(c.post_slug)}>
                      {c.post_title}
                    </span>
                  : <span className="dash-comment-player rank-player-link"
                      onClick={() => onSelectPlayer({ slug: c.player_slug, name: c.player_name })}>
                      {c.player_name}
                    </span>
                }
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

      {/* ── Blog Strip ─────────────────────────────────────── */}
      <div className="dash-blog-strip">
        <h2 className="dash-card-title">From the Blog</h2>
        {blogPosts.length === 0
          ? <div className="dash-empty">No posts yet.</div>
          : blogPosts.map(post => (
            <div
              key={post.id}
              className="dash-blog-item"
              onClick={() => onSelectBlogPost?.(post.slug)}
            >
              {post.cover_image && (
                <img className="dash-blog-thumb" src={post.cover_image} alt="" />
              )}
              <div className="dash-blog-info">
                {post.category && <span className="dash-blog-cat">{post.category}</span>}
                <div className="dash-blog-title">{post.title}</div>
                <div className="dash-blog-date">
                  {new Date(post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </div>
            </div>
          ))
        }
      </div>
    </div>
    </>
  )
}

// ── Comments section ─────────────────────────────────────────────────────────

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

// ── Adjustments page (admin only) ────────────────────────────────────────────

const ADJ_FIELDS = ['min_pg','fga_pg','fg_pct','fg3a_pg','fg3_pct','fta_pg','ft_pct',
                    'oreb_rate','dreb_rate','ast_rate','stl_rate','blk_rate','tov_rate']

// ── Trending Players ──────────────────────────────────────────────────────────

const STAT_LABELS = {
  pts: 'PTS', reb: 'REB', ast: 'AST', stl: 'STL', blk: 'BLK',
  tov: 'TOV', fg3m: '3PM', fg_pct: 'FG%', ft_pct: 'FT%',
}


const TRENDING_PRESETS = [
  { label: 'Mar vs Apr', a: { start: '2026-03-01', end: '2026-03-31' }, b: { start: '2026-04-01', end: '2026-04-13' } },
  { label: 'Feb vs Mar', a: { start: '2026-02-01', end: '2026-02-28' }, b: { start: '2026-03-01', end: '2026-03-31' } },
  { label: 'Jan vs Mar', a: { start: '2026-01-01', end: '2026-01-31' }, b: { start: '2026-03-01', end: '2026-03-31' } },
  { label: 'Pre/Post All-Star', a: { start: '2025-10-22', end: '2026-02-13' }, b: { start: '2026-02-21', end: '2026-04-13' } },
]

function TrendingPage({ onSelectPlayer, ownership }) {
  const [direction,      setDirection]      = useState('up')
  const [window,         setWindow]         = useState(7)
  const [data,           setData]           = useState(null)
  const [loading,        setLoading]        = useState(true)
  const [faOnly,         setFaOnly]         = useState(false)
  const [showDateFilter, setShowDateFilter] = useState(false)
  const [periodA,        setPeriodA]        = useState({ start: '', end: '' })
  const [periodB,        setPeriodB]        = useState({ start: '', end: '' })
  const [customActive,   setCustomActive]   = useState(false)
  const [minFilter,      setMinFilter]      = useState(false)

  const fetchTrending = (dir, win, custom, pA, pB, minMins) => {
    setLoading(true)
    let url = `/api/trending?direction=${dir}&limit=15`
    if (custom && pA.start && pA.end && pB.start && pB.end) {
      url += `&baseline_start=${pA.start}&baseline_end=${pA.end}&comp_start=${pB.start}&comp_end=${pB.end}`
    } else {
      url += `&window=${win}`
    }
    if (minMins > 0) url += `&min_minutes=${minMins}`
    apiFetch(url)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    fetchTrending(direction, window, false, periodA, periodB, minFilter ? 20 : 0)
  }, [window, direction, minFilter])

  const handleApplyDates = () => {
    if (!periodA.start || !periodA.end || !periodB.start || !periodB.end) return
    setCustomActive(true)
    fetchTrending(direction, window, true, periodA, periodB, minFilter ? 20 : 0)
  }

  const handleClearDates = () => {
    setCustomActive(false)
    setPeriodA({ start: '', end: '' })
    setPeriodB({ start: '', end: '' })
    fetchTrending(direction, window, false, {}, {}, minFilter ? 20 : 0)
  }

  const hasOwnership = Object.keys(ownership || {}).length > 0
  const players = (data?.players || []).filter(p => !faOnly || !ownership?.[p.slug])
  const compLabel = customActive && data?.comp_start
    ? `${data.comp_start} – ${data.comp_end}`
    : `${window}d`
  const baseLabel = customActive && data?.baseline_start
    ? `${data.baseline_start} – ${data.baseline_end}`
    : 'Season'

  return (
    <div className="trend-page">
      <div className="trend-header">
        <p className="trend-subtitle">
          Players whose recent stats are diverging from their season baseline.
          ΔZ = comparison Z − baseline Z.
        </p>
      </div>

      <div className="trend-controls">
        <div className="trend-toggle-group">
          <button className={`trend-toggle${direction === 'up' ? ' active' : ''}`} onClick={() => { setDirection('up'); fetchTrending('up', window, customActive, periodA, periodB, minFilter ? 20 : 0) }}>
            Trending Up
          </button>
          <button className={`trend-toggle${direction === 'down' ? ' active' : ''}`} onClick={() => { setDirection('down'); fetchTrending('down', window, customActive, periodA, periodB, minFilter ? 20 : 0) }}>
            Trending Down
          </button>
        </div>
        <div className={`trend-toggle-group${customActive ? ' trend-toggle-group-dim' : ''}`}>
          {[7, 14, 30].map(d => (
            <button key={d} className={`trend-toggle${window === d && !customActive ? ' active' : ''}`}
              onClick={() => { setCustomActive(false); setWindow(d) }}>
              {d}d
            </button>
          ))}
        </div>
        <div className="trend-toggle-group">
          <button
            className={`trend-toggle${showDateFilter ? ' active' : ''}${customActive ? ' trend-toggle-custom-active' : ''}`}
            onClick={() => setShowDateFilter(v => !v)}
          >
            {customActive ? 'Custom ✓' : 'Date range'} {showDateFilter ? '▲' : '▼'}
          </button>
        </div>
        <div className="trend-toggle-group">
          <button className={`trend-toggle${minFilter ? ' active' : ''}`} onClick={() => setMinFilter(v => !v)}>
            20+ MIN
          </button>
        </div>
        {hasOwnership && (
          <div className="trend-toggle-group">
            <button className={`trend-toggle${faOnly ? ' active' : ''}`} onClick={() => setFaOnly(f => !f)}>
              Free agents only
            </button>
          </div>
        )}
      </div>

      {showDateFilter && (
        <div className="trend-date-filter">
          <div className="trend-date-presets">
            {TRENDING_PRESETS.map(p => (
              <button key={p.label} className="preset-btn" onClick={() => { setPeriodA(p.a); setPeriodB(p.b) }}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="trend-date-rows">
            <div className="ctrl-group ctrl-period">
              <span className="ctrl-label">Baseline period</span>
              <div className="date-pair">
                <input className="ctrl-input date-input" type="date" value={periodA.start} onChange={e => setPeriodA(p => ({ ...p, start: e.target.value }))} />
                <span className="date-sep">–</span>
                <input className="ctrl-input date-input" type="date" value={periodA.end}   onChange={e => setPeriodA(p => ({ ...p, end:   e.target.value }))} />
              </div>
            </div>
            <div className="ctrl-group ctrl-period">
              <span className="ctrl-label">Comparison period</span>
              <div className="date-pair">
                <input className="ctrl-input date-input" type="date" value={periodB.start} onChange={e => setPeriodB(p => ({ ...p, start: e.target.value }))} />
                <span className="date-sep">–</span>
                <input className="ctrl-input date-input" type="date" value={periodB.end}   onChange={e => setPeriodB(p => ({ ...p, end:   e.target.value }))} />
              </div>
            </div>
            <div className="trend-date-actions">
              <button className="analyse-btn" onClick={handleApplyDates}
                disabled={!periodA.start || !periodA.end || !periodB.start || !periodB.end}>
                Apply
              </button>
              {customActive && (
                <button className="preset-btn" onClick={handleClearDates}>Clear</button>
              )}
            </div>
          </div>
        </div>
      )}

      {loading && <div className="trend-loading">Loading…</div>}

      {!loading && players.length === 0 && (
        <div className="trend-empty">No trending players found for this window.</div>
      )}

      <div className="trend-grid">
        {players.map(p => {
          const s = p.sustainability
          const maxAbs = Math.max(...p.drivers.map(d => Math.abs(d.contribution)), 0.01)

          const fmtDelta = (v, decimals = 1) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(decimals)}`
          const deltaClass = v => v > 0 ? 'trend-pos' : v < 0 ? 'trend-neg' : ''

          return (
            <div key={p.slug} className="trend-card">
              <div className="trend-card-header">
                <div className="trend-player-info" onClick={() => onSelectPlayer && onSelectPlayer({ slug: p.slug, name: p.name })} style={{ cursor: 'pointer' }}>
                  <span className="trend-pname">{p.name}</span>
                  <span className="trend-pmeta">{p.team}</span>
                </div>
                <div className={`trend-dz-badge ${direction === 'up' ? 'trend-dz-up' : 'trend-dz-down'}`}>
                  {p.delta_z > 0 ? '+' : ''}{p.delta_z.toFixed(2)} ΔZ
                </div>
              </div>

              {/* Key context metrics */}
              <div className="trend-metrics">
                <div className="trend-metric">
                  <span className="trend-metric-label">MIN/g</span>
                  <span className="trend-metric-values">
                    <span className="trend-metric-base">{p.season_min}</span>
                    <span className="trend-metric-arrow">→</span>
                    <span className="trend-metric-now">{p.window_min}</span>
                  </span>
                  <span className={`trend-metric-delta ${deltaClass(p.min_delta)}`}>{fmtDelta(p.min_delta)}</span>
                </div>
                <div className="trend-metric">
                  <span className="trend-metric-label">FGA/g</span>
                  <span className="trend-metric-values">
                    <span className="trend-metric-base">{p.season_fga}</span>
                    <span className="trend-metric-arrow">→</span>
                    <span className="trend-metric-now">{p.window_fga}</span>
                  </span>
                  <span className={`trend-metric-delta ${deltaClass(p.fga_delta)}`}>{fmtDelta(p.fga_delta)}</span>
                </div>
                <div className="trend-metric">
                  <span className="trend-metric-label">FG%</span>
                  <span className="trend-metric-values">
                    <span className="trend-metric-base">{p.season_fg}%</span>
                    <span className="trend-metric-arrow">→</span>
                    <span className="trend-metric-now">{p.window_fg}%</span>
                  </span>
                  <span className={`trend-metric-delta ${deltaClass(p.fg_pct_delta)}`}>{fmtDelta(p.fg_pct_delta)}%</span>
                </div>
                {p.ease_season != null && p.ease_window != null && (() => {
                  const easeDelta = +(p.ease_window - p.ease_season).toFixed(1)
                  // Higher pts allowed = easier defence — positive delta means easier window
                  return (
                    <div className="trend-metric">
                      <span className="trend-metric-label">Sched ease</span>
                      <span className="trend-metric-values">
                        <span className="trend-metric-base">{p.ease_season}</span>
                        <span className="trend-metric-arrow">→</span>
                        <span className="trend-metric-now">{p.ease_window}</span>
                      </span>
                      <span className={`trend-metric-delta ${deltaClass(easeDelta)}`}>{fmtDelta(easeDelta)}</span>
                    </div>
                  )
                })()}
              </div>

              {/* Z row */}
              <div className="trend-z-row">
                <div className="trend-z-item">
                  <span className="trend-z-label">{baseLabel} Z</span>
                  <span className={`trend-z-val ${p.season_z >= 0 ? 'trend-pos' : 'trend-neg'}`}>{p.season_z.toFixed(2)}</span>
                </div>
                <div className="trend-z-arrow">→</div>
                <div className="trend-z-item">
                  <span className="trend-z-label">{compLabel} Z</span>
                  <span className={`trend-z-val ${p.window_z >= 0 ? 'trend-pos' : 'trend-neg'}`}>{p.window_z.toFixed(2)}</span>
                </div>
                <div className="trend-z-item trend-z-games">
                  <span className="trend-z-label">Games</span>
                  <span className="trend-z-val">{p.window_gp}/{p.season_gp}</span>
                </div>
              </div>

              {/* Driver bars */}
              <div className="trend-drivers">
                {p.drivers.map(d => {
                  const pct = Math.abs(d.contribution) / maxAbs * 100
                  const pos = d.contribution > 0
                  return (
                    <div key={d.stat} className="trend-driver-row">
                      <span className="trend-driver-label">{STAT_LABELS[d.stat] || d.stat}</span>
                      <div className="trend-driver-track">
                        <div
                          className={`trend-driver-bar ${pos ? 'trend-bar-pos' : 'trend-bar-neg'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className={`trend-driver-val ${pos ? 'trend-pos' : 'trend-neg'}`}>
                        {d.contribution > 0 ? '+' : ''}{d.contribution.toFixed(2)}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Sustainability badge */}
              <div className={`trend-sustain trend-sustain-${s.level}`}>
                <span className="trend-sustain-label">{s.label}</span>
                <span className="trend-sustain-reason">{s.reason}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


function AdjustmentsPage() {
  const [isAdmin,       setIsAdmin]       = useState(false)
  const [checked,       setChecked]       = useState(false)
  const [teams,         setTeams]         = useState([])
  const [selectedTeam,  setSelectedTeam]  = useState('')
  const [players,       setPlayers]       = useState([])
  const [leagueParams,  setLeagueParams]  = useState(null)
  const [edits,         setEdits]         = useState({})
  const [adjIds,        setAdjIds]        = useState({})
  const [saving,        setSaving]        = useState({})
  const [msgs,          setMsgs]          = useState({})
  const [loading,       setLoading]       = useState(false)
  // Team-level date range applied to all saves
  const [teamStart,     setTeamStart]     = useState('')
  const [teamEnd,       setTeamEnd]       = useState('')

  useEffect(() => {
    apiFetch('/api/adjustments/is-admin')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setIsAdmin(!!d?.is_admin); setChecked(true) })
      .catch(() => setChecked(true))
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    apiFetch('/api/adjustments/league-params').then(r => r.ok ? r.json() : null).then(d => { if (d) setLeagueParams(d) })
    apiFetch('/api/adjustments/teams').then(r => r.ok ? r.json() : null).then(d => { if (d) setTeams(d.teams) })
  }, [isAdmin])

  useEffect(() => {
    if (!selectedTeam) return
    setLoading(true)
    apiFetch(`/api/adjustments/team-players/${encodeURIComponent(selectedTeam)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        setPlayers(d.players)
        const newEdits = {}, newIds = {}
        for (const p of d.players) {
          newEdits[p.slug] = { ...(p.adjustment || p.baseline) }
          if (p.adjustment?.id) newIds[p.slug] = p.adjustment.id
        }
        setEdits(newEdits)
        setAdjIds(newIds)
        setMsgs({})
        // Pre-fill team dates from any existing adjustment
        const anyAdj = d.players.find(p => p.adjustment)?.adjustment
        if (anyAdj) {
          setTeamStart(anyAdj.start_date || '')
          setTeamEnd(anyAdj.end_date || '')
        }
      })
      .finally(() => setLoading(false))
  }, [selectedTeam])

  function computePts(e) {
    const fga = +e.fga_pg || 0, fgPct = +e.fg_pct || 0
    const fg3a = +e.fg3a_pg || 0, fg3Pct = +e.fg3_pct || 0
    const fta = +e.fta_pg || 0, ftPct = +e.ft_pct || 0
    return (Math.max(fga - fg3a, 0) * fgPct / 100 * 2 + fg3a * fg3Pct / 100 * 3 + fta * ftPct / 100).toFixed(1)
  }

  function computePerGame(e) {
    const min = +e.min_pg || 0
    return {
      reb: ((+e.oreb_rate || 0) + (+e.dreb_rate || 0)) * min / 36,
      ast:  (+e.ast_rate  || 0) * min / 36,
      stl:  (+e.stl_rate  || 0) * min / 36,
      blk:  (+e.blk_rate  || 0) * min / 36,
      tov:  (+e.tov_rate  || 0) * min / 36,
    }
  }

  function computeZ(e) {
    if (!leagueParams) return null
    const fga = +e.fga_pg || 0, fgPct = +e.fg_pct || 0
    const fg3a = +e.fg3a_pg || 0, fg3Pct = +e.fg3_pct || 0
    const fta = +e.fta_pg || 0, ftPct = +e.ft_pct || 0
    const fg3m = fg3a * fg3Pct / 100
    const pts  = Math.max(fga - fg3a, 0) * fgPct / 100 * 2 + fg3m * 3 + fta * ftPct / 100
    const pg   = computePerGame(e)
    const statVals = { pts, fg3m, reb: pg.reb, ast: pg.ast, stl: pg.stl, blk: pg.blk, tov: pg.tov }
    const { fg_mean, ft_mean, stats } = leagueParams
    let total = 0, count = 0
    for (const [key, { mean, std }] of Object.entries(stats || {})) {
      if (!std) continue
      let z
      if (key === 'fg_pct')      z = ((fgPct - fg_mean) * fga - mean) / std
      else if (key === 'ft_pct') z = ((ftPct - ft_mean) * fta - mean) / std
      else { const v = statVals[key]; if (v == null) continue; z = (v - mean) / std; if (key === 'tov') z = -z }
      total += z; count++
    }
    return count > 0 ? total.toFixed(2) : null
  }

  function isEdited(slug) {
    const p = players.find(x => x.slug === slug)
    if (!p) return false
    return ADJ_FIELDS.some(k => String(edits[slug]?.[k] ?? '') !== String(p.baseline[k] ?? ''))
  }

  function setField(slug, field, val) {
    setEdits(prev => ({ ...prev, [slug]: { ...(prev[slug] || {}), [field]: val } }))
  }

  function resetPlayer(slug) {
    const p = players.find(x => x.slug === slug)
    if (p) setEdits(prev => ({ ...prev, [slug]: { ...p.baseline } }))
    setMsgs(prev => ({ ...prev, [slug]: null }))
  }

  async function savePlayer(slug) {
    const e = edits[slug] || {}
    setSaving(prev => ({ ...prev, [slug]: true }))
    try {
      const body = { player_slug: slug }
      for (const f of ADJ_FIELDS) {
        const v = e[f]; body[f] = v !== '' && v != null ? parseFloat(v) : null
      }
      body.start_date = teamStart || null
      body.end_date   = teamEnd   || null

      const adjId = adjIds[slug]
      const res = await apiFetch(adjId ? `/api/adjustments/${adjId}` : '/api/adjustments', {
        method: adjId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Save failed') }
      const adj = await res.json()
      setAdjIds(prev => ({ ...prev, [slug]: adj.id }))
      setPlayers(prev => prev.map(p => p.slug === slug ? { ...p, adjustment: adj } : p))
      setMsgs(prev => ({ ...prev, [slug]: { type: 'ok', text: 'Saved' } }))
    } catch (err) {
      setMsgs(prev => ({ ...prev, [slug]: { type: 'err', text: err.message } }))
    }
    setSaving(prev => ({ ...prev, [slug]: false }))
  }

  async function saveAll() {
    for (const p of players) {
      if (isEdited(p.slug) || adjIds[p.slug]) await savePlayer(p.slug)
    }
  }

  async function deleteAdj(slug) {
    const adjId = adjIds[slug]
    if (!adjId || !confirm('Remove this adjustment?')) return
    await apiFetch(`/api/adjustments/${adjId}`, { method: 'DELETE' })
    setAdjIds(prev => { const n = { ...prev }; delete n[slug]; return n })
    const p = players.find(x => x.slug === slug)
    if (p) setEdits(prev => ({ ...prev, [slug]: { ...p.baseline } }))
    setPlayers(prev => prev.map(pp => pp.slug === slug ? { ...pp, adjustment: null } : pp))
    setMsgs(prev => ({ ...prev, [slug]: null }))
  }

  const totalMins = players.reduce((s, p) => s + (+edits[p.slug]?.min_pg || 0), 0)
  const minsOk    = Math.abs(totalMins - 240) < 1

  const teamTotals = (() => {
    let fga = 0, fgaWtPct = 0, fg3a = 0, fg3aWtPct = 0, fta = 0, ftaWtPct = 0
    let oreb = 0, dreb = 0, ast = 0, stl = 0, blk = 0, tov = 0, pts = 0, z = 0
    for (const p of players) {
      const e   = edits[p.slug] || {}
      const min = +e.min_pg || 0
      const thisFga  = +e.fga_pg  || 0; fga  += thisFga;  fgaWtPct  += thisFga  * (+e.fg_pct  || 0)
      const thisFg3a = +e.fg3a_pg || 0; fg3a += thisFg3a; fg3aWtPct += thisFg3a * (+e.fg3_pct || 0)
      const thisFta  = +e.fta_pg  || 0; fta  += thisFta;  ftaWtPct  += thisFta  * (+e.ft_pct  || 0)
      oreb += (+e.oreb_rate || 0) * min / 36
      dreb += (+e.dreb_rate || 0) * min / 36
      ast  += (+e.ast_rate  || 0) * min / 36
      stl  += (+e.stl_rate  || 0) * min / 36
      blk  += (+e.blk_rate  || 0) * min / 36
      tov  += (+e.tov_rate  || 0) * min / 36
      pts  += parseFloat(computePts(e)) || 0
      z    += parseFloat(computeZ(e)) || 0
    }
    return {
      fga: fga.toFixed(1),
      fg_pct: fga > 0 ? (fgaWtPct / fga).toFixed(1) : '—',
      fg3a: fg3a.toFixed(1),
      fg3_pct: fg3a > 0 ? (fg3aWtPct / fg3a).toFixed(1) : '—',
      fta: fta.toFixed(1),
      ft_pct: fta > 0 ? (ftaWtPct / fta).toFixed(1) : '—',
      oreb: oreb.toFixed(1), dreb: dreb.toFixed(1),
      ast: ast.toFixed(1), stl: stl.toFixed(1),
      blk: blk.toFixed(1), tov: tov.toFixed(1),
      pts: pts.toFixed(1), z: z.toFixed(2),
    }
  })()

  function numInput(slug, field, w = '52px') {
    return (
      <input type="number" step="0.1" min="0" className="adj-input" style={{ width: w }}
        value={edits[slug]?.[field] ?? ''}
        onChange={ev => setField(slug, field, ev.target.value)} />
    )
  }

  if (!checked) return null
  if (!isAdmin) return <div className="adj-page"><p className="adj-no-access">Admin access required.</p></div>

  return (
    <div className="adj-page">
      <div className="adj-header">
        <h2 className="adj-title">Projection Adjustments</h2>
        <div className="adj-team-row">
          <label className="adj-label">Team</label>
          <select className="adj-team-select" value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)}>
            <option value="">— select team —</option>
            {teams.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {selectedTeam && (
        <>
          {/* Team-level controls */}
          <div className="adj-team-controls">
            <div className="adj-val-bar-wrap">
              <div className={`adj-val-bar ${minsOk ? 'adj-val-ok' : 'adj-val-bad'}`}>
                <span>Team minutes: <strong>{totalMins.toFixed(1)}</strong> / 240</span>
                {!minsOk && <span className="adj-val-hint">Adjust totals to sum to 240</span>}
                {minsOk  && <span className="adj-val-hint">✓ Minutes balanced</span>}
              </div>
            </div>
            <div className="adj-date-group">
              <label className="adj-label">Period From</label>
              <input type="date" className="adj-date-input" value={teamStart}
                onChange={e => setTeamStart(e.target.value)} />
              <label className="adj-label">To</label>
              <input type="date" className="adj-date-input" value={teamEnd}
                onChange={e => setTeamEnd(e.target.value)} />
              <span className="adj-date-note">Applied to all saves</span>
            </div>
          </div>

          {loading ? <div className="adj-loading">Loading…</div> : (
            <div className="adj-table-wrap">
              <table className="adj-table">
                <thead>
                  <tr>
                    <th className="adj-th adj-th-name">Player</th>
                    <th className="adj-th">MIN</th>
                    <th className="adj-th">FGA</th>
                    <th className="adj-th">FG%</th>
                    <th className="adj-th">3PA</th>
                    <th className="adj-th">3P%</th>
                    <th className="adj-th">FTA</th>
                    <th className="adj-th">FT%</th>
                    <th className="adj-th adj-th-rate">OREB<br/>/36</th>
                    <th className="adj-th adj-th-rate">DREB<br/>/36</th>
                    <th className="adj-th adj-th-rate">AST<br/>/36</th>
                    <th className="adj-th adj-th-rate">STL<br/>/36</th>
                    <th className="adj-th adj-th-rate">BLK<br/>/36</th>
                    <th className="adj-th adj-th-rate">TOV<br/>/36</th>
                    <th className="adj-th adj-th-pts">PTS*</th>
                    <th className="adj-th adj-th-z">Z (Δ)</th>
                    <th className="adj-th adj-th-act"></th>
                  </tr>
                </thead>
                <tbody>
                  {players.map(p => {
                    const e      = edits[p.slug] || {}
                    const pts    = computePts(e)
                    const pg     = computePerGame(e)
                    const z      = computeZ(e)
                    const bz     = computeZ(p.baseline)
                    const hasAdj = !!adjIds[p.slug]
                    const edited = isEdited(p.slug)
                    const msg    = msgs[p.slug]
                    const zDelta = z != null && bz != null ? (parseFloat(z) - parseFloat(bz)).toFixed(2) : null
                    return (
                      <tr key={p.slug} className={`adj-row${hasAdj ? ' adj-row-live' : ''}`}>
                        <td className="adj-td adj-td-name">
                          <div className="adj-name-cell">
                            <span className="adj-pname">{p.name}</span>
                            <span className="adj-ppos">{posAbbr(p.position)}</span>
                            {hasAdj && <span className="adj-live-dot" title="Active adjustment" />}
                          </div>
                        </td>
                        <td className="adj-td">{numInput(p.slug, 'min_pg',    '52px')}</td>
                        <td className="adj-td">{numInput(p.slug, 'fga_pg',    '48px')}</td>
                        <td className="adj-td">{numInput(p.slug, 'fg_pct',    '48px')}</td>
                        <td className="adj-td">{numInput(p.slug, 'fg3a_pg',   '44px')}</td>
                        <td className="adj-td">{numInput(p.slug, 'fg3_pct',   '44px')}</td>
                        <td className="adj-td">{numInput(p.slug, 'fta_pg',    '44px')}</td>
                        <td className="adj-td">{numInput(p.slug, 'ft_pct',    '48px')}</td>
                        <td className="adj-td adj-td-rate">{numInput(p.slug, 'oreb_rate', '44px')}</td>
                        <td className="adj-td adj-td-rate">{numInput(p.slug, 'dreb_rate', '44px')}</td>
                        <td className="adj-td adj-td-rate">{numInput(p.slug, 'ast_rate',  '44px')}</td>
                        <td className="adj-td adj-td-rate">{numInput(p.slug, 'stl_rate',  '40px')}</td>
                        <td className="adj-td adj-td-rate">{numInput(p.slug, 'blk_rate',  '40px')}</td>
                        <td className="adj-td adj-td-rate">{numInput(p.slug, 'tov_rate',  '40px')}</td>
                        <td className="adj-td adj-td-pts">{pts}</td>
                        <td className="adj-td adj-td-z">
                          <span className={zDelta > 0 ? 'adj-z-pos' : zDelta < 0 ? 'adj-z-neg' : ''}>{z ?? '—'}</span>
                          {zDelta != null && (
                            <span className={`adj-z-delta ${zDelta > 0 ? 'adj-z-pos' : zDelta < 0 ? 'adj-z-neg' : ''}`}>
                              {zDelta > 0 ? `+${zDelta}` : zDelta}
                            </span>
                          )}
                        </td>
                        <td className="adj-td adj-td-act">
                          <div className="adj-act-btns">
                            <button className="adj-save-btn" onClick={() => savePlayer(p.slug)} disabled={saving[p.slug]}>
                              {saving[p.slug] ? '…' : 'Save'}
                            </button>
                            {edited && <button className="adj-reset-btn" onClick={() => resetPlayer(p.slug)}>Reset</button>}
                            {hasAdj && <button className="adj-del-btn" onClick={() => deleteAdj(p.slug)}>✕</button>}
                          </div>
                          {msg && <div className={`adj-msg ${msg.type === 'ok' ? 'adj-msg-ok' : 'adj-msg-err'}`}>{msg.text}</div>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="adj-tfoot">
                    <td className="adj-td adj-td-name"><strong>Team total</strong></td>
                    <td className="adj-td"><strong className={minsOk ? 'adj-z-pos' : 'adj-z-neg'}>{totalMins.toFixed(1)}</strong></td>
                    <td className="adj-td"><strong>{teamTotals.fga}</strong></td>
                    <td className="adj-td"><strong>{teamTotals.fg_pct}</strong></td>
                    <td className="adj-td"><strong>{teamTotals.fg3a}</strong></td>
                    <td className="adj-td"><strong>{teamTotals.fg3_pct}</strong></td>
                    <td className="adj-td"><strong>{teamTotals.fta}</strong></td>
                    <td className="adj-td"><strong>{teamTotals.ft_pct}</strong></td>
                    <td className="adj-td adj-td-rate"><strong>{teamTotals.oreb}</strong></td>
                    <td className="adj-td adj-td-rate"><strong>{teamTotals.dreb}</strong></td>
                    <td className="adj-td adj-td-rate"><strong>{teamTotals.ast}</strong></td>
                    <td className="adj-td adj-td-rate"><strong>{teamTotals.stl}</strong></td>
                    <td className="adj-td adj-td-rate"><strong>{teamTotals.blk}</strong></td>
                    <td className="adj-td adj-td-rate"><strong>{teamTotals.tov}</strong></td>
                    <td className="adj-td adj-td-pts"><strong>{teamTotals.pts}</strong></td>
                    <td className="adj-td adj-td-z"><strong>{teamTotals.z}</strong></td>
                    <td className="adj-td" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="adj-footnote">
            * PTS = (FGA−3PA)×FG%×2 + 3PA×3P%×3 + FTA×FT%. Rate stats per 36 min → per-game via adjusted MIN.
            Z-score vs current season population.
          </div>
        </>
      )}
    </div>
  )
}


// ── Blog page ─────────────────────────────────────────────────────────────────

function BlogPage({ setPage, initSlug, onMount }) {
  const [view, setView]             = useState('list')
  const [posts, setPosts]           = useState([])
  const [categories, setCategories] = useState([])
  const [isAdmin, setIsAdmin]       = useState(false)
  const [selCategory, setSelCategory] = useState(null)
  const [currentPost, setCurrentPost] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [editDraft, setEditDraft]   = useState(null)
  const [preview, setPreview]       = useState(false)
  const [saving, setSaving]         = useState(false)
  const [saveError, setSaveError]   = useState('')
  const [blogComments, setBlogComments] = useState([])
  const [commentDraft, setCommentDraft] = useState('')
  const [posting, setPosting]       = useState(false)
  const textareaRef                 = useRef(null)

  useEffect(() => {
    if (initSlug) { onMount?.(); openPost(initSlug) }
    else loadList()
  }, [])
  useEffect(() => { if (!initSlug) loadList() }, [selCategory])

  function loadList() {
    setLoading(true)
    const q = selCategory ? `?category=${encodeURIComponent(selCategory)}` : ''
    apiFetch(`/api/blog/posts${q}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setPosts(d.posts); setCategories(d.categories); setIsAdmin(d.is_admin) } })
      .finally(() => setLoading(false))
  }

  function openPost(slug) {
    apiFetch(`/api/blog/posts/${slug}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        setCurrentPost(d)
        setBlogComments(d.comments || [])
        setCommentDraft('')
        setView('post')
      })
  }

  function startEdit(post = null) {
    setEditDraft(post
      ? { id: post.id, title: post.title, content: post.content, cover_image: post.cover_image || '', category: post.category || '', is_published: post.is_published }
      : { title: '', content: '', cover_image: '', category: '', is_published: false }
    )
    setPreview(false)
    setSaveError('')
    setView('edit')
  }

  async function savePost() {
    setSaving(true); setSaveError('')
    const isNew = !editDraft.id
    const res = await apiFetch(isNew ? '/api/blog/posts' : `/api/blog/posts/${editDraft.id}`, {
      method: isNew ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editDraft),
    }).catch(() => null)
    if (res?.ok) {
      const saved = await res.json()
      setSaving(false)
      openPost(saved.slug)
    } else {
      setSaveError('Save failed. Please try again.')
      setSaving(false)
    }
  }

  async function deletePost() {
    if (!window.confirm('Delete this post?')) return
    await apiFetch(`/api/blog/posts/${currentPost.id}`, { method: 'DELETE' })
    setView('list')
    loadList()
  }

  function insertImage() {
    const url = window.prompt('Image URL:')
    if (!url) return
    const alt = window.prompt('Alt text (optional):') || ''
    const tag = `\n\n![${alt}](${url})\n\n`
    const el  = textareaRef.current
    if (el) {
      const s = el.selectionStart, e = el.selectionEnd
      const next = editDraft.content.slice(0, s) + tag + editDraft.content.slice(e)
      setEditDraft(d => ({ ...d, content: next }))
      setTimeout(() => { el.selectionStart = el.selectionEnd = s + tag.length }, 0)
    } else {
      setEditDraft(d => ({ ...d, content: d.content + tag }))
    }
  }

  // Render markdown-lite: paragraphs separated by blank lines, images via ![alt](url)
  function renderContent(text) {
    if (!text) return null
    const IMG = /!\[([^\]]*)\]\(([^)]+)\)/g
    return text.split(/\n\n+/).map((para, pi) => {
      const trimmed = para.trim()
      // Standalone image
      const solo = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
      if (solo) return <img key={pi} src={solo[2]} alt={solo[1]} className="blog-content-img" />
      // Mixed inline
      const parts = []; let last = 0; let m; IMG.lastIndex = 0
      while ((m = IMG.exec(para)) !== null) {
        if (m.index > last) parts.push(para.slice(last, m.index))
        parts.push(<img key={m.index} src={m[2]} alt={m[1]} className="blog-inline-img" />)
        last = m.index + m[0].length
      }
      if (last < para.length) parts.push(para.slice(last))
      return <p key={pi} className="blog-para">{parts}</p>
    })
  }

  async function submitComment(e) {
    e.preventDefault()
    if (!commentDraft.trim()) return
    setPosting(true)
    const res = await apiFetch(`/api/blog/posts/${currentPost.id}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: commentDraft.trim() }),
    }).catch(() => null)
    if (res?.ok) { const c = await res.json(); setBlogComments(prev => [c, ...prev]); setCommentDraft('') }
    setPosting(false)
  }

  async function voteComment(commentId, vote) {
    const res = await apiFetch(`/api/blog/comments/${commentId}/vote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vote }),
    }).catch(() => null)
    if (res?.ok) {
      const updated = await res.json()
      setBlogComments(prev => prev.map(c => c.id === commentId ? { ...c, ...updated } : c))
    }
  }

  // ── List view ──────────────────────────────────────────────────────────────
  if (view === 'list') return (
    <div className="blog-page">
      <div className="blog-list-header">
        <h1 className="blog-page-title">Blog</h1>
        {isAdmin && <button className="blog-new-btn" onClick={() => startEdit()}>+ New Post</button>}
      </div>
      {categories.length > 0 && (
        <div className="blog-cat-pills">
          <button className={`blog-cat-pill${!selCategory ? ' active' : ''}`} onClick={() => setSelCategory(null)}>All</button>
          {categories.map(c => (
            <button key={c} className={`blog-cat-pill${selCategory === c ? ' active' : ''}`} onClick={() => setSelCategory(c)}>{c}</button>
          ))}
        </div>
      )}
      {loading
        ? <div className="dash-loading">Loading…</div>
        : posts.length === 0
          ? <div className="dash-empty">No posts yet.</div>
          : <div className="blog-post-list">
              {posts.map(p => (
                <div key={p.id} className={`blog-post-card${!p.is_published ? ' blog-draft-card' : ''}`} onClick={() => openPost(p.slug)}>
                  {p.cover_image && <img src={p.cover_image} alt="" className="blog-card-cover" />}
                  <div className="blog-card-body">
                    <div className="blog-card-meta">
                      {p.category && <span className="blog-cat-tag">{p.category}</span>}
                      {!p.is_published && <span className="blog-draft-tag">Draft</span>}
                      <span className="blog-card-date">{timeAgo(p.created_at)}</span>
                    </div>
                    <h2 className="blog-card-title">{p.title}</h2>
                    <p className="blog-card-excerpt">
                      {p.content.replace(/!\[[^\]]*\]\([^)]+\)/g, '').replace(/\n+/g, ' ').trim().slice(0, 180)}
                      {p.content.length > 180 ? '…' : ''}
                    </p>
                    <span className="blog-card-comments">{p.comment_count} comment{p.comment_count !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              ))}
            </div>
      }
    </div>
  )

  // ── Post view ──────────────────────────────────────────────────────────────
  if (view === 'post' && currentPost) return (
    <div className="blog-page">
      <div className="blog-post-nav">
        <button className="blog-back-btn" onClick={() => { setView('list'); loadList() }}>← Back to Blog</button>
        {currentPost.is_admin && (
          <div className="blog-admin-actions">
            <button className="blog-edit-btn" onClick={() => startEdit(currentPost)}>Edit</button>
            <button className="blog-delete-btn" onClick={deletePost}>Delete</button>
          </div>
        )}
      </div>
      {currentPost.cover_image && <img src={currentPost.cover_image} alt="" className="blog-post-cover" />}
      <div className="blog-post-header">
        {currentPost.category && <span className="blog-cat-tag">{currentPost.category}</span>}
        {!currentPost.is_published && <span className="blog-draft-tag">Draft</span>}
        <h1 className="blog-post-title">{currentPost.title}</h1>
        <p className="blog-post-byline">{timeAgo(currentPost.created_at)}</p>
      </div>
      <div className="blog-post-content">{renderContent(currentPost.content)}</div>
      <div className="blog-comments">
        <h3 className="panel-title" style={{ marginBottom: 12 }}>Comments</h3>
        <form onSubmit={submitComment} className="comment-form">
          <textarea className="comment-input" placeholder="Add a comment…" value={commentDraft}
            onChange={e => setCommentDraft(e.target.value)} rows={2} />
          <button className="comment-post-btn" type="submit" disabled={posting || !commentDraft.trim()}>
            {posting ? '…' : 'Post'}
          </button>
        </form>
        {blogComments.length === 0
          ? <p className="comment-empty">No comments yet. Be the first!</p>
          : blogComments.map(c => (
            <div key={c.id} className="comment-row">
              <div className="comment-meta">
                <span className="comment-author">{c.author}</span>
                <span className="comment-time">{timeAgo(c.created_at)}</span>
              </div>
              <p className="comment-body">{c.body}</p>
              <div className="comment-votes">
                <button className={`vote-btn${c.my_vote === 1 ? ' active-up' : ''}`} onClick={() => voteComment(c.id, 1)}>👍 {c.thumbs_up > 0 ? c.thumbs_up : ''}</button>
                <button className={`vote-btn${c.my_vote === -1 ? ' active-down' : ''}`} onClick={() => voteComment(c.id, -1)}>👎 {c.thumbs_down > 0 ? c.thumbs_down : ''}</button>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  )

  // ── Edit / Create view ─────────────────────────────────────────────────────
  if (view === 'edit' && editDraft !== null) return (
    <div className="blog-page">
      <div className="blog-post-nav">
        <button className="blog-back-btn" onClick={() => editDraft.id ? openPost(currentPost?.slug) : (setView('list'), loadList())}>
          ← {editDraft.id ? 'Back to Post' : 'Back to Blog'}
        </button>
        <span className="blog-edit-heading">{editDraft.id ? 'Edit Post' : 'New Post'}</span>
      </div>
      <div className="blog-editor">
        <div className="blog-editor-row">
          <label className="blog-editor-label">Title</label>
          <input className="blog-editor-input" value={editDraft.title}
            onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))} placeholder="Post title…" />
        </div>
        <div className="blog-editor-row">
          <label className="blog-editor-label">Category</label>
          <input className="blog-editor-input blog-editor-half" value={editDraft.category}
            onChange={e => setEditDraft(d => ({ ...d, category: e.target.value }))} placeholder="e.g. Analysis" />
        </div>
        <div className="blog-editor-row">
          <label className="blog-editor-label">Cover Image URL</label>
          <input className="blog-editor-input" value={editDraft.cover_image}
            onChange={e => setEditDraft(d => ({ ...d, cover_image: e.target.value }))} placeholder="https://…" />
        </div>
        <div className="blog-editor-row blog-editor-content-row">
          <div className="blog-editor-toolbar">
            <label className="blog-editor-label">Content</label>
            <div className="blog-editor-toolbar-btns">
              <button type="button" className="blog-toolbar-btn" onClick={insertImage}>🖼 Insert Image</button>
              <button type="button" className={`blog-toolbar-btn${preview ? ' active' : ''}`} onClick={() => setPreview(p => !p)}>
                {preview ? 'Edit' : 'Preview'}
              </button>
            </div>
          </div>
          {preview
            ? <div className="blog-preview-pane">{renderContent(editDraft.content) || <span className="blog-preview-empty">Nothing to preview.</span>}</div>
            : <textarea ref={textareaRef} className="blog-editor-textarea"
                value={editDraft.content}
                onChange={e => setEditDraft(d => ({ ...d, content: e.target.value }))}
                placeholder="Write your post here…&#10;&#10;Separate paragraphs with a blank line.&#10;Insert images with the toolbar button." />
          }
        </div>
        <div className="blog-editor-row blog-editor-footer">
          <label className="blog-publish-toggle">
            <input type="checkbox" checked={!!editDraft.is_published}
              onChange={e => setEditDraft(d => ({ ...d, is_published: e.target.checked }))} />
            Published
          </label>
          {saveError && <span className="blog-save-error">{saveError}</span>}
          <button className="blog-save-btn" onClick={savePost} disabled={saving || !editDraft.title.trim()}>
            {saving ? 'Saving…' : 'Save Post'}
          </button>
        </div>
      </div>
    </div>
  )

  return null
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

function ManagerDashboard({ onSelectPlayer, provider = 'espn' }) {
  const [league,     setLeague]     = useState(null)
  const [roster,     setRoster]     = useState(null)
  const [matchup,    setMatchup]    = useState(undefined)
  const [playerFeed, setPlayerFeed] = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [msg,        setMsg]        = useState(null)

  const isYahoo = provider === 'yahoo'

  useEffect(() => {
    setLoading(true)
    Promise.all([
      apiFetch(isYahoo ? '/api/fantasy/league'         : '/api/fantasy/espn/league').then(r => r.ok ? r.json() : null),
      apiFetch(isYahoo ? '/api/fantasy/roster'         : '/api/fantasy/espn/roster').then(r => r.ok ? r.json() : null),
      apiFetch(isYahoo ? '/api/fantasy/yahoo/matchup'  : '/api/fantasy/espn/matchup').then(r => r.ok ? r.json() : null),
    ]).then(([l, r, m]) => {
      if (isYahoo && l && l.teams && !l.standings) {
        l = {
          standings: l.teams.map(t => ({ ...t, is_my_team: t.is_mine })),
          league_name: l.league_name || '',
        }
      }
      setLeague(l); setRoster(r)
      setMatchup(m?.matchup ?? null)
      // Fetch news + injuries for rostered players
      const slugs = (r?.players || []).map(p => p.br_slug).filter(Boolean)
      if (slugs.length) {
        apiFetch(`/api/player-news?slugs=${slugs.join(',')}`)
          .then(res => res.ok ? res.json() : null)
          .then(d => setPlayerFeed(d))
          .catch(() => {})
      }
    }).catch(() => setMsg('Failed to load fantasy data'))
    .finally(() => setLoading(false))
  }, [provider])

  if (loading) return <div className="dash-empty">Loading…</div>
  if (msg) return <div className="login-error" style={{margin:24}}>{msg}</div>

  const cats = matchup?.categories || []

  return (
    <div className="fantasy-wrap">

      {/* Current Matchup — full width */}
      <div className="dash-card dash-matchup-card">
        <div className="dash-card-title">
          Current Matchup{matchup?.matchup_period ? ` — Week ${matchup.matchup_period}` : ''}
        </div>
        {!matchup ? (
          <div className="dash-empty">No active matchup</div>
        ) : cats.length > 0 ? (
          <div style={{overflowX:'auto'}}>
            <table className="dash-table dash-matchup-cat-table">
              <thead>
                <tr>
                  <th>Team</th>
                  {cats.map(c => <th key={c.stat}>{c.stat}</th>)}
                  <th>Cats</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="dash-matchup-team-name dash-matchup-my">{matchup.my_team}</td>
                  {cats.map(c => (
                    <td key={c.stat} className={c.winning ? 'dash-cat-win' : c.tied ? 'dash-cat-tied' : 'dash-cat-loss'}>
                      {c.my_val}
                    </td>
                  ))}
                  <td className={`dash-matchup-cat-count ${cats.filter(c => c.winning).length > cats.filter(c => !c.winning && !c.tied).length ? 'dash-cat-win' : ''}`}>
                    {cats.filter(c => c.winning).length}
                  </td>
                </tr>
                <tr>
                  <td className="dash-matchup-team-name">{matchup.opp_team}</td>
                  {cats.map(c => (
                    <td key={c.stat} className={!c.winning && !c.tied ? 'dash-cat-win' : c.tied ? 'dash-cat-tied' : 'dash-cat-loss'}>
                      {c.opp_val}
                    </td>
                  ))}
                  <td className={`dash-matchup-cat-count ${cats.filter(c => !c.winning && !c.tied).length > cats.filter(c => c.winning).length ? 'dash-cat-win' : ''}`}>
                    {cats.filter(c => !c.winning && !c.tied).length}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dash-matchup-simple">
            <span className="dash-matchup-my">{matchup.my_team}</span>
            <span className="dash-matchup-score-val">{matchup.my_score}</span>
            <span style={{color:'var(--muted)'}}>vs</span>
            <span className="dash-matchup-score-val">{matchup.opp_score}</span>
            <span>{matchup.opp_team}</span>
          </div>
        )}
      </div>

      {/* Bottom row: Roster + Standings */}
      <div className="dash-bottom-grid">

        {/* Roster */}
        <div className="dash-card">
          <div className="dash-card-title">My Roster{roster?.team_name ? ` — ${roster.team_name}` : ''}</div>
          {!roster ? (
            <div className="dash-empty">No roster data</div>
          ) : (
            <table className="dash-table">
              <thead>
                <tr><th style={{textAlign:'left'}}>Player</th><th style={{textAlign:'center'}}>Pos</th><th style={{textAlign:'left'}}>Status</th></tr>
              </thead>
              <tbody>
                {(roster.players || []).map((p, i) => {
                  const dbInj   = (playerFeed?.injuries || []).find(inj => inj.slug === p.br_slug)
                  const STATUS_LABELS = { 'Day-To-Day': 'DTD', 'Day_To_Day': 'DTD', 'Questionable': 'Q', 'Doubtful': 'DBT' }
                  const status  = STATUS_LABELS[p.injury_status] ?? p.injury_status ?? 'Active'
                  const isOut   = status !== 'Active'
                  const retDate = p.return_date || dbInj?.return_date
                  const fmtDate = d => {
                    if (!d) return null
                    const parts = d.split('-'); if (parts.length < 3) return d
                    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                    return `${months[+parts[1]-1]} ${+parts[2]}`
                  }
                  return (
                    <tr key={p.name + i}>
                      <td
                        className={p.br_slug && onSelectPlayer ? 'rank-player-link' : undefined}
                        onClick={() => p.br_slug && onSelectPlayer && onSelectPlayer({ slug: p.br_slug, name: p.name })}
                      >{p.name}</td>
                      <td style={{textAlign:'center'}}>{p.position || '—'}</td>
                      <td className="dash-roster-status">
                        <span className={isOut ? 'inj-out' : 'dash-status-active'}>{status}</span>
                        {dbInj?.description && <span className="dash-inj-desc"> · {dbInj.description}</span>}
                        {retDate && <span className="dash-inj-return"> · Exp. {fmtDate(retDate)}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Standings */}
        <div className="dash-card">
          <div className="dash-card-title">Standings{league?.league_name ? ` — ${league.league_name}` : ''}</div>
          {!league ? (
            <div className="dash-empty">No standings data</div>
          ) : (() => {
            const winPct = t => {
              const total = t.wins + t.losses + (t.ties || 0)
              return total > 0 ? (t.wins + 0.5 * (t.ties || 0)) / total : 0
            }
            const rows = [...(league.standings || [])].sort((a, b) => winPct(b) - winPct(a))
            const hasTies = rows.some(t => (t.ties || 0) > 0)
            return (
              <table className="dash-table">
                <thead>
                  <tr>
                    <th style={{textAlign:'center'}}>#</th>
                    <th style={{textAlign:'left'}}>Team</th>
                    <th style={{textAlign:'center'}}>W</th>
                    <th style={{textAlign:'center'}}>L</th>
                    {hasTies && <th style={{textAlign:'center'}}>T</th>}
                    <th style={{textAlign:'center'}}>W%</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t, i) => {
                    const pct = (winPct(t) * 100).toFixed(1) + '%'
                    return (
                      <tr key={t.team_id} className={t.is_my_team ? 'fantasy-my-team' : ''}>
                        <td style={{textAlign:'center'}}>{i + 1}</td>
                        <td style={{textAlign:'left'}}>{t.name}</td>
                        <td style={{textAlign:'center'}}>{t.wins}</td>
                        <td style={{textAlign:'center'}}>{t.losses}</td>
                        {hasTies && <td style={{textAlign:'center'}}>{t.ties || 0}</td>}
                        <td style={{textAlign:'center'}}>{pct}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          })()}
        </div>

      </div>

      {/* Roster Updates — injuries + news */}
      {(() => {
        const slugToName = Object.fromEntries((roster?.players || []).map(p => [p.br_slug, p.name]))
        const INJ_BADGE = {
          'Out':          { bg: '#ff4444', text: '#fff' },
          'Doubtful':     { bg: '#ff7700', text: '#fff' },
          'Questionable': { bg: '#ccaa00', text: '#000' },
          'DTD':          { bg: '#ccaa00', text: '#000' },
        }
        const fmtDate = d => {
          if (!d) return null
          const parts = d.split('-'); if (parts.length < 3) return d
          const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
          return `${months[+parts[1]-1]} ${+parts[2]}`
        }
        const injuries = playerFeed?.injuries || []
        const news     = playerFeed?.news     || []
        return (
          <div className="dash-card" style={{ marginTop: 16 }}>
            <div className="dash-card-title">Roster Updates</div>
            <div className="dash-updates-section">

              {/* Injuries */}
              <div className="dash-updates-col">
                <div className="dash-card-subtitle">Injuries</div>
                {injuries.length === 0
                  ? <div className="dash-empty" style={{ fontSize: 13 }}>No injuries reported</div>
                  : <div className="dash-inj-list">
                      {injuries.map((inj, i) => {
                        const badge = INJ_BADGE[inj.designation] || { bg: 'var(--surface-3)', text: 'var(--muted)' }
                        return (
                          <div key={i} className="dash-inj-item">
                            <span className="dash-inj-badge" style={{ background: badge.bg, color: badge.text }}>
                              {inj.designation === 'Day-To-Day' ? 'DTD' : inj.designation}
                            </span>
                            <span
                              className={`dash-inj-name${inj.slug && onSelectPlayer ? ' rank-player-link' : ''}`}
                              onClick={() => inj.slug && onSelectPlayer && onSelectPlayer({ slug: inj.slug, name: inj.name })}
                            >{inj.name}</span>
                            {inj.description && <span className="dash-inj-desc">{inj.description}</span>}
                            {inj.return_date && <span className="dash-inj-return">Exp. {fmtDate(inj.return_date)}</span>}
                          </div>
                        )
                      })}
                    </div>
                }
              </div>

              {/* News */}
              <div className="dash-updates-col">
                <div className="dash-card-subtitle">Recent News</div>
                {news.length === 0
                  ? <div className="dash-empty" style={{ fontSize: 13 }}>No recent news</div>
                  : <div className="dash-news-list">
                      {news.slice(0, 8).map((item, i) => {
                        const names = item.slugs.map(s => slugToName[s] || s).filter(Boolean)
                        return (
                          <div key={i} className="dash-news-item">
                            {names.length > 0 && <div className="dash-news-players">{names.join(' · ')}</div>}
                            <a className="dash-news-title" href={item.link} target="_blank" rel="noopener noreferrer">
                              {item.title}
                            </a>
                            <div className="dash-news-date">{fmtDate(item.date)}</div>
                          </div>
                        )
                      })}
                    </div>
                }
              </div>

            </div>
          </div>
        )
      })()}

    </div>
  )
}

// ── Projected Standings stub ───────────────────────────────────────────────────

function ProjectedStandings({ endpoint = '/api/fantasy/espn/projected-standings' }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [msg,     setMsg]     = useState(null)

  useEffect(() => {
    apiFetch(endpoint)
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

      {(() => {
        const hasTies = standings.some(t => (t.actual_ties || 0) + (t.proj_ties || 0) > 0)
        const projWinPct = t => {
          const total = t.proj_total_wins + t.proj_total_losses + (t.proj_total_ties || 0)
          return total > 0 ? (t.proj_total_wins + 0.5 * (t.proj_total_ties || 0)) / total : 0
        }
        return (
          <table className="proj-table">
            <thead>
              <tr>
                <th>Proj</th><th>Team</th><th>Current</th>
                <th>+W</th><th>+L</th>{hasTies && <th>+T</th>}<th>Proj W-L</th><th>W%</th>
              </tr>
            </thead>
            <tbody>
              {standings.map(t => {
                const moved = t.actual_standing - t.proj_standing
                const curRecord = hasTies
                  ? `${t.actual_wins}–${t.actual_losses}–${t.actual_ties || 0}`
                  : `${t.actual_wins}–${t.actual_losses}`
                const projRecord = hasTies
                  ? `${t.proj_total_wins}–${t.proj_total_losses}–${t.proj_total_ties || 0}`
                  : `${t.proj_total_wins}–${t.proj_total_losses}`
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
                    <td className="proj-now">{curRecord}</td>
                    <td className="scoring-pos">+{t.proj_wins}</td>
                    <td className="scoring-neg">+{t.proj_losses}</td>
                    {hasTies && <td>+{t.proj_ties || 0}</td>}
                    <td><strong>{projRecord}</strong></td>
                    <td>{(projWinPct(t) * 100).toFixed(1)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )
      })()}

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

function RosterAnalysis({ data, dwData, dwErr, freeAgents, onSelectPlayer }) {
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
                <td
                  className={`ra-player-name${p.br_slug && onSelectPlayer ? ' rank-player-link' : ''}`}
                  onClick={() => p.br_slug && onSelectPlayer && onSelectPlayer({ slug: p.br_slug, name: p.espn_name })}
                >{p.espn_name}{!p.br_slug && <span className="ra-no-data"> (no data)</span>}</td>
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

      {/* ── Category Landscape ── */}
      <CTWBarChart data={data} freeAgents={freeAgents} />

      {/* ── Decisive Wins ── */}
      {dwErr && <div className="login-error" style={{margin:'0 0 16px'}}>{dwErr}</div>}
      {dwData && dwData.players && dwData.players.length > 0 && (() => {
        const dwCats = dwData.tracked_cats || []
        const dwNeg  = new Set(dwData.neg_cats || [])
        function dwNet(cat_data) {
          if (cat_data == null) return null
          const v = typeof cat_data === 'number' ? cat_data : cat_data?.net
          return (v == null || !isFinite(v)) ? null : v
        }
        function dwRate(cat_data) {
          const net = dwNet(cat_data)
          if (net == null) return '—'
          const pct = Math.round(net * 100)
          if (pct === 0) return '0%'
          return (pct > 0 ? '+' : '') + pct + '%'
        }
        function dwCls(cat_data) {
          if (cat_data == null) return ''
          const net = dwNet(cat_data)
          if (net >= 0.4)  return 'ra-z-pos'
          if (net >= 0.1)  return 'ra-dw-pos-dim'
          if (net > -0.1)  return 'ra-z-neu'
          if (net > -0.4)  return 'ra-dw-neg-dim'
          return 'ra-z-neg'
        }
        const maxAbs = Math.max(...dwData.players.map(p => Math.abs(p.total || 0)), 0.01)
        return (
          <>
            <div className="ra-section-title" style={{display:'flex',alignItems:'center',gap:8}}>
              Decisive Wins
              <span className="ra-dw-sub">
                {dwData.season_complete
                  ? `Season complete · evaluated vs all ${dwData.weeks_remaining} league teams`
                  : `${dwData.weeks_remaining} week${dwData.weeks_remaining !== 1 ? 's' : ''} remaining`
                } · % of matchups where this player is the difference-maker
              </span>
            </div>
            <div className="dash-card ra-card-wide" style={{overflowX:'auto',marginBottom:24}}>
              <table className="dash-table ra-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th style={{whiteSpace:'nowrap',textAlign:'left'}}>Total</th>
                    {dwCats.map(c => (
                      <th key={c} title={dwNeg.has(c) ? `${c} (lower=better)` : c} style={{textAlign:'center'}}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dwData.players.map(p => (
                    <tr key={p.slug}>
                      <td
                        className={`ra-player-name${p.slug && onSelectPlayer ? ' rank-player-link' : ''}`}
                        onClick={() => p.slug && onSelectPlayer && onSelectPlayer({ slug: p.slug, name: p.name })}
                      >{p.name}</td>
                      <td style={{whiteSpace:'nowrap',textAlign:'left'}}>
                        <div style={{display:'inline-flex',alignItems:'center',gap:6}}>
                          <span style={{
                            fontFamily:'var(--mono)',fontWeight:600,fontSize:13,
                            color: p.total > 0 ? 'var(--skill)' : p.total < 0 ? '#ff6b6b' : undefined
                          }}>
                            {p.total != null ? (p.total > 0 ? '+' : '') + p.total.toFixed(1) : '—'}
                          </span>
                          <div className="ra-dw-bar" style={{
                            width: Math.round((Math.abs(p.total) / maxAbs) * 60),
                            background: p.total >= 0 ? 'var(--skill)' : '#ff6b6b'
                          }} />
                        </div>
                      </td>
                      {dwCats.map(c => {
                        const r = p.by_category?.[c]
                        return (
                          <td key={c} className={dwCls(r)} style={{fontFamily:'var(--mono)',fontSize:12,textAlign:'center'}}>
                            {dwRate(r)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      })()}
    </div>
  )
}

// ── Category Landscape chart ───────────────────────────────────────────────────

const PLAYER_COLORS = [
  '#4fc3f7','#81c784','#ffb74d','#f06292','#ba68c8',
  '#4db6ac','#dce775','#ff8a65','#90a4ae','#a1887f','#80deea','#ffe082',
]

function CTWBarChart({ data, freeAgents }) {
  const [toggledOut, setToggledOut] = useState(new Set())
  const [replMode,   setReplMode]   = useState(false)
  const [hoverSlug,  setHoverSlug]  = useState(null)
  const [tooltip,    setTooltip]    = useState(null)
  const containerRef = useRef(null)
  const [containerW, setContainerW] = useState(800)

  useEffect(() => {
    if (!containerRef.current) return
    setContainerW(containerRef.current.clientWidth)
    const ro = new ResizeObserver(([e]) => setContainerW(e.contentRect.width))
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const { my_roster, teams, tracked_cats, neg_cats, stat_name_map, cat_ranks } = data
  const negSet     = new Set(neg_cats || [])
  const cats       = tracked_cats || []
  const catToKey   = {}
  cats.forEach(c => { if (stat_name_map[c]) catToKey[c] = stat_name_map[c] })
  const activePlayers = (my_roster || []).filter(p => p.br_slug && p.stats)
  const otherTeams    = (teams || []).filter(t => !t.is_my_team)

  const repl = useMemo(() => {
    const top5 = (freeAgents || []).filter(fa => fa.stats).slice(0, 5)
    if (!top5.length) return null
    const r = {}
    for (const k of ['pts','reb','ast','stl','blk','tov','fg3m'])
      r[k] = top5.reduce((s, fa) => s + (fa.stats[k] || 0), 0) / top5.length
    const fgm = top5.reduce((s, fa) => s + (fa.stats.fga_pg||0)*(fa.stats.fg_pct||0)/100, 0)
    const fga = top5.reduce((s, fa) => s + (fa.stats.fga_pg||0), 0)
    const ftm = top5.reduce((s, fa) => s + (fa.stats.fta_pg||0)*(fa.stats.ft_pct||0)/100, 0)
    const fta = top5.reduce((s, fa) => s + (fa.stats.fta_pg||0), 0)
    r.fga_pg = fga/top5.length; r.fta_pg = fta/top5.length
    r.fg_pct = fga ? fgm/fga*100 : 0
    r.ft_pct = fta ? ftm/fta*100 : 0
    return r
  }, [freeAgents])

  function togglePlayer(slug) {
    setToggledOut(prev => { const n = new Set(prev); n.has(slug)?n.delete(slug):n.add(slug); return n })
  }

  function teamTotals() {
    let pts=0,reb=0,ast=0,stl=0,blk=0,tov=0,fg3m=0,fgm=0,fga=0,ftm=0,fta=0
    for (const p of activePlayers) {
      const s = toggledOut.has(p.br_slug) ? (replMode ? repl : null) : p.stats
      if (!s) continue
      pts+=s.pts||0; reb+=s.reb||0; ast+=s.ast||0; stl+=s.stl||0
      blk+=s.blk||0; tov+=s.tov||0; fg3m+=s.fg3m||0
      const fa=s.fga_pg||0, ta=s.fta_pg||0
      fgm+=fa*(s.fg_pct||0)/100; fga+=fa
      ftm+=ta*(s.ft_pct||0)/100; fta+=ta
    }
    return { pts,reb,ast,stl,blk,tov,fg3m,
             fg_pct:fga?fgm/fga*100:0, ft_pct:fta?ftm/fta*100:0,
             _fgm:fgm,_fga:fga,_ftm:ftm,_fta:fta }
  }

  function playerSeg(p, key, ts) {
    const s = toggledOut.has(p.br_slug) ? (replMode ? repl : null) : p.stats
    if (!s) return 0
    if (key==='fg_pct') return ts._fga ? (s.fga_pg||0)*(s.fg_pct||0)/100/ts._fga*100 : 0
    if (key==='ft_pct') return ts._fta ? (s.fta_pg||0)*(s.ft_pct||0)/100/ts._fta*100 : 0
    return s[key] || 0
  }

  const ts = teamTotals()

  const maxVals = {}
  for (const cat of cats) {
    const key = catToKey[cat]; if (!key) continue
    maxVals[cat] = Math.max(...(teams||[]).map(t=>t.stats?.[key]||0), ts[key]||0, 0.001)
  }

  function modRank(cat) {
    const key = catToKey[cat]; if (!key) return null
    const isNeg = negSet.has(cat), myVal = ts[key]||0
    const rank = otherTeams.filter(t => isNeg ? (t.stats?.[key]||0)<myVal : (t.stats?.[key]||0)>myVal).length + 1
    return { rank, total: otherTeams.length + 1 }
  }

  function rankFill(rank, total) {
    if (rank <= Math.ceil(total/3))  return 'var(--skill)'
    if (rank > total-Math.ceil(total/3)) return '#ff6b6b'
    return 'rgba(255,255,255,0.4)'
  }

  // Dynamic bar width — fill the container
  const numCats = cats.length
  const leftM=6, barGap=12, chartH=180, topM=12, botM=42
  const barW = numCats>0 ? Math.max(24, (containerW - leftM*2 - barGap*(numCats-1)) / numCats) : 44
  const svgH = chartH + topM + botM

  return (
    <div className="dash-card" style={{marginBottom:16}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
        <div className="ra-section-title" style={{margin:0}}>Category Landscape</div>
        <div style={{display:'flex',borderRadius:4,overflow:'hidden',border:'1px solid rgba(255,255,255,0.12)'}}>
          <button style={{padding:'3px 10px',fontSize:11,border:'none',cursor:'pointer',
                          background:!replMode?'rgba(255,255,255,0.13)':'transparent',color:'#ccc'}}
                  onClick={()=>setReplMode(false)}>No Replacement</button>
          <button style={{padding:'3px 10px',fontSize:11,border:'none',cursor:'pointer',
                          background:replMode?'rgba(255,255,255,0.13)':'transparent',
                          color:repl?'#ccc':'rgba(255,255,255,0.3)',
                          cursor:repl?'pointer':'not-allowed'}}
                  title={repl?undefined:'Free agent data not available'}
                  onClick={()=>repl&&setReplMode(true)}>Replacement</button>
        </div>
        {toggledOut.size>0 && (
          <button style={{fontSize:11,padding:'2px 8px',background:'transparent',cursor:'pointer',
                          border:'1px solid rgba(255,255,255,0.14)',borderRadius:3,color:'rgba(255,255,255,0.45)'}}
                  onClick={()=>setToggledOut(new Set())}>Reset</button>
        )}
      </div>

      <div ref={containerRef} style={{width:'100%',position:'relative'}}>
        <svg width={containerW} height={svgH} style={{display:'block'}}>
          {cats.map((cat, i) => {
            const key = catToKey[cat]; if (!key) return null
            const isNeg = negSet.has(cat)
            const x = leftM + i*(barW+barGap)
            const maxV = maxVals[cat]
            const orig = cat_ranks?.[cat]
            const mod  = modRank(cat)
            const origR = orig?.rank, total = mod?.total || orig?.total || 1
            const modR  = mod?.rank
            const rankChanged = toggledOut.size>0 && origR!=null && modR!=null && origR!==modR
            const displayR = modR ?? origR
            const rankLabel = rankChanged
              ? `#${origR}→#${modR}`
              : displayR ? `#${displayR}` : ''
            const rankImproved = rankChanged && modR < origR
            const rankWorsened = rankChanged && modR > origR
            const rfill = rankChanged
              ? (rankImproved ? 'var(--skill)' : '#ff6b6b')
              : rankFill(displayR, total)

            // Stacked segments, bottom to top
            const segs = []; let top = topM + chartH
            for (const [pi, p] of activePlayers.entries()) {
              const seg = playerSeg(p, key, ts)
              const h = Math.max(0, (seg/maxV)*chartH)
              if (h > 0.3) {
                const col = PLAYER_COLORS[pi%PLAYER_COLORS.length]
                const isHov = hoverSlug===p.br_slug
                const dimmed = hoverSlug && !isHov
                const pStats = toggledOut.has(p.br_slug) ? (replMode ? repl : null) : p.stats
                const tipVal = (key==='fg_pct'||key==='ft_pct') ? (pStats?.[key]||0) : seg
                segs.push(
                  <rect key={p.br_slug} x={x} y={top-h} width={barW} height={h}
                        fill={col}
                        opacity={toggledOut.has(p.br_slug)?(replMode&&repl?0.55:0.12) : dimmed?0.28 : isHov?1 : 0.82}
                        style={{cursor:'pointer'}}
                        onMouseEnter={e=>{setHoverSlug(p.br_slug);setTooltip({x:e.clientX,y:e.clientY,name:p.espn_name,cat,val:tipVal})}}
                        onMouseMove={e=>setTooltip(t=>t?{...t,x:e.clientX,y:e.clientY}:null)}
                        onMouseLeave={()=>{setHoverSlug(null);setTooltip(null)}} />
                )
              }
              top -= h
            }

            return (
              <g key={cat}>
                <rect x={x} y={topM} width={barW} height={chartH} fill="rgba(255,255,255,0.025)" rx={2}/>
                {segs}
                {otherTeams.map((t,li) => {
                  const val=t.stats?.[key]||0
                  const ly=topM+chartH-(val/maxV)*chartH
                  return <line key={li} x1={x} y1={ly} x2={x+barW} y2={ly}
                               stroke="rgba(210,210,210,0.22)" strokeWidth={1}/>
                })}
                <text x={x+barW/2} y={svgH-26} textAnchor="middle"
                      fill="rgba(255,255,255,0.42)" fontSize={10} fontFamily="sans-serif">
                  {cat}{isNeg?' ↓':''}
                </text>
                <text x={x+barW/2} y={svgH-10} textAnchor="middle"
                      fill={rfill} fontSize={9} fontFamily="sans-serif" fontWeight="600">
                  {rankLabel}
                </text>
              </g>
            )
          })}
        </svg>

        {tooltip && (
          <div style={{position:'fixed',left:tooltip.x+14,top:tooltip.y-40,
                       background:'rgba(18,20,30,0.94)',border:'1px solid rgba(255,255,255,0.13)',
                       borderRadius:5,padding:'5px 10px',fontSize:12,pointerEvents:'none',
                       zIndex:9999,whiteSpace:'nowrap',boxShadow:'0 4px 14px rgba(0,0,0,0.5)'}}>
            <strong style={{color:'#fff'}}>{tooltip.name}</strong>
            <span style={{color:'rgba(255,255,255,0.45)',marginLeft:8}}>
              {tooltip.cat}: {typeof tooltip.val==='number' ? tooltip.val.toFixed(1) : tooltip.val}
            </span>
          </div>
        )}
      </div>

      <div style={{display:'flex',flexWrap:'wrap',gap:5,marginTop:10}}>
        {activePlayers.map((p, i) => {
          const isOut = toggledOut.has(p.br_slug)
          const col   = PLAYER_COLORS[i%PLAYER_COLORS.length]
          const isHov = hoverSlug===p.br_slug
          return (
            <div key={p.br_slug}
                 style={{display:'flex',alignItems:'center',gap:5,padding:'4px 9px',borderRadius:4,
                         cursor:'pointer',userSelect:'none',transition:'background 0.1s',
                         background:isHov?'rgba(255,255,255,0.09)':isOut?'rgba(255,255,255,0.02)':'rgba(255,255,255,0.05)',
                         border:`1px solid ${isOut?'rgba(255,255,255,0.08)':col+'55'}`,
                         opacity:isOut?0.4:1}}
                 onClick={()=>togglePlayer(p.br_slug)}
                 onMouseEnter={()=>setHoverSlug(p.br_slug)}
                 onMouseLeave={()=>setHoverSlug(null)}>
              <div style={{width:9,height:9,borderRadius:2,background:col,flexShrink:0}}/>
              <span style={{fontSize:11,color:'rgba(255,255,255,0.8)',textDecoration:isOut?'line-through':'none'}}>
                {p.espn_name}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Trade Analysis tab ─────────────────────────────────────────────────────────

function TradeAnalysis({ data, onSelectPlayer, endpoints = {} }) {
  const EP = {
    freeAgents:   '/api/fantasy/espn/free-agents',
    simulate:     '/api/fantasy/espn/roster-analysis/simulate',
    searchPlayer: '/api/fantasy/espn/roster-analysis/search-player',
    ...endpoints,
  }
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
    setFaLoading(true)
    apiFetch(EP.freeAgents)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setFreeAgents(d.free_agents || []))
      .catch(() => setFreeAgents([]))
      .finally(() => setFaLoading(false))
    // Fetch baseline projected standings (no roster changes)
    apiFetch(EP.simulate, {
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
      const res = await apiFetch(EP.simulate, {
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
    const { slug, name, source } = dragging
    if (zone === 'in-trade') {
      if (source === 'theirs'  && !getSlugs.find(p=>p.slug===slug))  setGetSlugs(prev=>[...prev,{slug,name}])
      if (source === 'theirs2' && !getSlugs2.find(p=>p.slug===slug)) setGetSlugs2(prev=>[...prev,{slug,name}])
    } else if (zone === 'out-trade' && source === 'mine') {
      if (!outSlugs.find(p=>p.slug===slug) && !dropSlugs.find(p=>p.slug===slug))
        setOutSlugs(prev=>[...prev,{slug,name,toTeam:1}])
    } else if (zone === 'out-drop' && source === 'mine') {
      if (!dropSlugs.find(p=>p.slug===slug) && !outSlugs.find(p=>p.slug===slug))
        setDropSlugs(prev=>[...prev,{slug,name}])
    }
    setDragging(null)
    resetSim()
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
                <td
                  className={`ra-player-name${p.slug && onSelectPlayer ? ' rank-player-link' : ''}`}
                  onClick={() => p.slug && onSelectPlayer && onSelectPlayer({ slug: p.slug, name: p.name })}
                >
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
            <div className="ra-trade-col-title ra-my-team-title">My Roster <span className="ra-col-sub">(drag or click: trade out → drop → clear)</span></div>
            {my_roster.filter(p=>p.br_slug).map((p,i) => {
              const inTrade = outSlugs.find(o=>o.slug===p.br_slug)
              const inDrop  = dropSlugs.find(o=>o.slug===p.br_slug)
              return (
                <div key={p.espn_name+i}
                     className={`ra-player-chip${inTrade?' ra-chip-out':inDrop?' ra-chip-drop':''}`}
                     draggable
                     onDragStart={() => setDragging({slug:p.br_slug, name:p.espn_name, source:'mine'})}
                     onDragEnd={() => setDragging(null)}
                     onClick={() => toggleOut(p.br_slug, p.espn_name)}>
                  {p.espn_name}
                </div>
              )
            })}
          </div>

          {/* Col 2: Movement summary */}
          <div className="ra-movement-summary">
            <div className={`ra-move-box${dragging?.source==='mine' ? ' ra-drop-active' : ''}`}
                 onDrop={() => onDrop('out-trade')} onDragOver={onDragOver}>
              <div className="ra-zone-label">OUT · Trade</div>
              {outSlugs.length === 0
                ? <span className="ra-zone-hint">Drag or click from My Roster</span>
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
            <div className={`ra-move-box${(dragging?.source==='theirs'||dragging?.source==='theirs2') ? ' ra-drop-active' : ''}`}
                 onDrop={() => onDrop('in-trade')} onDragOver={onDragOver}>
              <div className="ra-zone-label">IN · Trade</div>
              {getSlugs.length===0 && getSlugs2.length===0
                ? <span className="ra-zone-hint">Drag or click from partner roster</span>
                : [...getSlugs, ...getSlugs2].map(p => (
                    <div key={p.slug} className="ra-zone-chip">
                      {p.name}<button className="ra-chip-remove" onClick={()=>{setGetSlugs(prev=>prev.filter(g=>g.slug!==p.slug));setGetSlugs2(prev=>prev.filter(g=>g.slug!==p.slug));resetSim()}}>✕</button>
                    </div>
                  ))
              }
            </div>
            <div className={`ra-move-box${dragging?.source==='mine' ? ' ra-drop-active' : ''}`}
                 onDrop={() => onDrop('out-drop')} onDragOver={onDragOver}>
              <div className="ra-zone-label">OUT · Drop</div>
              {dropSlugs.length === 0
                ? <span className="ra-zone-hint">Drag or click (2nd click) from My Roster</span>
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
          slug: p.br_slug,
          stats: p.stats,
          isOut: outSet.has(p.br_slug),
          isNew: false,
        }))
        const afterRoster = [
          ...my_roster.filter(p=>!outSet.has(p.br_slug)).map(p=>({name:p.espn_name,slug:p.br_slug,stats:p.stats,isNew:false,isOut:false})),
          ...addedPlayers.map(a => {
            const fromTeam = [...(tradeTeam?.players||[]),...(tradeTeam2?.players||[])].find(p=>p.br_slug===a.slug)
            const fromFA   = freeAgents?.find(p=>p.br_slug===a.slug)
            return {name:a.name, slug:a.slug, stats:fromTeam?.stats||fromFA?.stats||null, isNew:true, isOut:false, from:a.from}
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
                const myTeam  = teams.find(t => t.is_my_team)
                const newCatZ = simResult.new_cat_z || {}
                const zCls  = z => z > 0.3 ? 'ra-z-pos' : z < -0.3 ? 'ra-z-neg' : ''
                const zFmt  = z => z == null ? '—' : (z > 0 ? '+' : '') + z.toFixed(2)
                return (
                  <table className="dash-table ra-table">
                    <thead>
                      <tr>
                        <th>Team</th>
                        <th>Win% Before</th>
                        <th>Win% After</th>
                        <th>H2H Before</th>
                        <th>H2H After</th>
                        {cats.map(c=><th key={c}>{c}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {myTeam && (
                        <tr className="fantasy-my-team">
                          <td className="ra-player-name">{myTeam.name} (after)</td>
                          <td>{winPct(myStandBefore)}</td>
                          <td>{winPct(myStandAfter)}</td>
                          <td>—</td>
                          <td>—</td>
                          {cats.map(cat => {
                            const z = newCatZ[cat]
                            return <td key={cat} className={zCls(z ?? 0)}>{zFmt(z)}</td>
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
                              const z = t.cat_z?.[cat]
                              return <td key={cat} className={zCls(z ?? 0)}>{zFmt(z)}</td>
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

            {/* Net Contribution to Winning */}
            {(simResult.ctw_before || simResult.ctw_after) && (() => {
              const ctwB = simResult.ctw_before || {}
              const ctwA = simResult.ctw_after  || {}
              const slugToName = {}
              my_roster.forEach(p => { if (p.br_slug) slugToName[p.br_slug] = p.espn_name })
              addedPlayers.forEach(p => { slugToName[p.slug] = p.name })
              const allSlugs = new Set([...Object.keys(ctwB), ...Object.keys(ctwA)])
              // net = Δ for stayers, after for added, -(before) for dropped (impact of losing them)
              const rows = [...allSlugs].map(slug => {
                const isAdded   = ctwB[slug] == null
                const isDropped = ctwA[slug] == null
                const bData = ctwB[slug]; const aData = ctwA[slug]
                const net = isAdded   ? (aData?.total ?? null)
                          : isDropped ? (bData?.total != null ? -bData.total : null)
                          : (aData?.total != null && bData?.total != null ? aData.total - bData.total : null)
                const catNet = cat => {
                  const bv = bData?.by_category?.[cat]?.net ?? null
                  const av = aData?.by_category?.[cat]?.net ?? null
                  if (isAdded)   return av
                  if (isDropped) return bv != null ? -bv : null
                  return (av != null && bv != null) ? av - bv : null
                }
                return { slug, name: slugToName[slug] || slug, net, catNet, isAdded, isDropped }
              }).sort((a, b) => Math.abs(b.net ?? 0) - Math.abs(a.net ?? 0))
              const fmtNet = v => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1)
              const fmtPct = v => v == null ? '—' : (v > 0 ? '+' : '') + Math.round(v * 100) + '%'
              const netCls = v => v == null ? '' : v >= 0.3 ? 'ra-z-pos' : v <= -0.3 ? 'ra-z-neg' : ''
              const pctCls = v => v == null ? '' : v >= 0.3 ? 'ra-z-pos' : v >= 0.08 ? 'ra-dw-pos-dim' : v > -0.08 ? '' : v > -0.3 ? 'ra-dw-neg-dim' : 'ra-z-neg'
              return (
                <div style={{marginTop:24}}>
                  <div className="ra-section-title">Net Contribution to Winning</div>
                  <div className="dash-card" style={{overflowX:'auto'}}>
                    <table className="dash-table ra-table">
                      <thead>
                        <tr>
                          <th>Player</th>
                          <th style={{textAlign:'center',whiteSpace:'nowrap'}}>Net CTW</th>
                          {cats.map(c => <th key={c} style={{textAlign:'center'}}>{c}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(r => (
                          <tr key={r.slug} className={r.isAdded ? 'ra-player-added' : r.isDropped ? 'ctw-row-out' : ''}>
                            <td
                              className={`ra-player-name${r.slug && onSelectPlayer ? ' rank-player-link' : ''}`}
                              onClick={() => r.slug && onSelectPlayer && onSelectPlayer({ slug: r.slug, name: r.name })}
                            >
                              {r.name}
                              {r.isAdded   && <span className="ctw-tag ctw-tag-in">IN</span>}
                              {r.isDropped && <span className="ctw-tag ctw-tag-out">OUT</span>}
                            </td>
                            <td style={{textAlign:'center'}} className={netCls(r.net)}>
                              <strong>{fmtNet(r.net)}</strong>
                            </td>
                            {cats.map(cat => {
                              const v = r.catNet(cat)
                              return (
                                <td key={cat} style={{textAlign:'center',fontFamily:'var(--mono)',fontSize:12}}
                                    className={pctCls(v)}>
                                  {fmtPct(v)}
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

// ── MatchupProjection ──────────────────────────────────────────────────────────

const TEAM_ABBREV = {
  'ATLANTA HAWKS':'ATL','BOSTON CELTICS':'BOS','BROOKLYN NETS':'BKN',
  'CHARLOTTE HORNETS':'CHA','CHICAGO BULLS':'CHI','CLEVELAND CAVALIERS':'CLE',
  'DALLAS MAVERICKS':'DAL','DENVER NUGGETS':'DEN','DETROIT PISTONS':'DET',
  'GOLDEN STATE WARRIORS':'GSW','HOUSTON ROCKETS':'HOU','INDIANA PACERS':'IND',
  'LOS ANGELES CLIPPERS':'LAC','LOS ANGELES LAKERS':'LAL','MEMPHIS GRIZZLIES':'MEM',
  'MIAMI HEAT':'MIA','MILWAUKEE BUCKS':'MIL','MINNESOTA TIMBERWOLVES':'MIN',
  'NEW ORLEANS PELICANS':'NOP','NEW YORK KNICKS':'NYK','OKLAHOMA CITY THUNDER':'OKC',
  'ORLANDO MAGIC':'ORL','PHILADELPHIA 76ERS':'PHI','PHOENIX SUNS':'PHO',
  'PORTLAND TRAIL BLAZERS':'POR','SACRAMENTO KINGS':'SAC','SAN ANTONIO SPURS':'SAS',
  'TORONTO RAPTORS':'TOR','UTAH JAZZ':'UTA','WASHINGTON WIZARDS':'WAS',
}

function MatchupProjection({ onSelectPlayer }) {
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [week,       setWeek]       = useState(null)
  const [freeAgents, setFreeAgents] = useState([])
  const [faLoading,  setFaLoading]  = useState(false)
  // Transaction planner state
  const [transactions,  setTransactions]  = useState([])  // [{id, day_idx, add_slug, add_name, drop_slug, searchQ, searchRes}]
  const [acqLimit,      setAcqLimit]      = useState(-1)  // -1 = unknown/unlimited; user-editable
  const [acqUsed,       setAcqUsed]       = useState(0)
  const [planLoading,   setPlanLoading]   = useState(false)
  const [planData,      setPlanData]      = useState(null)
  const [asOfDate,      setAsOfDate]      = useState(null)
  const [selectedDays,  setSelectedDays]  = useState(new Set())
  const [faSortKey,     setFaSortKey]     = useState('value')

  function load(w, aod) {
    setLoading(true); setError(null); setPlanData(null)
    const params = new URLSearchParams()
    if (w)   params.set('week', w)
    if (aod) params.set('as_of_date', aod)
    const url = `/api/fantasy/espn/matchup-projection${params.size ? `?${params}` : ''}`
    apiFetch(url)
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.detail || r.statusText)))
      .then(d => { setData(d); setWeek(d.week); if ((d.acq_limit ?? -1) !== -1) setAcqLimit(d.acq_limit); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }

  useEffect(() => {
    load(null, null)
    setFaLoading(true)
    apiFetch('/api/fantasy/espn/free-agents')
      .then(r => r.ok ? r.json() : null)
      .then(d => setFreeAgents(d?.free_agents || []))
      .catch(() => {})
      .finally(() => setFaLoading(false))
  }, [])

  // ── Transaction planner helpers ──────────────────────────────────────────
  function addTransaction() {
    const firstFutureIdx = (data?.day_labels || []).findIndex((_, i) => {
      if (!data?.week_start) return i === 0
      const d0 = new Date(data.week_start + 'T12:00:00')
      d0.setDate(d0.getDate() + i)
      return d0.toISOString().slice(0, 10) > (asOfDate || data?.as_of_date || '')
    })
    setTransactions(prev => [...prev, {
      id: Date.now() + Math.random(),
      day_idx:  Math.max(0, firstFutureIdx >= 0 ? firstFutureIdx : 0),
      add_slug: null, add_name: '',
      drop_slug: null,
      searchQ: '', searchRes: [],
    }])
  }

  function removeTxn(id) {
    setTransactions(prev => prev.filter(t => t.id !== id))
    setPlanData(null)
  }

  function updateTxn(id, key, val) {
    setTransactions(prev => prev.map(t => t.id === id ? {...t, [key]: val} : t))
  }

  function searchForTxn(id, q) {
    updateTxn(id, 'searchQ', q)
    if (!q || q.length < 2) { updateTxn(id, 'searchRes', []); return }
    apiFetch(`/api/fantasy/espn/roster-analysis/search-player?q=${encodeURIComponent(q)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => updateTxn(id, 'searchRes', d?.players || []))
      .catch(() => {})
  }

  function clearPlan() {
    setTransactions([]); setPlanData(null); setAcqUsed(0); setSelectedDays(new Set())
  }

  function runPlan() {
    const valid = transactions.filter(t => t.add_slug || t.drop_slug)
    if (!valid.length) return
    setPlanLoading(true); setPlanData(null)
    apiFetch('/api/fantasy/espn/matchup-projection/plan', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        week,
        as_of_date: asOfDate || data?.as_of_date,
        transactions: valid.map(t => ({
          day_idx:  t.day_idx,
          add_slug: t.add_slug  || null,
          drop_slug: t.drop_slug || null,
        })),
      }),
    })
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.detail)))
      .then(d => setPlanData(d))
      .catch(e => alert(`Plan failed: ${e}`))
      .finally(() => setPlanLoading(false))
  }

  if (loading) return <div className="dash-empty">Loading matchup projection…</div>
  if (error)   return <div className="login-error" style={{margin:24}}>{error}</div>
  if (!data)   return <div className="dash-empty">No data.</div>

  const d = data

  // Outcome probability distribution via DP on per-category win probs
  function outcomeDistribution(categories) {
    const n = categories.length
    let dp = new Array(n + 1).fill(0); dp[0] = 1
    for (const c of categories) {
      const wp = c.win_prob
      const next = new Array(n + 1).fill(0)
      for (let w = 0; w <= n; w++) {
        if (!dp[w]) continue
        next[w + 1] += dp[w] * wp
        next[w]     += dp[w] * (1 - wp)
      }
      dp = next
    }
    return dp.map((prob, wins) => ({ wins, losses: n - wins, prob }))
  }

  function WinProbBadge({ wp }) {
    const pct = Math.round(wp * 100)
    const cls  = pct >= 55 ? 'mp-wp-win' : pct <= 45 ? 'mp-wp-loss' : 'mp-wp-toss'
    return <span className={`mp-wp-badge ${cls}`}>{pct}%</span>
  }

  function DayCoverageBar({ players, label }) {
    const cap     = d.active_capacity || 0
    const pastIdx = d.past_end_idx ?? -1
    const totals  = d.day_labels.map((_, i) => ({
      slotted: players.filter(p => p.days?.[i] === 'slotted').length,
      playing: players.filter(p => p.days?.[i] != null).length,
    }))
    return (
      <div className="tp-coverage">
        {label && <div className="tp-coverage-label">{label}</div>}
        <div className="tp-coverage-days">
          {d.day_labels.map((lbl, i) => {
            const { slotted, playing } = totals[i]
            const n    = cap > 0 ? slotted : playing
            const pct  = cap > 0 ? n / cap : 0
            const past = i <= pastIdx
            const cls  = past ? 'tp-day-past' : pct >= 0.85 ? 'tp-day-full' : pct >= 0.5 ? 'tp-day-mid' : playing > 0 ? 'tp-day-low' : 'tp-day-zero'
            return (
              <div key={i} className={`tp-day-cell${past ? ' tp-day-cell-past' : ''}`}>
                <div className="tp-day-lbl">{lbl}</div>
                <div className={`tp-day-n ${cls}`}>{playing > 0 ? (cap > 0 ? `${n}/${cap}` : n) : '—'}</div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function DayGrid({ players, label, isMyTeam }) {
    const activeCapacity = d.active_capacity || 0
    const pastEndIdx     = d.past_end_idx ?? -1  // index of last past day (-1 = all projected)
    const totalEffGP = players.reduce((s, p) => s + (p.effective_games ?? p.games), 0)
    // dayTotals = count of players with a game (slotted or benched) per day
    const dayTotals  = d.day_labels.map((_, i) => players.filter(p => p.days[i] != null).length)
    return (
      <div className="mp-grid-section">
        <div className="mp-grid-label">
          {label} <span className="mp-grid-gp-total">({totalEffGP.toFixed(1)} eff. GP{activeCapacity ? ` · ${activeCapacity} slots` : ''})</span>
        </div>
        <div className="mp-grid-scroll">
          <table className="mp-grid-table">
            <thead>
              <tr>
                <th className="mp-col-player">Player</th>
                <th className="mp-col-team">Tm</th>
                <th className="mp-col-gp">GP</th>
                {d.day_labels.map((lbl, i) => (
                  <th key={i} className={`mp-col-day${i === pastEndIdx ? ' mp-col-past-last' : i <= pastEndIdx ? ' mp-col-past' : ''}`}>{lbl}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {players.map(p => (
                <tr key={p.slug || p.name} className={isMyTeam && plannedDropSlugs.has(p.slug || p.name) ? 'mp-row-drop' : ''}>
                  <td className="mp-col-player">
                    {p.slug
                      ? <button className="mp-player-link" onClick={() => onSelectPlayer?.(p.slug)}>{p.name}</button>
                      : p.name
                    }
                  </td>
                  <td className="mp-col-team">{TEAM_ABBREV[p.nba_team] || p.nba_team?.slice(0,3) || '—'}</td>
                  <td className={`mp-col-gp mp-gp-${p.games}`}>{p.games}</td>
                  {p.days.map((status, i) => (
                    <td key={i} className={`mp-col-day${status ? (status === 'benched' ? ' mp-benched' : ' mp-plays') : ' mp-off'}${i <= pastEndIdx ? ' mp-day-past' : ''}${i === pastEndIdx ? ' mp-col-past-last' : ''}`}>
                      {status ? '●' : ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="mp-totals-row">
                <td className="mp-col-player mp-totals-label">Games/day</td>
                <td className="mp-col-team"></td>
                <td className="mp-col-gp">{players.reduce((s, p) => s + p.games, 0)}</td>
                {dayTotals.map((n, i) => {
                  const overbooked = activeCapacity > 0 && n > activeCapacity
                  // Show slotted count when capacity is active
                  const slottedN = activeCapacity > 0 ? players.filter(p => p.days[i] === 'slotted').length : n
                  return (
                    <td key={i} className={`mp-col-day mp-day-total${n > 0 ? ' mp-day-total-has' : ''}${overbooked ? ' mp-day-overbooked' : ''}${i <= pastEndIdx ? ' mp-day-past' : ''}${i === pastEndIdx ? ' mp-col-past-last' : ''}`}>
                      {n > 0 ? (overbooked ? `${n}↑` : slottedN) : ''}
                    </td>
                  )
                })}
              </tr>
              {activeCapacity > 0 && (
                <tr className="mp-slots-row">
                  <td className="mp-col-player mp-totals-label">Slots avail.</td>
                  <td className="mp-col-team"></td>
                  <td className="mp-col-gp">{activeCapacity}</td>
                  {dayTotals.map((n, i) => (
                    <td key={i} className={`mp-col-day mp-slot-cap${i <= pastEndIdx ? ' mp-day-past' : ''}${i === pastEndIdx ? ' mp-col-past-last' : ''}`}>
                      {n > 0 ? Math.min(n, activeCapacity) : ''}
                    </td>
                  ))}
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      </div>
    )
  }

  const overallPct = Math.round(d.overall_win_prob * 100)
  const overallCls = overallPct >= 55 ? 'mp-overall-win' : overallPct <= 45 ? 'mp-overall-loss' : 'mp-overall-toss'
  const outcomes   = outcomeDistribution(d.categories)
  const maxOutcomeProb = Math.max(...outcomes.map(o => o.prob))

  // Planned drops + adds (for roster highlighting)
  const plannedDropSlugs = new Set(transactions.map(t => t.drop_slug).filter(Boolean)) // contains slug OR name for null-slug players
  const plannedAddSlugs  = new Set(transactions.map(t => t.add_slug).filter(Boolean))

  // Rostered slugs (for filtering free agents not on either roster)
  const rosteredSlugs = new Set([
    ...d.my_players.map(p => p.slug),
    ...d.opp_players.map(p => p.slug),
  ])
  const teamWeekGames = d.team_week_games || {}
  const gamesByDay    = data.games_by_day || {}

  const dayPills = (data.day_labels || []).map((lbl, i) => {
    if (!data.week_start) return null
    const d0 = new Date(data.week_start + 'T12:00:00')
    d0.setDate(d0.getDate() + i)
    return { iso: d0.toISOString().slice(0, 10), label: lbl }
  }).filter(Boolean)

  function faPlaysOnDay(fa, iso) {
    return (gamesByDay[iso] || []).includes(fa.nba_team)
  }

  function faCumGames(fa) {
    if (!selectedDays.size) return teamWeekGames[fa.nba_team] || 0
    let n = 0
    for (const iso of selectedDays) {
      if (faPlaysOnDay(fa, iso)) n++
    }
    return n
  }

  function faCumStat(fa, key) {
    const s = fa.stats || {}
    const v = s[key] ?? null
    if (v == null) return null
    if (key === 'fg_pct' || key === 'ft_pct') return v
    return selectedDays.size ? +(v * faCumGames(fa)).toFixed(1) : v
  }

  function faSortVal(fa) {
    if (faSortKey === 'value') return fa.value || 0
    const s = fa.stats || {}
    if (faSortKey === 'fg_pct' || faSortKey === 'ft_pct') return s[faSortKey] ?? 0
    const v = s[faSortKey] ?? 0
    const cum = selectedDays.size ? v * faCumGames(fa) : v
    return faSortKey === 'tov' ? -cum : cum
  }

  const filteredFreeAgents = freeAgents
    .filter(fa => fa.br_slug && fa.stats && (!selectedDays.size || faCumGames(fa) > 0))
    .sort((a, b) => faSortVal(b) - faSortVal(a))
    .slice(0, 25)

  return (
    <div className="mp-wrap">
      {/* Header + week selector */}
      <div className="mp-header">
        <div className="mp-matchup-title">
          <span className="mp-team-name mp-my-team">{d.my_team_name}</span>
          <span className={`mp-overall-badge ${overallCls}`}>{d.cat_wins}–{d.cat_total - d.cat_wins} ({overallPct}%)</span>
          <span className="mp-team-name mp-opp-team">{d.opp_team_name}</span>
        </div>
        <div className="mp-controls-row">
          <select
            className="mp-week-select"
            value={week || ''}
            onChange={e => { const w = Number(e.target.value); setWeek(w); setAsOfDate(null); load(w, null); clearPlan() }}
          >
            {data.all_weeks.map(w => (
              <option key={w.week} value={w.week}>Week {w.week}: {w.label}</option>
            ))}
          </select>
          <div className="mp-asof-row">
            <span className="mp-asof-label">Results through:</span>
            {data.day_labels.map((lbl, i) => {
              const dayIso = data.week_start ? (() => {
                const d0 = new Date(data.week_start + 'T12:00:00')
                d0.setDate(d0.getDate() + i)
                return d0.toISOString().slice(0, 10)
              })() : null
              const active = dayIso === (asOfDate || data.as_of_date)
              return (
                <button
                  key={i}
                  className={`mp-asof-btn${active ? ' mp-asof-active' : ''}`}
                  onClick={() => { setAsOfDate(dayIso); load(week, dayIso); clearPlan() }}
                >{lbl}</button>
              )
            })}
            {(asOfDate && asOfDate !== data.as_of_date) || true ? null : null}
          </div>
        </div>
      </div>

      {/* Category projections + outcome distribution side by side */}
      <div className="mp-cats-outcome-row">
        <div className="mp-cats-section">
          <table className="mp-cats-table">
            <thead>
              <tr>
                <th>Cat</th>
                <th className="mp-cat-my">My Team</th>
                <th className="mp-cat-range mp-cat-my">Range</th>
                <th className="mp-cat-opp">Opp Team</th>
                <th className="mp-cat-range mp-cat-opp">Range</th>
                <th>Win%</th>
              </tr>
            </thead>
            <tbody>
              {d.categories.map(c => {
                const wp  = c.win_prob
                const cls = wp >= 0.55 ? 'mp-cat-winning' : wp <= 0.45 ? 'mp-cat-losing' : 'mp-cat-toss'
                const r   = v => v != null ? Math.round(v) : '—'
                return (
                  <tr key={c.stat} className={cls}>
                    <td className="mp-cat-name">{c.stat}</td>
                    <td className="mp-cat-proj mp-cat-my">{r(c.my_proj)}</td>
                    <td className="mp-cat-range mp-cat-my">{r(c.my_lo)}–{r(c.my_hi)}</td>
                    <td className="mp-cat-proj mp-cat-opp">{r(c.opp_proj)}</td>
                    <td className="mp-cat-range mp-cat-opp">{r(c.opp_lo)}–{r(c.opp_hi)}</td>
                    <td><WinProbBadge wp={wp} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Outcome distribution */}
        <div className="mp-outcome-section">
          <div className="mp-grid-label">Result Distribution</div>
          <div className="mp-outcomes">
            {outcomes.slice().reverse().map(o => {
              const pct    = Math.round(o.prob * 100)
              const barW   = maxOutcomeProb > 0 ? (o.prob / maxOutcomeProb) * 100 : 0
              const isProj = o.wins === d.cat_wins
              const cls    = o.wins > o.losses ? 'mp-out-win' : o.wins < o.losses ? 'mp-out-loss' : 'mp-out-toss'
              return (
                <div key={o.wins} className={`mp-outcome-row${isProj ? ' mp-out-projected' : ''}`}>
                  <span className={`mp-out-label ${cls}`}>{o.wins}–{o.losses}</span>
                  <div className="mp-out-bar-wrap">
                    <div className={`mp-out-bar ${cls}`} style={{width:`${barW}%`}} />
                  </div>
                  <span className="mp-out-pct">{pct > 0 ? `${pct}%` : '<1%'}</span>
                  {isProj && <span className="mp-out-proj-tag">proj</span>}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Day grids side by side */}
      <div className="mp-grids-row">
        <div className="mp-grid-col">
          <DayGrid players={d.my_players}  label="My Roster"       isMyTeam={true}  />
        </div>
        <div className="mp-grid-col">
          <DayGrid players={d.opp_players} label="Opponent Roster"  isMyTeam={false} />
        </div>
      </div>

      {/* Day coverage summary */}
      <DayCoverageBar players={d.my_players} label={planData ? 'Current lineup — players per day' : null} />
      {planData && <DayCoverageBar players={planData.my_players} label="After plan — players per day" />}

      {/* Transaction Planner */}
      <div className="mp-sim-section">
        <div className="tp-header-row">
          <div className="mp-sim-title">Transaction Planner</div>
          {(() => {
            const planned = transactions.filter(t => t.add_slug).length
            const total   = acqUsed + planned
            const over    = acqLimit > 0 && total > acqLimit
            return (
              <div className="tp-budget">
                <label className="tp-used-label">
                  Weekly limit:
                  <input
                    type="number" min="0"
                    className="tp-used-input"
                    value={acqLimit === -1 ? '' : acqLimit}
                    placeholder="—"
                    onChange={e => setAcqLimit(e.target.value ? Number(e.target.value) : -1)}
                  />
                </label>
                {acqLimit > 0 && <>
                  <span className="tp-budget-sep">·</span>
                  <span className={`tp-budget-count${over ? ' tp-over' : ''}`}>{total}/{acqLimit}</span>
                  <span className="tp-budget-label"> used</span>
                  {over && <span className="tp-over-warn"> — over limit</span>}
                </>}
                <span className="tp-budget-sep">·</span>
                <label className="tp-used-label">
                  Already used:
                  <input
                    type="number" min="0"
                    className="tp-used-input"
                    value={acqUsed}
                    onChange={e => setAcqUsed(Math.max(0, Number(e.target.value)))}
                  />
                </label>
              </div>
            )
          })()}
        </div>

        {/* Transaction rows */}
        <div className="tp-rows">
          {transactions.map((txn, idx) => (
            <div key={txn.id} className="tp-row">
              <span className="tp-row-num">#{idx + 1}</span>

              {/* Day picker */}
              <div className="tp-field">
                <label className="mp-sim-label">Pick up on</label>
                <select
                  className="mp-sim-select tp-day-select"
                  value={txn.day_idx}
                  onChange={e => { updateTxn(txn.id, 'day_idx', Number(e.target.value)); setPlanData(null) }}
                >
                  {data.day_labels.map((lbl, i) => (
                    <option key={i} value={i}>{lbl}</option>
                  ))}
                </select>
              </div>

              {/* Add player */}
              <div className="tp-field tp-add-field">
                <label className="mp-sim-label">Add</label>
                {txn.add_slug
                  ? <span className="mp-chip mp-chip-add tp-chip">
                      + {txn.add_name}
                      <button onClick={() => { updateTxn(txn.id, 'add_slug', null); updateTxn(txn.id, 'add_name', ''); updateTxn(txn.id, 'searchQ', ''); updateTxn(txn.id, 'searchRes', []); setPlanData(null) }}>×</button>
                    </span>
                  : <>
                      <input
                        className="mp-sim-input"
                        placeholder="Search player…"
                        value={txn.searchQ}
                        onChange={e => searchForTxn(txn.id, e.target.value)}
                      />
                      {txn.searchRes.length > 0 && (
                        <div className="mp-search-results tp-search-results">
                          {txn.searchRes.slice(0, 6).map(p => {
                            const gp = teamWeekGames[p.team] || 0
                            return (
                              <div key={p.slug} className="mp-search-row"
                                onClick={() => {
                                  updateTxn(txn.id, 'add_slug',  p.slug)
                                  updateTxn(txn.id, 'add_name',  p.full_name)
                                  updateTxn(txn.id, 'searchQ',   '')
                                  updateTxn(txn.id, 'searchRes', [])
                                  setPlanData(null)
                                }}>
                                <span className="mp-sr-name">{p.full_name}</span>
                                <span className="mp-sr-team">{TEAM_ABBREV[p.team] || p.team?.slice(0,3) || '?'}</span>
                                <span className={`mp-sr-gp mp-gp-${gp}`}>{gp} GP</span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </>
                }
              </div>

              {/* Drop player */}
              <div className="tp-field">
                <label className="mp-sim-label">Drop</label>
                <select
                  className="mp-sim-select"
                  value={txn.drop_slug || ''}
                  onChange={e => { updateTxn(txn.id, 'drop_slug', e.target.value || null); setPlanData(null) }}
                >
                  <option value=''>— optional —</option>
                  {[
                    ...d.my_players.map(p => ({ dropId: p.slug || p.name, name: p.name, label: `${p.name} (${p.games} GP)` })),
                    ...transactions
                      .filter(t => t.id !== txn.id && t.add_slug)
                      .map(t => ({ dropId: t.add_slug, name: t.add_name, label: `${t.add_name} (pickup)` })),
                  ]
                    .filter((p, i, arr) => arr.findIndex(x => x.dropId === p.dropId) === i) // dedupe
                    .filter(p => !plannedDropSlugs.has(p.dropId) || txn.drop_slug === p.dropId)
                    .map(p => (
                      <option key={p.dropId} value={p.dropId}>{p.label}</option>
                    ))
                  }
                </select>
              </div>

              <button className="tp-remove-btn" onClick={() => removeTxn(txn.id)} title="Remove">×</button>
            </div>
          ))}
        </div>

        {/* Action bar */}
        <div className="tp-actions">
          <button className="tp-add-btn" onClick={addTransaction}>+ Add transaction</button>
          {transactions.length > 0 && (
            <>
              <button
                className="mp-sim-run"
                onClick={runPlan}
                disabled={planLoading || !transactions.some(t => t.add_slug || t.drop_slug)}
              >
                {planLoading ? 'Simulating…' : 'Simulate plan'}
              </button>
              <button className="mp-sim-clear" onClick={clearPlan}>Clear all</button>
            </>
          )}
        </div>

        {/* Plan result */}
        {planData && (
          <div className="mp-sim-result">
            <div className="mp-sim-result-title">
              Planned: {planData.my_team_name}
              <span className={`mp-overall-badge mp-sim-badge ${Math.round(planData.overall_win_prob*100)>=55?'mp-overall-win':Math.round(planData.overall_win_prob*100)<=45?'mp-overall-loss':'mp-overall-toss'}`}>
                {planData.cat_wins}–{planData.cat_total - planData.cat_wins} ({Math.round(planData.overall_win_prob*100)}%)
              </span>
            </div>
            <div className="mp-sim-body">
              <table className="mp-cats-table mp-sim-cats-table">
                <thead>
                  <tr><th>Cat</th><th className="mp-cat-my">Before</th><th className="mp-cat-my">After</th><th>Δ</th><th>Win%</th><th>ΔWin%</th></tr>
                </thead>
                <tbody>
                  {planData.categories.map((c, i) => {
                    const before  = data.categories[i]
                    const delta   = Math.round(c.my_proj) - Math.round(before?.my_proj || 0)
                    const neg     = c.neg
                    const better  = neg ? delta < 0 : delta > 0
                    const worse   = neg ? delta > 0 : delta < 0
                    const wpDelta = Math.round((c.win_prob - (before?.win_prob ?? 0.5)) * 100)
                    return (
                      <tr key={c.stat} className={c.win_prob>=0.55?'mp-cat-winning':c.win_prob<=0.45?'mp-cat-losing':'mp-cat-toss'}>
                        <td className="mp-cat-name">{c.stat}</td>
                        <td className="mp-cat-my">{Math.round(before?.my_proj ?? 0)}</td>
                        <td className="mp-cat-my">{Math.round(c.my_proj)}</td>
                        <td className={better?'mp-delta-pos':worse?'mp-delta-neg':''}>{delta > 0 ? `+${delta}` : delta === 0 ? '—' : delta}</td>
                        <td><WinProbBadge wp={c.win_prob} /></td>
                        <td className={wpDelta > 0 ? 'mp-delta-pos' : wpDelta < 0 ? 'mp-delta-neg' : 'mp-delta-flat'}>
                          {wpDelta > 0 ? `+${wpDelta}%` : wpDelta < 0 ? `${wpDelta}%` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {(() => {
                const planOutcomes = outcomeDistribution(planData.categories)
                const planMaxProb  = Math.max(...planOutcomes.map(o => o.prob))
                const realByWins   = Object.fromEntries(outcomes.map(o => [o.wins, o.prob]))
                const overallDelta = Math.round(planData.overall_win_prob * 100) - Math.round(data.overall_win_prob * 100)
                return (
                  <div className="mp-outcome-section mp-sim-outcome">
                    <div className="mp-sim-outcome-header">
                      <div className="mp-grid-label">Projected Result Distribution</div>
                      <div className={`mp-sim-overall-delta ${overallDelta > 0 ? 'mp-delta-pos' : overallDelta < 0 ? 'mp-delta-neg' : 'mp-delta-flat'}`}>
                        {overallDelta > 0 ? `▲ +${overallDelta}%` : overallDelta < 0 ? `▼ ${overallDelta}%` : '—'}
                        <span className="mp-sim-overall-delta-label">win prob</span>
                      </div>
                    </div>
                    <div className="mp-outcomes">
                      {planOutcomes.slice().reverse().map(o => {
                        const pct      = Math.round(o.prob * 100)
                        const barW     = planMaxProb > 0 ? (o.prob / planMaxProb) * 100 : 0
                        const isProj   = o.wins === planData.cat_wins
                        const cls      = o.wins > o.losses ? 'mp-out-win' : o.wins < o.losses ? 'mp-out-loss' : 'mp-out-toss'
                        const rowDelta = Math.round((o.prob - (realByWins[o.wins] ?? 0)) * 100)
                        return (
                          <div key={o.wins} className={`mp-outcome-row${isProj ? ' mp-out-projected' : ''}`}>
                            <span className={`mp-out-label ${cls}`}>{o.wins}–{o.losses}</span>
                            <div className="mp-out-bar-wrap">
                              <div className={`mp-out-bar ${cls}`} style={{width:`${barW}%`}} />
                            </div>
                            <span className="mp-out-pct">{pct > 0 ? `${pct}%` : '<1%'}</span>
                            {rowDelta !== 0
                              ? <span className={`mp-out-row-delta ${rowDelta > 0 ? 'mp-delta-pos' : 'mp-delta-neg'}`}>
                                  {rowDelta > 0 ? `+${rowDelta}` : rowDelta}
                                </span>
                              : isProj && <span className="mp-out-proj-tag">proj</span>
                            }
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        )}

        {/* Top free agents */}
        <div className="mp-fa-section">
          <div className="mp-fa-section-header">
            <div className="mp-grid-label">
              Top Available Free Agents
              {selectedDays.size > 0 && <span className="mp-fa-day-mode"> · {selectedDays.size} day{selectedDays.size > 1 ? 's' : ''} selected — cumulative</span>}
            </div>
            {selectedDays.size > 0 && (
              <button className="mp-day-pill-clear" onClick={() => setSelectedDays(new Set())}>Clear filter</button>
            )}
          </div>
          {faLoading
            ? <div className="dash-empty" style={{padding:'12px 0'}}>Loading…</div>
            : filteredFreeAgents.length === 0
              ? <div className="mp-sim-hint">{selectedDays.size > 0 ? 'No free agents play on selected days.' : 'No free agent data.'}</div>
              : (
                <div className="mp-fa-list">
                  <div className="mp-fa-header-row">
                    <span className="mp-fa-name">Player</span>
                    <span className="mp-fa-team">Tm</span>
                    {dayPills.map(({ iso, label }) => (
                      <span
                        key={iso}
                        className={`mp-fa-day-col mp-fa-sort-hdr${selectedDays.has(iso) ? ' mp-fa-day-col-active' : ''}`}
                        title={`Filter to ${label}`}
                        onClick={() => {
                          const next = new Set(selectedDays)
                          next.has(iso) ? next.delete(iso) : next.add(iso)
                          setSelectedDays(next)
                        }}
                      >{label}</span>
                    ))}
                    {[
                      { key: 'pts',    label: 'PTS' },
                      { key: 'reb',    label: 'REB' },
                      { key: 'ast',    label: 'AST' },
                      { key: 'stl',    label: 'STL' },
                      { key: 'blk',    label: 'BLK' },
                      { key: 'tov',    label: 'TO'  },
                      { key: 'fg3m',   label: '3PM' },
                      { key: 'fg_pct', label: 'FG%' },
                      { key: 'ft_pct', label: 'FT%' },
                    ].map(({ key, label }) => (
                      <span
                        key={key}
                        className={`mp-fa-stat mp-fa-sort-hdr${faSortKey === key ? ' mp-fa-sort-active' : ''}`}
                        onClick={() => setFaSortKey(key)}
                      >{label}</span>
                    ))}
                    <span
                      className={`mp-fa-val mp-fa-sort-hdr${faSortKey === 'value' ? ' mp-fa-sort-active' : ''}`}
                      onClick={() => setFaSortKey('value')}
                    >Val</span>
                  </div>
                  {filteredFreeAgents.map(fa => {
                    const cumG  = faCumGames(fa)
                    const tm    = TEAM_ABBREV[fa.nba_team] || fa.nba_team?.slice(0,3) || '?'
                    const isAdd = plannedAddSlugs.has(fa.br_slug)
                    const fmt   = v => v != null ? v : '—'
                    return (
                      <div
                        key={fa.br_slug}
                        className={`mp-fa-row${isAdd ? ' mp-fa-selected' : ''}`}
                        onClick={() => {
                          // Fill first empty add slot, or add new transaction
                          const emptyTxn = transactions.find(t => !t.add_slug)
                          if (emptyTxn) {
                            updateTxn(emptyTxn.id, 'add_slug', fa.br_slug)
                            updateTxn(emptyTxn.id, 'add_name', fa.espn_name)
                          } else {
                            const firstFutureIdx = (data?.day_labels || []).findIndex((_, i) => {
                              if (!data?.week_start) return i === 0
                              const d0 = new Date(data.week_start + 'T12:00:00')
                              d0.setDate(d0.getDate() + i)
                              return d0.toISOString().slice(0, 10) > (asOfDate || data?.as_of_date || '')
                            })
                            setTransactions(prev => [...prev, {
                              id: Date.now() + Math.random(),
                              day_idx:  Math.max(0, firstFutureIdx >= 0 ? firstFutureIdx : 0),
                              add_slug: fa.br_slug, add_name: fa.espn_name,
                              drop_slug: null, searchQ: '', searchRes: [],
                            }])
                          }
                          setPlanData(null)
                        }}
                      >
                        <span className="mp-fa-name">{fa.espn_name}</span>
                        <span className="mp-fa-team">{tm}</span>
                        {dayPills.map(({ iso }) => {
                          const plays = faPlaysOnDay(fa, iso)
                          const sel   = selectedDays.has(iso)
                          return (
                            <span key={iso} className={`mp-fa-day-col${sel ? ' mp-fa-day-col-active' : ''}`}>
                              {plays && <span className="mp-fa-day-dot" style={{color: sel ? 'var(--accent)' : 'var(--skill)'}}>●</span>}
                            </span>
                          )
                        })}
                        <span className={`mp-fa-stat${faSortKey==='pts'    ?' mp-fa-sort-active':''}`}>{fmt(faCumStat(fa,'pts'))}</span>
                        <span className={`mp-fa-stat${faSortKey==='reb'    ?' mp-fa-sort-active':''}`}>{fmt(faCumStat(fa,'reb'))}</span>
                        <span className={`mp-fa-stat${faSortKey==='ast'    ?' mp-fa-sort-active':''}`}>{fmt(faCumStat(fa,'ast'))}</span>
                        <span className={`mp-fa-stat${faSortKey==='stl'    ?' mp-fa-sort-active':''}`}>{fmt(faCumStat(fa,'stl'))}</span>
                        <span className={`mp-fa-stat${faSortKey==='blk'    ?' mp-fa-sort-active':''}`}>{fmt(faCumStat(fa,'blk'))}</span>
                        <span className={`mp-fa-stat${faSortKey==='tov'    ?' mp-fa-sort-active':''}`}>{fmt(faCumStat(fa,'tov'))}</span>
                        <span className={`mp-fa-stat${faSortKey==='fg3m'   ?' mp-fa-sort-active':''}`}>{fmt(faCumStat(fa,'fg3m'))}</span>
                        <span className={`mp-fa-stat${faSortKey==='fg_pct' ?' mp-fa-sort-active':''}`}>{fmt(faCumStat(fa,'fg_pct'))}</span>
                        <span className={`mp-fa-stat${faSortKey==='ft_pct' ?' mp-fa-sort-active':''}`}>{fmt(faCumStat(fa,'ft_pct'))}</span>
                        <span className={`mp-fa-val${faSortKey==='value'   ?' mp-fa-sort-active':''}`}>{fa.value}</span>
                      </div>
                    )
                  })}
                </div>
              )
          }
        </div>
      </div>
    </div>
  )
}


// ── WeeklySchedulePage ─────────────────────────────────────────────────────────

function WeeklySchedulePage() {
  const [meta,        setMeta]        = useState(null)
  const [metaLoading, setMetaLoading] = useState(true)
  const [selectedIdx, setSelectedIdx] = useState(null)
  const [gameData,    setGameData]    = useState(null)
  const [gameLoading, setGameLoading] = useState(false)
  const [myTeams,     setMyTeams]     = useState([])   // NBA teams with my fantasy players

  useEffect(() => {
    apiFetch('/api/schedule/weeks')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setMeta(d)
          const today = new Date().toISOString().slice(0, 10)
          let idx = d.weeks.findIndex(w => w.end >= today)
          if (idx === -1) idx = d.weeks.length - 1
          setSelectedIdx(idx)
        }
        setMetaLoading(false)
      })
      .catch(() => setMetaLoading(false))

    // Best-effort: get my roster's NBA teams from lightweight endpoint
    apiFetch('/api/fantasy/my-nba-teams')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.teams?.length) setMyTeams(d.teams) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!meta || selectedIdx === null) return
    const w = meta.weeks[selectedIdx]
    setGameData(null)
    setGameLoading(true)
    apiFetch(`/api/fantasy/week-detail?start=${w.start}&end=${w.end}`)
      .then(r => r.ok ? r.json() : {})
      .then(d => { setGameData(d); setGameLoading(false) })
      .catch(() => setGameLoading(false))
  }, [meta, selectedIdx])

  if (metaLoading) return <div className="dash-empty">Loading schedule…</div>
  if (!meta) return <div className="dash-empty">Schedule data unavailable.</div>

  const { weeks, all_teams, pts_allowed_map } = meta
  const week = weeks[selectedIdx] || weeks[0]
  const myTeamSet = new Set(myTeams)

  const days = []
  if (week) {
    for (let d = new Date(week.start + 'T00:00:00'); d <= new Date(week.end + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
      days.push(new Date(d))
    }
  }
  const fmt = d => d.toISOString().slice(0, 10)
  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

  const weekEaseVals = all_teams.flatMap(team =>
    days.map(d => { const g = gameData?.[team]?.[fmt(d)]; return g ? pts_allowed_map?.[g.opp] : null }).filter(v => v != null)
  )
  const minEase = weekEaseVals.length ? Math.min(...weekEaseVals) : 0
  const maxEase = weekEaseVals.length ? Math.max(...weekEaseVals) : 1
  function easeBg(opp) {
    const val = pts_allowed_map?.[opp]
    if (val == null || maxEase === minEase) return undefined
    const t = (val - minEase) / (maxEase - minEase)
    if (t >= 0.67) return `rgba(0,230,118,${0.08 + (t - 0.67) * 0.45})`
    if (t <= 0.33) return `rgba(255,107,107,${0.08 + (0.33 - t) * 0.45})`
    return undefined
  }

  return (
    <div className="wsg-page">
      <div className="wsg-controls">
        <select className="wsg-select" value={selectedIdx ?? 0} onChange={e => setSelectedIdx(Number(e.target.value))}>
          {weeks.map((w, i) => (
            <option key={i} value={i}>{w.label}</option>
          ))}
        </select>
      </div>

      <div className="wsg-legend">
        <span className="wsg-legend-item wsg-legend-easy">Easier matchup</span>
        <span className="wsg-legend-item wsg-legend-hard">Harder matchup</span>
        {myTeams.length > 0 && <span className="wsg-legend-item wsg-legend-my">You own a player</span>}
      </div>

      {gameLoading ? (
        <div className="dash-empty">Loading games…</div>
      ) : (
        <div className="wsg-scroll">
          <table className="wsg-table">
            <thead>
              <tr>
                <th className="wsg-th-team">Team</th>
                {days.map((d, i) => (
                  <th key={i} className="wsg-th-day">
                    <div className="wsg-day-name">{DAY_NAMES[d.getDay()]}</div>
                    <div className="wsg-day-date">{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                  </th>
                ))}
                <th className="wsg-th-gp">GP</th>
              </tr>
            </thead>
            <tbody>
              {all_teams.map(team => {
                const teamGames = gameData?.[team] || {}
                const gp = days.filter(d => teamGames[fmt(d)]).length
                const isMyTeam = myTeamSet.has(team)
                return (
                  <tr key={team} className={isMyTeam ? 'wsg-my-team-row' : ''}>
                    <td className="wsg-td-team">{TEAM_ABBREV[team] || team.slice(0,3)}</td>
                    {days.map((d, i) => {
                      const g = teamGames[fmt(d)]
                      const bg = g ? easeBg(g.opp) : undefined
                      return (
                        <td key={i} className={`wsg-td-cell${g ? ' wsg-has-game' : ''}`} style={bg ? { backgroundColor: bg } : undefined}>
                          {g ? (
                            <span className="wsg-game-label">
                              {!g.home && <span className="wsg-at">@</span>}
                              {TEAM_ABBREV[g.opp] || (g.opp || '').slice(0,3)}
                            </span>
                          ) : <span className="wsg-rest">–</span>}
                        </td>
                      )
                    })}
                    <td className="wsg-td-gp">{gp > 0 ? gp : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}


// ── SeasonSchedulePage ─────────────────────────────────────────────────────────

function SeasonSchedulePage() {
  const [provider, setProvider] = useState(null)

  useEffect(() => {
    apiFetch('/api/fantasy/status')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.espn?.team_key)        setProvider('espn')
        else if (d?.yahoo?.team_key)  setProvider('yahoo')
        else                          setProvider('none')
      })
      .catch(() => setProvider('none'))
  }, [])

  if (provider === null) return <div className="dash-empty">Loading…</div>
  if (provider === 'none') return (
    <div className="dash-empty">Connect a fantasy league to see the season schedule grid.</div>
  )
  return <ScheduleGrid provider={provider} />
}


// ── ScheduleGrid ───────────────────────────────────────────────────────────────

function ScheduleGrid({ provider = 'espn' }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    apiFetch(`/api/fantasy/${provider}/schedule-grid`)
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.detail || r.statusText)))
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [provider])

  if (loading) return <div className="dash-empty">Loading schedule…</div>
  if (error)   return <div className="login-error" style={{margin:24}}>{error}</div>
  if (!data || !data.weeks.length) return <div className="dash-empty">No schedule data available.</div>

  const { weeks, all_teams, my_nba_teams } = data

  const mySet = new Set(my_nba_teams)

  // Ease colour scale: collect all non-null ease values across all cells
  const allEase = weeks.flatMap(w => all_teams.map(t => w.ease?.[t]).filter(v => v != null))
  const minEase = allEase.length ? Math.min(...allEase) : 0
  const maxEase = allEase.length ? Math.max(...allEase) : 1
  function easeBg(val) {
    if (val == null || maxEase === minEase) return ''
    const t = (val - minEase) / (maxEase - minEase)  // 0=hard, 1=easy
    // hard→red, mid→neutral, easy→green
    if (t >= 0.67) return `rgba(0,230,118,${0.08 + (t - 0.67) * 0.45})`  // green
    if (t <= 0.33) return `rgba(255,107,107,${0.08 + (0.33 - t) * 0.45})`  // red
    return ''  // middle third: no colour
  }

  return (
    <div className="sg-wrap">
      <div className="sg-legend">
        <span className="sg-legend-item sg-legend-nba">NBA Playoffs</span>
        <span className="sg-legend-item sg-legend-fantasy">Fantasy Playoffs</span>
        <span className="sg-legend-item sg-legend-ease-easy">Easier matchups</span>
        <span className="sg-legend-item sg-legend-ease-hard">Harder matchups</span>
        <span className="sg-legend-cell-key">Cell: <strong>games</strong> / <span className="sg-legend-pts">avg opp PTS allowed</span></span>
      </div>
      <div className="sg-scroll">
        <table className="sg-table">
          <thead>
            <tr>
              <th className="sg-col-week">Week</th>
              {all_teams.map(t => (
                <th
                  key={t}
                  className={`sg-col-team${mySet.has(t) ? ' sg-my-team' : ''}`}
                  title={t}
                >
                  {TEAM_ABBREV[t] || t.slice(0, 3)}
                </th>
              ))}
              <th className="sg-col-total sg-col-my-total">My GP</th>
              <th className="sg-col-total sg-col-opp-total">Opp GP</th>
              <th className="sg-col-opp-name">Opponent</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map(w => {
              const rowCls = [
                'sg-row',
                w.is_nba_playoff     ? 'sg-nba-playoff'     : '',
                w.is_fantasy_playoff ? 'sg-fantasy-playoff' : '',
              ].filter(Boolean).join(' ')
              return (
                <tr key={w.start} className={rowCls}>
                  <td className="sg-col-week">
                    <span className="sg-week-label">{w.label}</span>
                    {w.is_fantasy_playoff && !w.is_nba_playoff && <span className="sg-playoff-tag sg-playoff-tag-fantasy">Fantasy PO</span>}
                    {w.is_nba_playoff && <span className="sg-playoff-tag sg-playoff-tag-nba">NBA PO</span>}
                  </td>
                  {all_teams.map(t => {
                    const count = w.games[t] || 0
                    const isMy  = mySet.has(t)
                    const ease  = count > 0 ? w.ease?.[t] : null
                    const bg    = easeBg(ease)
                    return (
                      <td
                        key={t}
                        className={`sg-cell${isMy ? ' sg-my-team' : ''}`}
                        style={bg ? { backgroundColor: bg } : undefined}
                      >
                        {count > 0 ? (
                          <>
                            <span className="sg-count">{count}</span>
                            {ease != null && <span className="sg-ease-val">{ease}</span>}
                          </>
                        ) : <span className="sg-zero">–</span>}
                      </td>
                    )
                  })}
                  <td className={`sg-col-total sg-col-my-total${w.my_total > w.opp_total ? ' sg-total-win' : w.my_total < w.opp_total ? ' sg-total-loss' : ''}`}>
                    {w.my_total}
                  </td>
                  <td className={`sg-col-total sg-col-opp-total${w.opp_total != null && w.opp_total > w.my_total ? ' sg-total-win' : w.opp_total != null && w.opp_total < w.my_total ? ' sg-total-loss' : ''}`}>
                    {w.opp_total != null ? w.opp_total : '–'}
                  </td>
                  <td className="sg-col-opp-name">{w.opp_name || '–'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}


// ── Pro gating ────────────────────────────────────────────────────────────────

function SectionLock({ onUpgrade }) {
  return (
    <div className="progate-section">
      <span className="progate-lock-icon">🔒</span>
      <span className="progate-lock-label">Pro feature</span>
      <button className="progate-lock-btn" onClick={onUpgrade}>Upgrade to Pro · $20/yr</button>
    </div>
  )
}

function PageLock({ onUpgrade }) {
  return (
    <div className="progate-page">
      <div className="progate-page-card">
        <div className="progate-page-icon">🔒</div>
        <h2 className="progate-page-title">Pro feature</h2>
        <p className="progate-page-sub">Upgrade to Pro to unlock this — $20/yr.</p>
        <button className="progate-page-btn" onClick={onUpgrade}>Upgrade to Pro</button>
      </div>
    </div>
  )
}

function FantasySignupPrompt({ onSignup }) {
  return (
    <div className="progate-page">
      <div className="progate-page-card">
        <div className="progate-page-icon">🏀</div>
        <h2 className="progate-page-title">Connect your fantasy league</h2>
        <p className="progate-page-sub">Sign up for free to integrate with ESPN and Yahoo Fantasy and unlock roster analysis, trade tools, matchup planning and more.</p>
        <button className="progate-page-btn" onClick={onSignup}>Sign up free</button>
      </div>
    </div>
  )
}

// ── FantasyPage ────────────────────────────────────────────────────────────────

function FantasyPage({ onSelectPlayer, initialTab = 'dashboard' }) {
  const [status,        setStatus]      = useState(null)
  const [tab,           setTab]         = useState(initialTab)
  useEffect(() => { setTab(initialTab) }, [initialTab])
  const [activeProvider, setActiveProvider] = useState(
    () => localStorage.getItem('activeFantasyProvider') || null
  )
  const [rosterData,  setRosterData]  = useState(null)
  const [rosterErr,   setRosterErr]   = useState(null)
  const [dwData,      setDwData]      = useState(null)
  const [dwErr,       setDwErr]       = useState(null)
  const [freeAgents,  setFreeAgents]  = useState(null)

  function loadStatus() {
    apiFetch('/api/fantasy/status')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStatus(d) })
      .catch(() => {})
  }
  useEffect(() => { loadStatus() }, [])

  const espn  = status?.espn  || {}
  const yahoo = status?.yahoo || {}

  // Resolve which provider is actually active, falling back gracefully
  const effectiveProvider = (() => {
    if (!status) return null
    const espnReady  = espn.connected  && espn.team_key
    const yahooReady = yahoo.connected && yahoo.league_key
    if (activeProvider === 'espn'  && (espn.connected))  return 'espn'
    if (activeProvider === 'yahoo' && (yahoo.connected)) return 'yahoo'
    if (espnReady)  return 'espn'
    if (yahooReady) return 'yahoo'
    if (espn.connected)  return 'espn'
    if (yahoo.connected) return 'yahoo'
    return null
  })()

  function switchProvider(p) {
    setActiveProvider(p)
    localStorage.setItem('activeFantasyProvider', p)
    setRosterData(null); setRosterErr(null)
    setDwData(null); setDwErr(null)
    setFreeAgents(null)
  }

  // Fetch roster-analysis when provider or league changes
  useEffect(() => {
    if (!effectiveProvider) return
    if (effectiveProvider === 'espn' && espn.team_key) {
      setRosterData(null); setRosterErr(null)
      apiFetch('/api/fantasy/espn/roster-analysis')
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(d => setRosterData(d))
        .catch(() => setRosterErr('Failed to load roster — is ESPN connected?'))
    } else if (effectiveProvider === 'yahoo' && yahoo.league_key) {
      setRosterData(null); setRosterErr(null)
      apiFetch('/api/fantasy/yahoo/roster-analysis')
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(d => setRosterData(d))
        .catch(() => setRosterErr('Failed to load Yahoo roster data'))
    }
  }, [effectiveProvider, status?.espn?.team_key, status?.yahoo?.league_key])

  // Fetch decisive-wins
  useEffect(() => {
    if (!effectiveProvider) return
    const hasLeague = (espn.connected && espn.team_key) || (yahoo.connected && yahoo.league_key)
    if (!hasLeague) return
    setDwData(null); setDwErr(null)
    apiFetch('/api/fantasy/decisive-wins')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setDwData(d))
      .catch(() => setDwErr('Failed to load decisive wins data'))
  }, [effectiveProvider, status?.espn?.team_key, status?.yahoo?.league_key])

  // Fetch free agents (ESPN only)
  useEffect(() => {
    if (effectiveProvider !== 'espn' || !espn.team_key) return
    setFreeAgents(null)
    apiFetch('/api/fantasy/espn/free-agents')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setFreeAgents(d.free_agents || []))
      .catch(() => setFreeAgents([]))
  }, [effectiveProvider, status?.espn?.team_key])

  if (!status) return <div className="dash-empty">Loading…</div>

  // Neither connected
  if (!espn.connected && !yahoo.connected) return (
    <div className="fantasy-wrap">
      <div className="fantasy-connect-card">
        <h2 className="fantasy-connect-title">Connect your fantasy league</h2>
        <p className="fantasy-connect-sub">Go to <strong>Account</strong> (top right) to connect your ESPN or Yahoo league, then come back here.</p>
      </div>
    </div>
  )

  // Provider switcher — shown whenever multiple providers are connected
  const connectedProviders = ['espn', 'yahoo'].filter(p => status[p]?.connected)
  const providerSwitcher = connectedProviders.length > 1 && (
    <div style={{display:'flex',gap:6,padding:'12px 24px',borderBottom:'1px solid var(--border)'}}>
      {connectedProviders.map(p => (
        <button key={p} onClick={() => switchProvider(p)}
          style={{padding:'4px 16px',fontSize:12,fontWeight:700,borderRadius:20,border:'1px solid',
                  cursor:'pointer',letterSpacing:'0.04em',
                  background: effectiveProvider===p ? 'var(--skill)' : 'transparent',
                  color:      effectiveProvider===p ? '#000' : 'var(--muted)',
                  borderColor:effectiveProvider===p ? 'var(--skill)' : 'var(--border)'}}>
          {p.toUpperCase()}
        </button>
      ))}
    </div>
  )

  // ESPN not set up yet
  if (effectiveProvider === 'espn' && !espn.team_key) return (
    <>
      {providerSwitcher}
      <EspnTeamPicker
        onPicked={loadStatus}
        onDisconnect={async () => {
          await apiFetch('/api/fantasy/espn/disconnect', { method: 'DELETE' })
          loadStatus()
        }}
      />
    </>
  )

  // Yahoo not set up yet
  if (effectiveProvider === 'yahoo' && !yahoo.league_key) return (
    <>
      {providerSwitcher}
      <div className="fantasy-wrap">
        <div className="fantasy-connect-card">
          <h2 className="fantasy-connect-title">Yahoo connected</h2>
          <p className="fantasy-connect-sub">Select a league in <strong>Account</strong> to continue.</p>
        </div>
      </div>
    </>
  )

  // Yahoo (dashboard / standings / roster only)
  if (effectiveProvider === 'yahoo') return (
    <div>
      {providerSwitcher}
      {tab === 'dashboard' && <ManagerDashboard onSelectPlayer={onSelectPlayer} provider="yahoo" />}
      {tab === 'standings' && <ProjectedStandings endpoint="/api/fantasy/yahoo/projected-standings" />}
      {tab === 'roster' && (rosterErr
        ? <div className="login-error" style={{margin:24}}>{rosterErr}</div>
        : !rosterData ? <div className="dash-empty">Loading…</div>
        : <RosterAnalysis data={rosterData} dwData={dwData} dwErr={dwErr} freeAgents={freeAgents} onSelectPlayer={onSelectPlayer} />
      )}
      {tab === 'trade' && (rosterErr
        ? <div className="login-error" style={{margin:24}}>{rosterErr}</div>
        : !rosterData ? <div className="dash-empty">Loading…</div>
        : <TradeAnalysis data={rosterData} onSelectPlayer={onSelectPlayer} endpoints={{
            freeAgents:   '/api/fantasy/yahoo/free-agents',
            simulate:     '/api/fantasy/yahoo/roster-analysis/simulate',
            searchPlayer: '/api/fantasy/yahoo/roster-analysis/search-player',
          }} />
      )}
    </div>
  )

  // ESPN — full feature set
  return (
    <div>
      {providerSwitcher}
      {tab === 'dashboard' && <ManagerDashboard onSelectPlayer={onSelectPlayer} />}
      {tab === 'standings' && <ProjectedStandings />}
      {tab === 'roster' && (rosterErr
        ? <div className="login-error" style={{margin:24}}>{rosterErr}</div>
        : !rosterData ? <div className="dash-empty">Loading…</div>
        : <RosterAnalysis data={rosterData} dwData={dwData} dwErr={dwErr} freeAgents={freeAgents} onSelectPlayer={onSelectPlayer} />
      )}
      {tab === 'trade' && (rosterErr
        ? <div className="login-error" style={{margin:24}}>{rosterErr}</div>
        : !rosterData ? <div className="dash-empty">Loading…</div>
        : <TradeAnalysis data={rosterData} onSelectPlayer={onSelectPlayer} />
      )}
      {tab === 'matchup' && <MatchupProjection onSelectPlayer={onSelectPlayer} />}
    </div>
  )
}


function ModerationPage() {
  const [tab, setTab] = useState('all')
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [blockedWords, setBlockedWords] = useState([])
  const [newWord, setNewWord] = useState('')

  const loadComments = (t) => {
    setLoading(true)
    apiFetch(`/api/admin/moderation/comments?tab=${t}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => { setComments(d); setLoading(false) })
      .catch(() => setLoading(false))
  }

  const loadWords = () => {
    apiFetch('/api/admin/blocked-words')
      .then(r => r.ok ? r.json() : [])
      .then(d => setBlockedWords(d))
  }

  useEffect(() => { loadComments('all'); loadWords() }, [])

  const switchTab = (t) => { setTab(t); loadComments(t) }

  const toggleHide = (c) => {
    const endpoint = c.comment_type === 'blog'
      ? `/api/admin/moderation/blog-comments/${c.id}/hide`
      : `/api/admin/moderation/comments/${c.id}/hide`
    apiFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden: !c.is_hidden }) })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.ok) setComments(prev => prev.map(x => x.id === c.id && x.comment_type === c.comment_type ? { ...x, is_hidden: d.hidden ? 1 : 0 } : x))
      })
  }

  const addWord = () => {
    const w = newWord.trim().toLowerCase()
    if (!w) return
    apiFetch('/api/admin/blocked-words', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ word: w }) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) { setNewWord(''); loadWords() } })
  }

  const removeWord = (w) => {
    apiFetch(`/api/admin/blocked-words/${encodeURIComponent(w)}`, { method: 'DELETE' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) loadWords() })
  }

  const TABS = [
    { key: 'all', label: 'All' },
    { key: 'player', label: 'Player' },
    { key: 'blog', label: 'Blog' },
    { key: 'hidden', label: 'Hidden' },
  ]

  return (
    <div className="mod-page">
      <h2 className="mod-title">Comment Moderation</h2>

      <div className="mod-tabs">
        {TABS.map(t => (
          <button key={t.key} className={`mod-tab${tab === t.key ? ' active' : ''}`} onClick={() => switchTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {loading ? (
        <p className="mod-loading">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="mod-empty">No comments.</p>
      ) : (
        <div className="mod-table-wrap">
          <table className="mod-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Author</th>
                <th>Comment</th>
                <th>Context</th>
                <th>Date</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {comments.map((c) => (
                <tr key={`${c.comment_type}-${c.id}`} className={c.is_hidden ? 'mod-row-hidden' : ''}>
                  <td><span className={`mod-type-badge mod-type-${c.comment_type}`}>{c.comment_type}</span></td>
                  <td className="mod-author">{c.author}</td>
                  <td className="mod-body">{c.body}</td>
                  <td className="mod-context">{c.context_slug || c.post_title || '—'}</td>
                  <td className="mod-date">{c.created_at?.slice(0, 16).replace('T', ' ')}</td>
                  <td>{c.is_hidden ? <span className="mod-status-hidden">Hidden</span> : <span className="mod-status-visible">Visible</span>}</td>
                  <td>
                    <button className={`mod-action-btn${c.is_hidden ? ' unhide' : ' hide'}`} onClick={() => toggleHide(c)}>
                      {c.is_hidden ? 'Unhide' : 'Hide'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mod-words-section">
        <h3 className="mod-words-title">Blocked words</h3>
        <p className="mod-words-desc">Comments containing these words are automatically hidden.</p>
        <div className="mod-words-add">
          <input
            className="mod-words-input"
            type="text"
            placeholder="Add word…"
            value={newWord}
            onChange={e => setNewWord(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addWord()}
          />
          <button className="mod-words-add-btn" onClick={addWord}>Add</button>
        </div>
        <div className="mod-words-list">
          {blockedWords.length === 0 ? (
            <span className="mod-words-empty">No blocked words yet.</span>
          ) : blockedWords.map(w => (
            <span key={w.word} className="mod-word-chip">
              {w.word}
              <button className="mod-word-remove" onClick={() => removeWord(w.word)}>×</button>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}


function AppMain({ onLogout, onOpenAccount, token }) {
  const yahooConnected = new URLSearchParams(window.location.search).get('yahoo_connected')
  const [dark, setDark] = useState(() => localStorage.getItem('theme') !== 'light')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])
  const [page, setPage]               = useState(yahooConnected ? 'fantasy' : 'dashboard')
  const [fantasyTab, setFantasyTab]   = useState('dashboard')
  const [boxScoreDate, setBoxScoreDate] = useState(null)

  const PAGE_TITLES = {
    dashboard:         'Home',
    rankings:          'Rankings',
    projections:       'Projections',
    trending:          'Trending Players',
    boxscores:         'Box Scores',
    injuries:          'Injury Report',
    depth:             'Depth Charts',
    'weekly-schedule': 'Weekly Schedule',
    'season-schedule': 'Season Schedule',
    blog:              'Blog',
    adjustments:       'Player Adjustments',
    moderation:        'Moderation',
  }
  const FANTASY_TAB_TITLES = {
    dashboard:  'Dashboard',
    standings:  'Projected Standings',
    roster:     'Roster Analysis',
    trade:      'Trade Analysis',
    matchup:    'Matchup Analysis',
  }
  const pageTitle = page === 'fantasy'
    ? (FANTASY_TAB_TITLES[fantasyTab] ?? 'Fantasy')
    : PAGE_TITLES[page]
  const [blogInitSlug, setBlogInitSlug] = useState(null)
  const [isAdmin, setIsAdmin]           = useState(false)
  const [tier,    setTier]              = useState('free')
  const [query, setQuery]             = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [showSugg, setShowSugg]       = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [selectedPlayer, setSelected] = useState(null)
  const [stat, setStat]               = useState('reb')
  const [periodA, setPeriodA]         = useState({ start: '2025-10-22', end: '2026-02-13' })
  const [periodB, setPeriodB]         = useState({ start: '2026-02-21', end: '2026-04-06' })
  const [result, setResult]           = useState(null)
  const [zResult, setZResult]         = useState(null)
  const [zBreakdown, setZBreakdown]   = useState(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  const [dataRange, setDataRange]     = useState(null)
  const [gameLog, setGameLog]         = useState(null)
  const [shotDiet, setShotDiet]       = useState(null)
  const [playerStats, setPlayerStats] = useState(null)
  const [projection, setProjection]   = useState(null)
  const [projLoading, setProjLoading] = useState(false)
  const [projMpg, setProjMpg]         = useState(32)
  const [projStat, setProjStat]       = useState('pts')
  const [histMode, setHistMode]       = useState('pg')   // 'pg' | 'p36'
  const [projYear, setProjYear]       = useState(1)
  const [projExpanded, setProjExpanded] = useState(false)
  const [projScenario, setProjScenario] = useState('baseline')
  const [usageExpanded, setUsageExpanded] = useState(false)
  const [usageUsg, setUsageUsg]           = useState(null)   // target USG% (null = use base)
  const [usageMinutes, setUsageMinutes]   = useState(null)   // target min/g (null = use base)
  const [playerGames, setPlayerGames] = useState(null)
  const [maStat, setMaStat]           = useState('pts')
  const [maWindow, setMaWindow]       = useState(10)
  const [maChartType, setMaChartType] = useState('line')
  const [maRangeStart, setMaRangeStart] = useState(0)
  const [maRangeEnd,   setMaRangeEnd]   = useState(null) // null = last game
  const [maExpanded, setMaExpanded]   = useState(false)
  const [glExpanded, setGlExpanded]   = useState(false)
  const [glStart, setGlStart]         = useState(0)
  const [glEnd, setGlEnd]             = useState(0)
  const [ownership, setOwnership]         = useState({})
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

  const isPro = true // all features open

  const searchRef   = useRef(null)
  const debounceRef = useRef(null)
  const bdLayoutRef = useRef(null)

  useEffect(() => {
    if (yahooConnected) window.history.replaceState({}, '', '/')
    apiFetch('/api/adjustments/is-admin').then(r => r.ok ? r.json() : null).then(d => { if (d?.is_admin) setIsAdmin(true) }).catch(() => {})
    apiFetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(d => { if (d?.tier) setTier(d.tier) }).catch(() => {})
  }, [])

  useEffect(() => {
    apiFetch('/api/fantasy/ownership')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.by_slug) setOwnership(d.by_slug) })
      .catch(() => {})
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

  // Apply breakdown table alignment after zBreakdown renders the table
  useEffect(() => {
    if (!zBreakdown || !bdLayoutRef.current) return
    const wrap = document.getElementById('z-breakdown-table-wrap')
    if (!wrap) return
    const { spacerW, colW, totalW } = bdLayoutRef.current
    wrap.style.setProperty('--tbl-spacer', spacerW + 'px')
    wrap.style.setProperty('--tbl-col',    colW + 'px')
    wrap.style.setProperty('--tbl-total',  totalW + 'px')
  }, [zBreakdown])

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
    setProjLoading(true)
    setPlayerGames(null)
    setMaRangeStart(0); setMaRangeEnd(null)
    setSchedProj(null)
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
      .finally(() => setProjLoading(false))
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
    setZResult(null)
    setZBreakdown(null)
    setGameLog(null)
    setShotDiet(null)
    try {
      const params = new URLSearchParams({
        player: selectedPlayer.slug,
        pa_start: periodA.start, pa_end: periodA.end,
        pb_start: periodB.start, pb_end: periodB.end,
      })
      if (stat === 'z_scores') {
        const [res, bdRes] = await Promise.all([
          apiFetch(`/api/z-score-comparison?${params}`),
          apiFetch(`/api/z-score-breakdown?${params}`),
        ])
        if (!res.ok) {
          const body = await res.json().catch(() => ({ detail: 'Request failed' }))
          setError(body.detail ?? 'Request failed')
        } else {
          setZResult(await res.json())
          if (bdRes.ok) setZBreakdown(await bdRes.json())
        }
        setLoading(false)
        return
      }
      params.set('stat', stat)
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
        if (stat === 'pts' || stat === 'fg3m' || stat === 'fg_pct') {
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

  const wf  = result  ? buildWaterfall(result)   : null
  const zwf = zResult ? buildZWaterfall(zResult) : null
  const activeWf = zwf ?? wf

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
  const HIST_PCT_KEYS = new Set(['fg_pct', 'ft_pct', 'z_sum'])
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
    const val = s[key] ?? null
    if (histMode === 'p36' && val != null && !HIST_PCT_KEYS.has(key)) {
      const mpg = s.min_pg || 30
      return +(val * 30 / mpg).toFixed(1)
    }
    return val
  }
  const getProjVal = (proj, scenario = 'baseline') => {
    const src = scenario === 'baseline' ? proj : (proj[scenario] ?? proj)
    if (projStat === 'z_sum')  return src.z_sum ?? null
    if (projStat === 'ft_pct') return src.projection_p30.ft_pct ?? null
    if (projStat === 'fg_pct') return +src.projection_p30.fg_pct.toFixed(1)
    if (histMode === 'p36')    return +(src.projection_p30[projStat]).toFixed(1)
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
        borderColor: '#00e676',
        pointBackgroundColor: (ctx) => {
          const idx = ctx.dataIndex - nHist + 1
          return idx === projYear ? '#00e676' : 'rgba(0,230,118,0.4)'
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
        grid:   { color: isDark() ? '#1a1a1a' : 'rgba(0,0,0,0.07)', drawTicks: false },
        border: { color: '#222' },
        ticks:  { color: '#bbb', font: { family: "'DM Mono', monospace", size: 11 },
                  callback: (_, i, ticks) => { const v = trendLabels[i]; return v ? v.slice(2) : '' } },
      },
      y: {
        grid:   { color: isDark() ? '#1a1a1a' : 'rgba(0,0,0,0.07)', drawTicks: false },
        border: { color: '#222' },
        ticks:  { color: '#bbb', font: { family: "'DM Mono', monospace", size: 11 } },
      },
    },
  }

  // Moving average chart
  const maAllGames  = playerGames ?? []
  const maEffEnd    = maRangeEnd   ?? (maAllGames.length - 1)
  const maGames     = maAllGames.slice(maRangeStart, maEffEnd + 1)
  const maIsZSum    = maStat === 'z_sum'
  // Z-scores computed over full career so the baseline doesn't shift with the slider
  const maAllZSums  = maIsZSum ? computeGameZSums(maAllGames) : null
  const maRawVals   = maIsZSum
    ? maAllZSums.slice(maRangeStart, maEffEnd + 1)
    : maGames.map(g => g[maStat] ?? null)
  const maSynthGames = maIsZSum ? maGames.map((g, i) => ({ ...g, z_sum: maRawVals[i] })) : maGames
  const maVals      = rollingAverage(maSynthGames, maStat, maWindow)
  const maStatLabel = MA_STAT_OPTIONS.find(o => o.value === maStat)?.label ?? maStat
  const maTrendVals = linReg(maRawVals)

  // Smart x-axis: DD MMM when window ≤ 60 days, MMM 'YY otherwise
  const maDateSpanDays = maGames.length > 1
    ? Math.round((new Date(maGames[maGames.length - 1].game_date) - new Date(maGames[0].game_date)) / 86400000)
    : 0
  const MA_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const maDateLabel = (game_date) => {
    if (!game_date) return ''
    const [y, m, day] = game_date.split('-')
    return maDateSpanDays <= 60
      ? `${+day} ${MA_MONTHS[+m - 1]}`
      : `${MA_MONTHS[+m - 1]} '${y.slice(2)}`
  }

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
      {
        label: 'Trend',
        data: maTrendVals,
        borderColor: 'rgba(0,230,118,0.5)',
        backgroundColor: 'transparent',
        pointRadius: 0,
        pointHoverRadius: 0,
        borderWidth: 1.5,
        borderDash: [5, 4],
        spanGaps: true,
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
        grid:   { color: isDark() ? '#1a1a1a' : 'rgba(0,0,0,0.03)', drawTicks: false },
        border: { color: isDark() ? '#222' : 'rgba(0,0,0,0.08)' },
        ticks: {
          color: '#888',
          font: { family: "'DM Mono', monospace", size: 11 },
          maxTicksLimit: 12,
          maxRotation: 0,
          callback: (_, i) => maDateLabel(maGames[i]?.game_date),
        },
      },
      y: {
        grid:   { color: isDark() ? '#1a1a1a' : 'rgba(0,0,0,0.03)', drawTicks: false },
        border: { color: isDark() ? '#222' : 'rgba(0,0,0,0.08)' },
        ticks:  { color: '#bbb', font: { family: "'DM Mono', monospace", size: 11 } },
      },
    },
  }

  const maBarData = maGames.length > 0 ? {
    labels: maGames.map(g => g.game_date),
    datasets: [{
      label: maStatLabel,
      data: maRawVals,
      backgroundColor: maRawVals.map((v, i) => {
        if (v == null) return 'transparent'
        const ease = maGames[i]?.opp_ease
        if (ease == null) return 'rgba(150,150,255,0.7)'
        if (ease > 1.5)  return 'rgba(0,230,118,0.65)'
        if (ease < -1.5) return 'rgba(255,107,107,0.65)'
        return 'rgba(150,150,255,0.7)'
      }),
      borderColor: 'transparent',
      borderRadius: 2,
    }],
  } : null

  const maBarOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      datalabels: { display: false },
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => { const d = maGames[items[0].dataIndex]?.game_date; if (!d) return ''; const [y,m,day] = d.split('-'); const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${months[+m-1]} ${+day} '${y.slice(2)}` },
          label: (ctx) => {
            const v = ctx.parsed.y
            if (v == null) return null
            const statStr = (maStat === 'fg_pct' || maStat === 'ft_pct') ? ` ${v.toFixed(1)}%` : ` ${v.toFixed(2)}`
            const ease = maGames[ctx.dataIndex]?.opp_ease
            const opp = maGames[ctx.dataIndex]?.opponent ?? ''
            const easeStr = ease != null ? `  Ease vs ${opp}: ${ease > 0 ? '+' : ''}${ease}%` : ''
            return [statStr, easeStr].filter(Boolean)
          },
        },
        backgroundColor: '#1c1c1c', borderColor: '#2a2a2a', borderWidth: 1,
        titleColor: '#aaa', bodyColor: '#eee',
      },
    },
    scales: {
      x: {
        grid:   { display: false },
        border: { color: isDark() ? '#222' : 'rgba(0,0,0,0.08)' },
        ticks: {
          color: '#888',
          font: { family: "'DM Mono', monospace", size: 11 },
          maxTicksLimit: 12,
          maxRotation: 0,
          callback: (_, i) => maDateLabel(maGames[i]?.game_date),
        },
      },
      y: {
        grid:   { color: isDark() ? '#1a1a1a' : 'rgba(0,0,0,0.03)', drawTicks: false },
        border: { color: isDark() ? '#222' : 'rgba(0,0,0,0.08)' },
        ticks:  { color: '#bbb', font: { family: "'DM Mono', monospace", size: 11 } },
      },
    },
  }

  const labelPlugin = {
    id: 'waterfallLabels',
    afterDraw(chart) {
      if (!activeWf) return
      const meta = chart.getDatasetMeta(0)
      if (!meta?.data) return
      const { ctx } = chart
      const yScale = chart.scales.y
      const dark = isDark()
      ctx.save()
      ctx.font = "500 11px 'DM Mono', monospace"
      ctx.textAlign = 'center'

      const { bottom: cBot } = chart.chartArea
      const CLEAR  = 8   // gap from bar edge to label
      const TEXT_H = 14  // approx rendered text height

      meta.data.forEach((bar, i) => {
        const [from, to] = activeWf.barRanges[i]
        if (Math.abs(to - from) < 1e-9) return
        const neg = activeWf.isNegative[i]
        const isEndBar = i === 0 || i === activeWf.labels.length - 1

        const barTopPx = Math.min(bar.y, bar.base)
        const barBotPx = Math.max(bar.y, bar.base)
        const barHeight = barBotPx - barTopPx

        // Skip labels for bars too short to meaningfully display
        if (!isEndBar && barHeight < 3) return

        let labelY, baseline, isInside = false
        if (isEndBar) {
          labelY   = barBotPx - 8
          baseline = 'bottom'
        } else if (neg) {
          // First choice: below bar
          const below = barBotPx + CLEAR
          if (below + TEXT_H <= chart.height) {
            labelY = below; baseline = 'top'
          } else {
            // Second choice: above bar (into top padding zone)
            const above = barTopPx - CLEAR
            if (above >= TEXT_H) {
              labelY = above; baseline = 'bottom'
            } else {
              labelY = barBotPx - CLEAR; baseline = 'bottom'; isInside = true
            }
          }
        } else {
          // First choice: above bar (top padding zone is fair game)
          const above = barTopPx - CLEAR
          if (above >= TEXT_H) {
            labelY = above; baseline = 'bottom'
          } else {
            // Second choice: below bar
            const below = barBotPx + CLEAR
            if (below + TEXT_H <= chart.height) {
              labelY = below; baseline = 'top'
            } else {
              labelY = barTopPx + CLEAR; baseline = 'top'; isInside = true
            }
          }
        }

        ctx.fillStyle = isEndBar
          ? (dark ? 'rgba(220,220,220,0.8)' : 'rgba(30,30,30,0.8)')
          : isInside
          ? (dark ? 'rgba(255,255,255,0.92)' : 'rgba(20,20,20,0.9)')
          : activeWf.colors[i]

        ctx.textBaseline = baseline
        ctx.fillText(activeWf.displayLabels[i], bar.x, labelY)

        // Dashed connector to the next bar
        if (i < meta.data.length - 2) {
          const nextBar = meta.data[i + 1]
          const connectVal = neg ? from : to
          const connectPx  = yScale.getPixelForValue(connectVal)
          const x1 = bar.x + bar.width / 2
          const x2 = nextBar.x - nextBar.width / 2
          ctx.strokeStyle = dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'
          ctx.lineWidth = 1
          ctx.setLineDash([3, 3])
          ctx.beginPath()
          ctx.moveTo(x1, connectPx)
          ctx.lineTo(x2, connectPx)
          ctx.stroke()
          ctx.setLineDash([])
        }
      })
      ctx.restore()

      // Sync breakdown table column widths to bar positions
      if (zwf && activeWf) {
        const numBars = activeWf.labels.length  // Baseline + 9 cats + Comparison
        const areaW   = chart.chartArea.right - chart.chartArea.left
        const slotW   = areaW / numBars
        const spacerW = Math.round(chart.chartArea.left + slotW)  // axis gap + Baseline slot
        const colW    = Math.round(slotW)
        const totalW  = Math.max(Math.round(chart.width - spacerW - (numBars - 2) * colW), 40)
        bdLayoutRef.current = { spacerW, colW, totalW }
        const wrap = document.getElementById('z-breakdown-table-wrap')
        if (wrap) {
          wrap.style.setProperty('--tbl-spacer', spacerW + 'px')
          wrap.style.setProperty('--tbl-col',    colW + 'px')
          wrap.style.setProperty('--tbl-total',  totalW + 'px')
        }
      }
    },
  }

  const chartData = activeWf && {
    labels: activeWf.labels,
    datasets: [{
      label: 'value',
      data: activeWf.barRanges,
      backgroundColor: activeWf.colors,
      borderRadius: 2,
      borderWidth: 0,
    }],
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 24 } },
    plugins: {
      datalabels: { display: false },
      legend: { display: false },
      tooltip: {
        callbacks: { label: (ctx) => ' ' + (activeWf?.tipLabels[ctx.dataIndex] ?? '') },
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
        grid: { color: isDark() ? '#1a1a1a' : 'rgba(0,0,0,0.04)', drawTicks: false },
        border: { color: isDark() ? '#222' : 'rgba(0,0,0,0.1)' },
        ticks: {
          color: '#bbb',
          font: { family: "'DM Mono', monospace", size: 11 },
          maxRotation: 0,
          minRotation: 0,
        },
      },
      y: {
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
    const v = key === 'tov' ? -z : z
    const dark = isDark()
    if (v >= 1.5)  return dark ? '#00e676' : '#0a7a36'
    if (v >= 0.5)  return dark ? '#9affda' : '#2d8c5a'
    if (v <= -1.5) return '#ff6b6b'
    if (v <= -0.5) return '#ff9e9e'
    return '#555'
  }

  function StatCell({ val, col, z, noZ }) {
    if (val === null || val === undefined) return <><td className="num mono stat-cell">—</td>{!noZ && <td className="num mono z-cell">—</td>}</>
    const display = (col === 'fg_pct' || col === 'ft_pct') ? `${val.toFixed(1)}%` : val.toFixed(1)
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
    const dark = isDark()
    const rankColor = data.rank && data.rank_n
      ? data.rank / data.rank_n <= 0.1  ? (dark ? '#00e676' : '#0a7a36')
      : data.rank / data.rank_n <= 0.25 ? (dark ? '#9affda' : '#2d8c5a')
      : data.rank / data.rank_n >= 0.9  ? '#ff6b6b'
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
          <StatCell key={c.key} val={highlight === 'p30' && c.key === 'min_pg' ? 30 : data[c.key]} col={c.key} z={data[`z_${c.key}`]} noZ={c.noZ} />
        ))}
      </tr>
    )
  }

  function ProjectionRow({ label, data, note, scenario, projRank, projRankN, currentMpg }) {
    if (!data) return null
    const scenarioLabel = scenario === 'optimistic' ? 'Optimistic' : scenario === 'pessimistic' ? 'Pessimistic' : 'Forecast'
    const scenarioColor = scenario === 'optimistic' ? '#7c8cff' : scenario === 'pessimistic' ? '#ff6b6b' : isDark() ? '#00e676' : '#0a7a36'
    const dark = isDark()
    const rankColor = projRank && projRankN
      ? projRank / projRankN <= 0.1  ? (dark ? '#00e676' : '#0a7a36')
      : projRank / projRankN <= 0.25 ? (dark ? '#9affda' : '#2d8c5a')
      : projRank / projRankN >= 0.9  ? '#ff6b6b'
      : projRank / projRankN >= 0.75 ? '#ff9e9e'
      : '#aaa'
      : '#555'
    return (
      <tr className="stats-row-projection">
        <td className="stats-period-cell">
          <div>{label}{note && <span className="archetype-transition" title={`Projected archetype: ${note}`}> ↓</span>}</div>
          <div><span className="forecast-badge" style={{ color: scenarioColor, borderColor: scenarioColor }}>{scenarioLabel}</span></div>
        </td>
        <td className="stats-period-cell muted" style={{ fontSize: '11px', fontFamily: 'var(--mono)' }}>—</td>
        <td className="num mono stat-cell muted">—</td>
        <td className="num mono rank-cell" colSpan={2} style={{ color: rankColor }}>
          {projRank ? projRank : '—'}
        </td>
        {STAT_COLS.map(c => {
          const rawVal = c.key === 'min_pg' && currentMpg != null ? currentMpg : data[c.key]
          const val = rawVal
          if (val === null || val === undefined) {
            return <Fragment key={c.key}><td className="num mono stat-cell">—</td>{!c.noZ && <td className="num mono z-cell">—</td>}</Fragment>
          }
          const display = (c.key === 'fg_pct' || c.key === 'ft_pct') ? `${val.toFixed(1)}%` : val.toFixed(1)
          return (
            <Fragment key={c.key}>
              <td className="num mono stat-cell" style={{ color: c.key === 'min_pg' ? undefined : scenarioColor }}>{display}</td>
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
          <div className="site-logo" onClick={() => setPage('dashboard')} style={{ cursor: 'pointer' }}>
            <span className="site-logo-icon">🏀</span>
            <h1 className="site-brand">Roto <span className="site-brand-intel">Intel</span></h1>
          </div>
          <button className="hamburger-btn" onClick={() => setMobileMenuOpen(o => !o)} aria-label="Menu">
            <span className={`hamburger-icon${mobileMenuOpen ? ' open' : ''}`}>
              <span/><span/><span/>
            </span>
          </button>
          <nav className={`site-nav${mobileMenuOpen ? ' mobile-open' : ''}`}>
            {(() => {
              const go = (p) => { setPage(p); setMobileMenuOpen(false) }
              return (<>
                <button className={`nav-btn${page === 'dashboard' ? ' active' : ''}`} onClick={() => go('dashboard')}>Home</button>

                <div className="nav-group">
                  <button className={`nav-btn nav-group-btn${['rankings','projections','trending','depth'].includes(page) ? ' active' : ''}`}>
                    Players <span className="nav-chevron">▾</span>
                  </button>
                  <div className="nav-dropdown">
                    <button className="nav-drop-item" onClick={() => go('rankings')}>Rankings</button>
                    <button className="nav-drop-item" onClick={() => go('projections')}>Projections</button>
                    <button className="nav-drop-item" onClick={() => go('trending')}>Trending Players</button>
                    <button className="nav-drop-item" onClick={() => go('depth')}>Depth Charts</button>
                  </div>
                </div>

                <div className="nav-group">
                  <button className={`nav-btn nav-group-btn${['boxscores','injuries','weekly-schedule','season-schedule'].includes(page) ? ' active' : ''}`}>
                    Schedule <span className="nav-chevron">▾</span>
                  </button>
                  <div className="nav-dropdown">
                    <button className="nav-drop-item" onClick={() => go('season-schedule')}>Season Schedule</button>
                    <button className="nav-drop-item" onClick={() => go('weekly-schedule')}>Weekly Schedule</button>
                    <button className="nav-drop-item" onClick={() => go('boxscores')}>Box Scores</button>
                    <button className="nav-drop-item" onClick={() => go('injuries')}>Injuries &amp; News</button>
                  </div>
                </div>

                <div className="nav-group">
                  <button className={`nav-btn nav-group-btn${['fantasy','adjustments','draft'].includes(page) ? ' active' : ''}`}>
                    Fantasy <span className="nav-chevron">▾</span>
                  </button>
                  <div className="nav-dropdown">
                    <button className="nav-drop-item" onClick={() => { setFantasyTab('dashboard');  go('fantasy') }}>Dashboard</button>
                    <button className="nav-drop-item" onClick={() => { setFantasyTab('standings');  go('fantasy') }}>Projected Standings</button>
                    <button className="nav-drop-item" onClick={() => { setFantasyTab('roster');     go('fantasy') }}>Roster Analysis</button>
                    <button className="nav-drop-item" onClick={() => { setFantasyTab('trade');      go('fantasy') }}>Trade Analysis</button>
                    <button className="nav-drop-item" onClick={() => { setFantasyTab('matchup');    go('fantasy') }}>Matchup Analysis</button>
                    <button className="nav-drop-item" onClick={() => go('draft')}>Draft</button>
                    {isAdmin && <button className="nav-drop-item" onClick={() => go('adjustments')}>Adjustments</button>}
                  </div>
                </div>

                <button className={`nav-btn${page === 'blog' ? ' active' : ''}`} onClick={() => go('blog')}>Blog</button>

                <button className={`nav-btn${page === 'forum' ? ' active' : ''}`} onClick={() => go('forum')}>Community</button>

                <a className="nav-btn" href="https://roto-intel-landing.onrender.com/docs.html" target="_blank" rel="noopener noreferrer">Explainer</a>

                {/* Mobile-only: account links inside menu */}
                <div className="mobile-nav-footer">
                  <button className="nav-drop-item" onClick={() => setDark(d => !d)}>
                    {dark ? '☀︎ Light mode' : '☾ Dark mode'}
                  </button>
                  {token
                    ? <>
                        <button className="nav-drop-item" onClick={() => { onOpenAccount(); setMobileMenuOpen(false) }}>Account</button>
                        <button className="nav-drop-item nav-drop-signout" onClick={onLogout}>Sign out</button>
                      </>
                    : <>
                        <button className="nav-drop-item" onClick={() => { onOpenAccount(); setMobileMenuOpen(false) }}>Sign up free</button>
                        <button className="nav-drop-item" onClick={() => { onOpenAccount(); setMobileMenuOpen(false) }}>Log in</button>
                      </>
                  }
                </div>
              </>)
            })()}
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
            <div className="nav-group nav-avatar-group">
              <button className="nav-avatar-btn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4"/>
                  <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                </svg>
              </button>
              <div className="nav-dropdown nav-dropdown-right">
                {token
                  ? <>
                      <button className="nav-drop-item" onClick={onOpenAccount}>Account</button>
                      {isAdmin && <button className="nav-drop-item" onClick={() => setPage('moderation')}>Moderation</button>}
                      <button className="nav-drop-item nav-drop-signout" onClick={onLogout}>Sign out</button>
                    </>
                  : <>
                      <button className="nav-drop-item" onClick={onOpenAccount}>Sign up free</button>
                      <button className="nav-drop-item" onClick={onOpenAccount}>Log in</button>
                    </>
                }
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── Page body ──────────────────────────────────────── */}
      <main className="page-body">
      {pageTitle && page !== 'player' && (
        <div className="page-title-bar">
          <h2 className="page-title">{pageTitle}</h2>
        </div>
      )}

      {page === 'dashboard' && <DashboardPage
        onSelectPlayer={p => { selectPlayer(p); setPage('player') }}
        onSelectBlogPost={slug => { setBlogInitSlug(slug); setPage('blog') }}
      />}

      {page === 'rankings' && <RankingsPage onSelectPlayer={p => { selectPlayer(p); setPage('player') }} ownership={ownership} />}

      {page === 'boxscores' && <BoxScorePage onSelectPlayer={p => { selectPlayer(p); setPage('player') }} ownership={ownership} initialDate={boxScoreDate} />}

      {page === 'projections' && (
        <ProjectionsPage onSelectPlayer={p => { selectPlayer(p); setPage('player') }} ownership={ownership} />
      )}

      {page === 'injuries' && <InjuriesPage onSelectPlayer={p => { selectPlayer(p); setPage('player') }} ownership={ownership} />}

      {page === 'depth' && <DepthChartsPage onSelectPlayer={p => { selectPlayer(p); setPage('player') }} />}

      {page === 'fantasy' && (
        token
          ? <FantasyPage onSelectPlayer={p => { selectPlayer(p); setPage('player') }} initialTab={fantasyTab} />
          : <FantasySignupPrompt onSignup={onOpenAccount} />
      )}

      {page === 'trending' && <TrendingPage onSelectPlayer={p => { selectPlayer(p); setPage('player') }} ownership={ownership} />}

      {page === 'blog' && <BlogPage setPage={setPage} initSlug={blogInitSlug} onMount={() => setBlogInitSlug(null)} />}

      {page === 'forum' && <ForumPage />}

      {page === 'draft' && <DraftPage />}

      {page === 'adjustments' && <AdjustmentsPage />}

      {page === 'moderation' && <ModerationPage />}

      {page === 'weekly-schedule' && <WeeklySchedulePage />}
      {page === 'season-schedule' && <SeasonSchedulePage />}

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

            {playerStats.player.news?.length > 0 && (
              <div className="player-news">
                {playerStats.player.news.map((a, i) => (
                  <a key={i} className="player-news-item" href={a.link} target="_blank" rel="noreferrer">
                    <span className="player-news-date">{a.date}</span>
                    <span className="player-news-title">{a.title}</span>
                  </a>
                ))}
              </div>
            )}

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
                  {playerStats.seasons[1] && (
                    <StatsRow label={playerStats.seasons[1].period} data={playerStats.seasons[1]} highlight="prev-season" />
                  )}
                  <StatsRow label="Per 30 min" data={playerStats.p30} highlight="p30" />
                  <StatsRow label="Last 14 days" data={playerStats.l14} highlight="recent" />
                  <StatsRow label="Last 30 days" data={playerStats.l30} highlight="recent" />
                  {projLoading && !projection
                    ? (
                      <tr className="stats-row-projection stats-row-skeleton">
                        <td className="stats-period-cell"><div className="skel-line" style={{width:64}} /></td>
                        <td className="stats-period-cell"><div className="skel-line" style={{width:24}} /></td>
                        <td className="num"><div className="skel-line" style={{width:20}} /></td>
                        <td className="num" colSpan={2}><div className="skel-line" style={{width:28}} /></td>
                        {STAT_COLS.map(c => (
                          <Fragment key={c.key}>
                            <td className="num"><div className="skel-line" style={{width:28}} /></td>
                            {!c.noZ && <td className="num"><div className="skel-line" style={{width:22}} /></td>}
                          </Fragment>
                        ))}
                      </tr>
                    )
                    : <ProjectionRow
                        label={activeProj ? activeProj.season : 'Projected'}
                        data={projRowData}
                        note={activeProj && activeProj.archetype !== projection.archetype ? activeProj.archetype : null}
                        scenario={projScenario}
                        projRank={activeProjSrc?.proj_rank}
                        projRankN={activeProjSrc?.proj_rank_n}
                        currentMpg={playerStats.seasons[0]?.min_pg}
                      />
                  }
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
                const CMP_COLORS = [isDark() ? '#00e676' : '#0a7a36', '#ff9e64', '#64b5ff', '#c084fc']
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
                      grid: { color: isDark() ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.1)' },
                      angleLines: { color: isDark() ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.1)' },
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
                        { label: 'This Season vs Last Season', a: { start: '2024-10-22', end: '2025-04-13' }, b: { start: '2025-10-22', end: '2026-04-06' } },
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
                {zResult && selectedPlayer && (
                  <div className="driver-results">
                    <div className="metrics-row">
                      <div className="metric-card">
                        <span className="metric-label">Baseline Z</span>
                        <span className="metric-value">{zResult.period_a.z_total.toFixed(2)}</span>
                        <span className="metric-sub">{zResult.period_a.start} – {zResult.period_a.end}</span>
                      </div>
                      <div className="metric-card">
                        <span className="metric-label">Δ Z-Score</span>
                        <span className="metric-value" style={{ color: zResult.delta >= 0 ? '#00e676' : '#ff6b6b' }}>
                          {zResult.delta >= 0 ? '+' : ''}{zResult.delta.toFixed(2)}
                        </span>
                        <span className="metric-sub">across all categories</span>
                      </div>
                      <div className="metric-card">
                        <span className="metric-label">Comparison Z</span>
                        <span className="metric-value">{zResult.period_b.z_total.toFixed(2)}</span>
                        <span className="metric-sub">{zResult.period_b.start} – {zResult.period_b.end}</span>
                      </div>
                    </div>
                    <div className="chart-wrap">
                      <Bar data={chartData} options={chartOptions} plugins={[labelPlugin]} />
                    </div>
                    {zBreakdown && (
                      <div id="z-breakdown-table-wrap" className="z-breakdown-wrap">
                        <table className="z-breakdown-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                          <colgroup>
                            <col style={{ width: 'var(--tbl-spacer, 120px)' }} />
                            {zResult.categories.map(c => (
                              <col key={c.key} style={{ width: 'var(--tbl-col, auto)' }} />
                            ))}
                            <col style={{ width: 'var(--tbl-total, 80px)' }} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th className="zbd-row-label"></th>
                              {zResult.categories.map(c => (
                                <th key={c.key} className="zbd-cat">{c.label}</th>
                              ))}
                              <th className="zbd-cat zbd-sum-hd">Σ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              const fmtCell = (v, colDelta, sumDelta) => {
                                if (v == null) return '—'
                                const sign = v >= 0 ? '+' : ''
                                const denom = sumDelta != null ? sumDelta : colDelta
                                const pct = denom != null && Math.abs(denom) > 0.001
                                  ? Math.round(v / denom * 100)
                                  : null
                                return (
                                  <>
                                    {sign}{v.toFixed(2)}
                                    {pct != null && <span className="zbd-pct"> ({pct >= 0 ? '+' : ''}{pct}%)</span>}
                                  </>
                                )
                              }
                              const rows = [
                                { key: 'rate', label: 'Rate' },
                                { key: 'pace', label: 'Pace' },
                                { key: 'role', label: 'Role' },
                              ]
                              return rows.map(({ key, label }) => {
                                const total = zResult.categories.reduce((s, c) => {
                                  const v = zBreakdown[c.key]?.[key]
                                  return v != null ? s + v : s
                                }, 0)
                                return (
                                  <tr key={key}>
                                    <td className="zbd-row-label">{label}</td>
                                    {zResult.categories.map(c => {
                                      const v = zBreakdown[c.key]?.[key]
                                      return (
                                        <td key={c.key} className={`zbd-val ${v == null ? 'zbd-null' : v > 0.005 ? 'pos' : v < -0.005 ? 'neg' : ''}`}>
                                          {fmtCell(v, c.delta)}
                                        </td>
                                      )
                                    })}
                                    <td className={`zbd-val zbd-sum ${total > 0.005 ? 'pos' : total < -0.005 ? 'neg' : ''}`}>
                                      {fmtCell(total, zResult.delta)}
                                    </td>
                                  </tr>
                                )
                              })
                            })()}
                            <tr className="zbd-league-row">
                              <td className="zbd-row-label">League</td>
                              {(() => {
                                let leagueTotal = 0
                                let leagueTotalHas = false
                                const fmtCell = (v, colDelta, sumDelta) => {
                                  if (v == null) return '—'
                                  const sign = v >= 0 ? '+' : ''
                                  const denom = sumDelta != null ? sumDelta : colDelta
                                  const pct = denom != null && Math.abs(denom) > 0.001
                                    ? Math.round(v / denom * 100)
                                    : null
                                  return (
                                    <>
                                      {sign}{v.toFixed(2)}
                                      {pct != null && <span className="zbd-pct"> ({pct >= 0 ? '+' : ''}{pct}%)</span>}
                                    </>
                                  )
                                }
                                const cells = zResult.categories.map(c => {
                                  const bd = zBreakdown[c.key]
                                  const hasAny = bd && (bd.rate != null || bd.pace != null || bd.role != null)
                                  if (!hasAny) return <td key={c.key} className="zbd-val zbd-null">—</td>
                                  const sumDrivers = (bd.rate ?? 0) + (bd.pace ?? 0) + (bd.role ?? 0)
                                  const v = c.delta - sumDrivers
                                  leagueTotal += v
                                  leagueTotalHas = true
                                  return (
                                    <td key={c.key} className={`zbd-val ${v > 0.005 ? 'pos' : v < -0.005 ? 'neg' : ''}`}>
                                      {fmtCell(v, c.delta)}
                                    </td>
                                  )
                                })
                                const sumCell = leagueTotalHas
                                  ? <td className={`zbd-val zbd-sum ${leagueTotal > 0.005 ? 'pos' : leagueTotal < -0.005 ? 'neg' : ''}`}>{fmtCell(leagueTotal, zResult.delta)}</td>
                                  : <td className="zbd-val zbd-null">—</td>
                                return [...cells, sumCell]
                              })()}
                            </tr>
                            <tr className="zbd-total-row">
                              <td className="zbd-row-label">Δ Z</td>
                              {zResult.categories.map(c => {
                                const pct = Math.abs(zResult.delta) > 0.001
                                  ? Math.round(c.delta / zResult.delta * 100)
                                  : null
                                return (
                                  <td key={c.key} className={`zbd-val ${c.delta > 0.005 ? 'pos' : c.delta < -0.005 ? 'neg' : ''}`}>
                                    {c.delta >= 0 ? '+' : ''}{c.delta.toFixed(2)}
                                    {pct != null && <span className="zbd-pct"> ({pct >= 0 ? '+' : ''}{pct}%)</span>}
                                  </td>
                                )
                              })}
                              <td className={`zbd-val zbd-sum ${zResult.delta > 0.005 ? 'pos' : zResult.delta < -0.005 ? 'neg' : ''}`}>
                                {zResult.delta >= 0 ? '+' : ''}{zResult.delta.toFixed(2)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
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
                          return <span className="metric-sched" style={{ color: f >= 1 ? '#00e676' : '#ff6b6b' }}>Sched {label}</span>
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
                          return <span className="metric-sched" style={{ color: f >= 1 ? '#00e676' : '#ff6b6b' }}>Sched {label}</span>
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
                    {shotDiet && (stat === 'pts' || stat === 'fg3m' || stat === 'fg_pct') && (() => {
                      const zoneRows = ZONE_ORDER.map(zk => {
                        const z = shotDiet.zones.find(r => r.zone === zk) || {
                          zone: zk, label: ZONE_LABELS[zk],
                          fga_a: 0, fga_b: 0, fg_pct_a: 0, fg_pct_b: 0,
                          freq_a: 0, freq_b: 0,
                          diet_effect: 0, efficiency_effect: 0,
                        }
                        return { ...z, net: z.diet_effect + z.efficiency_effect }
                      })
                      const percs  = shotDiet.percentiles_a || {}
                      const percsB = shotDiet.percentiles_b || {}
                      const selZoneLabels = zoneRows.map(z => {
                        const a = ordinal(percs[z.zone]?.freq_pct), b = ordinal(percsB[z.zone]?.freq_pct)
                        return (a != null && b != null) ? [ZONE_LABELS[z.zone], `${a} → ${b} %ile`] : ZONE_LABELS[z.zone]
                      })
                      const fgZoneLabels = zoneRows.map(z => {
                        const a = ordinal(percs[z.zone]?.fg_pct_pct), b = ordinal(percsB[z.zone]?.fg_pct_pct)
                        return (a != null && b != null) ? [ZONE_LABELS[z.zone], `${a} → ${b} %ile`] : ZONE_LABELS[z.zone]
                      })
                      const BASE_COLOR = '#3a4470'
                      const COMP_COLOR = '#00e676'
                      const baseLabel = `Baseline (${result.period_a.start} – ${result.period_a.end})`
                      const compLabel = `Comparison (${result.period_b.start} – ${result.period_b.end})`
                      const selChartData = {
                        labels: selZoneLabels,
                        datasets: [
                          { label: baseLabel, data: zoneRows.map(z => +(z.freq_a * 100).toFixed(1)), backgroundColor: BASE_COLOR, borderRadius: 2 },
                          { label: compLabel, data: zoneRows.map(z => +(z.freq_b * 100).toFixed(1)), backgroundColor: COMP_COLOR, borderRadius: 2 },
                        ],
                      }
                      const fgChartData = {
                        labels: fgZoneLabels,
                        datasets: [
                          { label: baseLabel, data: zoneRows.map(z => z.fga_a > 0 ? +(z.fg_pct_a * 100).toFixed(1) : 0), backgroundColor: BASE_COLOR, borderRadius: 2 },
                          { label: compLabel, data: zoneRows.map(z => z.fga_b > 0 ? +(z.fg_pct_b * 100).toFixed(1) : 0), backgroundColor: COMP_COLOR, borderRadius: 2 },
                        ],
                      }
                      const zoneChartOpts = (yTitle) => ({
                        responsive: true, maintainAspectRatio: false,
                        plugins: {
                          legend: { display: true, labels: { color: '#bbb', font: { family: "'DM Mono', monospace", size: 11 }, boxWidth: 10 } },
                          tooltip: { backgroundColor: '#1c1c1c', borderColor: '#2a2a2a', borderWidth: 1, titleColor: '#555', bodyColor: '#e8e8e8', titleFont: { family: "'DM Mono', monospace", size: 10 }, bodyFont: { family: "'DM Mono', monospace", size: 12 }, padding: 10, cornerRadius: 4 },
                          datalabels: { anchor: 'end', align: 'end', formatter: v => v > 0 ? `${v}%` : null, color: '#bbb', font: { family: "'DM Mono', monospace", size: 11 } },
                        },
                        scales: {
                          x: { grid: { color: '#1a1a1a' }, border: { color: '#222' }, ticks: { color: '#bbb', font: { family: "'DM Mono', monospace", size: 11 }, maxRotation: 0 } },
                          y: { display: false },
                        },
                      })
                      return (
                        <div className="shot-diet-section">
                          <h2 className="panel-title">Shot diet analysis</h2>
                          <div className="shot-summary">
                            <div className="shot-metric"><span className="metric-label">Baseline FG%</span><span className="metric-value">{(shotDiet.fg_pct_a * 100).toFixed(1)}%</span></div>
                            <div className="shot-metric"><span className="metric-label">Selection effect</span><span className={`metric-value ${shotDiet.diet_total >= 0 ? 'pos' : 'neg'}`}>{shotDiet.diet_total >= 0 ? '+' : ''}{(shotDiet.diet_total * 100).toFixed(1)}pp</span><span className="metric-sub">shot mix shift</span></div>
                            <div className="shot-metric"><span className="metric-label">Efficiency effect</span><span className={`metric-value ${shotDiet.efficiency_total >= 0 ? 'pos' : 'neg'}`}>{shotDiet.efficiency_total >= 0 ? '+' : ''}{(shotDiet.efficiency_total * 100).toFixed(1)}pp</span><span className="metric-sub">zone accuracy</span></div>
                            <div className="shot-metric"><span className="metric-label">Comparison FG%</span><span className="metric-value">{(shotDiet.fg_pct_b * 100).toFixed(1)}%</span><span className={`metric-sub metric-delta ${shotDiet.delta >= 0 ? 'pos' : 'neg'}`}>{shotDiet.delta >= 0 ? '+' : ''}{(shotDiet.delta * 100).toFixed(1)}pp</span></div>
                          </div>
                          <div className="shot-diet-charts">
                            <div className="shot-diet-chart-wrap"><div className="shot-chart-title">Shot distribution by zone</div><Bar data={selChartData} options={zoneChartOpts('% of FGA')} /></div>
                            <div className="shot-diet-chart-wrap"><div className="shot-chart-title">FG% by zone</div><Bar data={fgChartData} options={zoneChartOpts('FG%')} /></div>
                          </div>

                          <div className="shot-zone-courts-row">
                            <ShotZoneCourt id="freq" title="Shot distribution change" zones={zoneRows.map(z => ({ zone: z.zone, delta: z.freq_b - z.freq_a, unit: 'pct', label: `${(z.freq_b - z.freq_a) >= 0 ? '+' : ''}${((z.freq_b - z.freq_a)*100).toFixed(1)}%` }))} />
                            <ShotZoneCourt id="fg" title="FG% change by zone" zones={zoneRows.map(z => ({ zone: z.zone, delta: (z.fga_a > 0 || z.fga_b > 0) ? z.fg_pct_b - z.fg_pct_a : 0, unit: 'pp', label: (z.fga_a > 0 || z.fga_b > 0) ? `${(z.fg_pct_b - z.fg_pct_a) >= 0 ? '+' : ''}${((z.fg_pct_b - z.fg_pct_a)*100).toFixed(1)}pp` : '' }))} />
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
            {schedProj && (
              <div className="projection-section">
                <div className="projection-header" onClick={() => setSchedExpanded(e => !e)} style={{ cursor: 'pointer' }}>
                  <h3 className="panel-title">Upcoming Games {!isPro && <span className="pro-badge">PRO</span>}</h3>
                  <span className="proj-toggle">{schedExpanded ? '▲' : '▼'}</span>
                </div>
                {schedExpanded && (schedProj.games.length === 0
                  ? <p className="sched-no-games">No upcoming games — this team's season has ended.</p>
                  : isPro ? (() => {
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
                  const sosColor = sosAvg > 1.05 ? '#00e676' : sosAvg < 0.95 ? '#ff6b6b' : '#aaa'
                  const periodLabel = { season: 'Season', l30: 'Last 30', l14: 'Last 14' }[schedProj.period] || 'Season'
                  const todayStr = new Date().toISOString().slice(0, 10)

                  // Chart data for selected stat
                  const chartLabels = schedProj.games.map(g => `${g.date.slice(5)} ${g.home_away === 'Home' ? 'vs' : '@'} ${g.opponent.split(' ').pop()}`)
                  const midVals  = schedProj.games.map(g => g.projected[schedStat])
                  const lowVals  = schedProj.games.map(g => g.projected_low?.[schedStat] ?? g.projected[schedStat])
                  const highVals = schedProj.games.map(g => g.projected_high?.[schedStat] ?? g.projected[schedStat])
                  const coneColor = 'rgba(0,230,118,0.12)'
                  const lineColor = '#00e676'

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
                      x: { ticks: { color: '#bbb', font: { size: 11 } }, grid: { color: isDark() ? '#1e2740' : 'rgba(0,0,0,0.07)' } },
                      y: { ticks: { color: '#bbb', font: { size: 11 } }, grid: { color: isDark() ? '#1e2740' : 'rgba(0,0,0,0.07)' }, beginAtZero: true },
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
                })() : <SectionLock onUpgrade={onOpenAccount} />)}
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

              // ── Projected Z-total + rank ──────────────────────────────────
              const zp   = playerStats.z_params
              const dist = playerStats.z_total_distribution || []
              const projFgaPg = (base.fga_pg || 0) * minScale * usgScale * fgDecay
              const projFtaPg = (base.fta_pg || 0) * minScale * usgScale * fgDecay

              const zScoreFor = (key, val, fgaPg, ftaPg) => {
                const p = zp?.[key]
                if (!p || !p.std) return 0
                if (key === 'fg_pct') return ((val - p.league_avg) * fgaPg - p.mean) / p.std
                if (key === 'ft_pct') return ((val - p.league_avg) * ftaPg - p.mean) / p.std
                return (val - p.mean) / p.std
              }

              const baseZTotal = (base.z_pts ?? 0) + (base.z_reb ?? 0) + (base.z_ast ?? 0) +
                                 (base.z_stl ?? 0) + (base.z_blk ?? 0) - (base.z_tov ?? 0) +
                                 (base.z_fg3m ?? 0) + (base.z_fg_pct ?? 0) + (base.z_ft_pct ?? 0)

              const projZTotal = zp ? (
                zScoreFor('pts',    proj.pts,    projFgaPg, projFtaPg) +
                zScoreFor('reb',    proj.reb,    projFgaPg, projFtaPg) +
                zScoreFor('ast',    proj.ast,    projFgaPg, projFtaPg) +
                zScoreFor('stl',    proj.stl,    projFgaPg, projFtaPg) +
                zScoreFor('blk',    proj.blk,    projFgaPg, projFtaPg) -
                zScoreFor('tov',    proj.tov,    projFgaPg, projFtaPg) +
                zScoreFor('fg3m',   proj.fg3m,   projFgaPg, projFtaPg) +
                zScoreFor('fg_pct', proj.fg_pct, projFgaPg, projFtaPg) +
                zScoreFor('ft_pct', proj.ft_pct, projFgaPg, projFtaPg)
              ) : baseZTotal

              // When sliders are at default, trust the backend z-scores to avoid rounding drift
              const effectiveZTotal = changed ? projZTotal : baseZTotal
              const deltaZTotal = effectiveZTotal - baseZTotal
              const baseRank  = base.rank ?? null
              const projRank  = changed && dist.length > 0
                ? dist.filter(z => z > effectiveZTotal).length + 1
                : baseRank

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
                    <h3 className="panel-title">Usage Projector {!isPro && <span className="pro-badge">PRO</span>}</h3>
                    <span className="proj-toggle">{usageExpanded ? '▲' : '▼'}</span>
                  </div>
                  {usageExpanded && (isPro ? (
                    <>
                    <div className="usage-sliders-row">
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
                      {baseRank && projRank && (
                        <div className="usage-rank-pill">
                          <span className="usage-rank-label">9-cat rank</span>
                          <span className="usage-rank-vals">
                            <span className="usage-rank-base">#{baseRank}</span>
                            <span className="usage-rank-arrow"> → </span>
                            <span className={`usage-rank-proj ${projRank < baseRank ? 'pos' : projRank > baseRank ? 'neg' : ''}`}>
                              #{projRank}
                            </span>
                            {projRank !== baseRank && (
                              <span className={`usage-rank-delta ${projRank < baseRank ? 'pos' : 'neg'}`}>
                                {projRank < baseRank ? ` ▲${baseRank - projRank}` : ` ▼${projRank - baseRank}`}
                              </span>
                            )}
                          </span>
                        </div>
                      )}
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
                        {zp && (
                          <tr className="usage-tr-total">
                            <td className="usage-td-stat">Z-Total</td>
                            <td className="usage-td-num muted">{baseZTotal.toFixed(2)}</td>
                            <td className="usage-td-num">{effectiveZTotal.toFixed(2)}</td>
                            <td className="usage-td-num usage-delta">
                              {changed
                                ? `${deltaZTotal >= 0 ? '+' : ''}${deltaZTotal.toFixed(2)}`
                                : '—'}
                            </td>
                            <td className="usage-td-tag"></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    <p className="usage-note">
                      Base: {base.period} avg · {baseMpg.toFixed(1)} min/g · {baseUsg.toFixed(1)}% USG
                      {changed && effUsg !== baseUsg && ` → ${effUsg.toFixed(1)}% USG`}
                    </p>
                    </>
                  ) : <SectionLock onUpgrade={onOpenAccount} />)}
                </div>
              )
            })()}

            {/* ── Projection controls + trend chart ────────── */}
            {(projection || projLoading) && (
              <div className="projection-section">
                <div className="projection-header" onClick={() => setProjExpanded(e => !e)} style={{ cursor: 'pointer' }}>
                  <h3 className="panel-title">Career Projection</h3>
                  <span className="proj-toggle">{projExpanded ? '▲' : '▼'}</span>
                </div>

                {projLoading && !projection && projExpanded && (
                  <div className="proj-skeleton-box">
                    <div className="skel-line" style={{ width: '60%', height: 12, marginBottom: 12 }} />
                    <div className="skel-line" style={{ width: '100%', height: 140 }} />
                  </div>
                )}

                {!projLoading && projExpanded && <>
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
                  {!HIST_PCT_KEYS.has(projStat) && (
                    <div className="hist-mode-toggle">
                      <button
                        className={`hist-mode-btn${histMode === 'pg'  ? ' active' : ''}`}
                        onClick={() => setHistMode('pg')}
                      >Per game</button>
                      <button
                        className={`hist-mode-btn${histMode === 'p36' ? ' active' : ''}`}
                        onClick={() => setHistMode('p36')}
                      >Per 30</button>
                    </div>
                  )}
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
                  <h3 className="panel-title">Form {!isPro && <span className="pro-badge">PRO</span>}</h3>
                  <span className="proj-toggle">{maExpanded ? '▲' : '▼'}</span>
                </div>

                {maExpanded && (isPro ? <>
                <div className="trend-controls">
                  <span className="ctrl-label">Stat</span>
                  <select className="ctrl-input" value={maStat} onChange={e => setMaStat(e.target.value)}>
                    {MA_STAT_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {maChartType === 'line' && <>
                    <span className="ctrl-label" style={{ marginLeft: '1rem' }}>Weighted Average Period</span>
                    <select className="ctrl-input" value={maWindow} onChange={e => setMaWindow(+e.target.value)}>
                      {MA_WINDOW_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </>}
                  <div className="rank-pills" style={{ marginLeft: 'auto' }}>
                    <button className={`rank-pill${maChartType === 'line' ? ' active' : ''}`} onClick={() => setMaChartType('line')}>Line</button>
                    <button className={`rank-pill${maChartType === 'bar'  ? ' active' : ''}`} onClick={() => setMaChartType('bar')}>Bar</button>
                  </div>
                </div>
                {maAllGames.length > 0 && (
                  <div className="mpg-slider-row">
                    <span className="ctrl-label">Period</span>
                    <div className="dual-range-wrap">
                      <input
                        type="range" className="dual-range dual-range-start"
                        min={0} max={maAllGames.length - 1} step={1}
                        value={maRangeStart}
                        onChange={e => { const v = +e.target.value; setMaRangeStart(Math.min(v, maEffEnd - 1)) }}
                      />
                      <input
                        type="range" className="dual-range dual-range-end"
                        min={0} max={maAllGames.length - 1} step={1}
                        value={maEffEnd}
                        onChange={e => { const v = +e.target.value; setMaRangeEnd(Math.max(v, maRangeStart + 1)) }}
                      />
                      <div className="dual-range-track">
                        <div className="dual-range-fill" style={{
                          left:  `${(maRangeStart / (maAllGames.length - 1)) * 100}%`,
                          right: `${((maAllGames.length - 1 - maEffEnd) / (maAllGames.length - 1)) * 100}%`,
                        }} />
                      </div>
                    </div>
                    <span className="mpg-value" style={{ minWidth: 120, fontSize: 12 }}>
                      {maAllGames[maRangeStart]?.game_date?.slice(0,7)} → {maAllGames[maEffEnd]?.game_date?.slice(0,7)}
                    </span>
                  </div>
                )}
                <div className="trend-chart-wrap" style={{ height: '260px' }}>
                  {maChartType === 'line'
                    ? maChartData && <Line data={maChartData} options={maChartOptions} />
                    : maBarData   && <Bar  data={maBarData}   options={maBarOptions} />}
                </div>
                {maChartType === 'bar' && (
                  <div className="ease-legend">
                    <span className="ease-legend-item ease-legend-easy">Easy matchup</span>
                    <span className="ease-legend-item ease-legend-mid">Neutral</span>
                    <span className="ease-legend-item ease-legend-hard">Hard matchup</span>
                  </div>
                )}
                </> : <SectionLock onUpgrade={onOpenAccount} />)}
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
                    <div className="gl-range-wrap">
                      <div className="gl-range-track" />
                      <div className="gl-range-fill" style={{
                        left: `${(glStart / (playerGames.length - 1)) * 100}%`,
                        right: `${((playerGames.length - 1 - glEnd) / (playerGames.length - 1)) * 100}%`,
                      }} />
                      <input type="range" className="gl-thumb"
                        min={0} max={playerGames.length - 1} step={1}
                        value={glStart}
                        onChange={e => setGlStart(Math.min(+e.target.value, glEnd))}
                      />
                      <input type="range" className="gl-thumb"
                        min={0} max={playerGames.length - 1} step={1}
                        value={glEnd}
                        onChange={e => setGlEnd(Math.max(+e.target.value, glStart))}
                      />
                    </div>
                    <div className="gl-range-labels">
                      <span className="mpg-value">{playerGames.length - glStart} games ago</span>
                      <span className="mpg-value">{glEnd === playerGames.length - 1 ? 'latest' : `${playerGames.length - 1 - glEnd} games ago`}</span>
                    </div>
                    <div className="table-scroll">
                      <table className="gamelog-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Opp</th>
                            <th className="num">Score</th>
                            <th className="num">USG%</th>
                            <th className="num" title="Opponent pts allowed vs league avg">Ease</th>
                            <th className="num">Min</th>
                            <th className="num">+/-</th>
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
                            <th className="num">Z</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleGames.map((g, i) => {
                            const pm = g.plus_minus
                            const pmNum = pm != null ? parseInt(pm, 10) : null
                            const z = g.z_total
                            const inj = g.injured
                            return (
                            <tr key={i} className={`${i % 2 === 0 ? 'row-even' : ''}${inj ? ' gl-injured' : ''}`}>
                              <td className="mono gl-date-link" onClick={() => { if (!g.injured) { setBoxScoreDate(g.game_date); setPage('boxscores') } }}>{g.game_date}</td>
                              <td>
                                <span className="opp-cell">
                                  <span className="ha-badge">{g.home_away?.[0] === 'H' ? 'H' : 'A'}</span>
                                  {g.opponent}
                                </span>
                              </td>
                              <td className="num mono" style={{ whiteSpace: 'nowrap' }}>
                                {g.team_score != null && g.opp_score != null
                                  ? <span className={g.team_score > g.opp_score ? 'z-pos' : 'z-neg'}>
                                      {g.team_score > g.opp_score ? 'W' : 'L'} {g.team_score}-{g.opp_score}
                                    </span>
                                  : '—'}
                              </td>
                              <td className="num mono">{g.usg_pct != null ? g.usg_pct + '%' : '—'}</td>
                              <td className="num mono" style={{ color: g.opp_ease == null ? '#888' : g.opp_ease > 1 ? '#00e676' : g.opp_ease < -1 ? '#ff6b6b' : '#888' }}>
                                {g.opp_ease == null ? '—' : g.opp_ease > 1 ? 'High' : g.opp_ease < -1 ? 'Low' : 'Mid'}
                              </td>
                              <td className="num mono">{inj ? <span className="gl-dnp">DNP</span> : g.min}</td>
                              <td className={`num mono${pmNum != null ? (pmNum > 0 ? ' z-pos' : pmNum < 0 ? ' z-neg' : '') : ''}`}>
                                {pmNum != null ? (pmNum > 0 ? '+' : '') + pmNum : '—'}
                              </td>
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
                              <td className={`num mono bs-ztotal${z != null ? (z > 0 ? ' z-pos' : z < 0 ? ' z-neg' : ' z-neu') : ''}`}>
                                {z != null ? (z > 0 ? '+' : '') + z : '—'}
                              </td>
                            </tr>
                            )
                          })}
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
            {shotDiet && (stat === 'pts' || stat === 'fg3m' || stat === 'fg_pct') && (() => {
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

              const percs  = shotDiet.percentiles_a || {}
              const percsB = shotDiet.percentiles_b || {}
              const selZoneLabels = zoneRows.map(z => {
                const a = ordinal(percs[z.zone]?.freq_pct), b = ordinal(percsB[z.zone]?.freq_pct)
                return (a != null && b != null) ? [ZONE_LABELS[z.zone], `${a} → ${b} %ile`] : ZONE_LABELS[z.zone]
              })
              const fgZoneLabels = zoneRows.map(z => {
                const a = ordinal(percs[z.zone]?.fg_pct_pct), b = ordinal(percsB[z.zone]?.fg_pct_pct)
                return (a != null && b != null) ? [ZONE_LABELS[z.zone], `${a} → ${b} %ile`] : ZONE_LABELS[z.zone]
              })
              const BASE_COLOR = '#3a4470'
              const COMP_COLOR = '#00e676'
              const baseLabel = `Baseline (${result.period_a.start} – ${result.period_a.end})`
              const compLabel = `Comparison (${result.period_b.start} – ${result.period_b.end})`
              const selChartData = {
                labels: selZoneLabels,
                datasets: [
                  { label: baseLabel, data: zoneRows.map(z => +(z.freq_a * 100).toFixed(1)), backgroundColor: BASE_COLOR, borderRadius: 2 },
                  { label: compLabel, data: zoneRows.map(z => +(z.freq_b * 100).toFixed(1)), backgroundColor: COMP_COLOR, borderRadius: 2 },
                ],
              }
              const fgChartData = {
                labels: fgZoneLabels,
                datasets: [
                  { label: baseLabel, data: zoneRows.map(z => z.fga_a > 0 ? +(z.fg_pct_a * 100).toFixed(1) : 0), backgroundColor: BASE_COLOR, borderRadius: 2 },
                  { label: compLabel, data: zoneRows.map(z => z.fga_b > 0 ? +(z.fg_pct_b * 100).toFixed(1) : 0), backgroundColor: COMP_COLOR, borderRadius: 2 },
                ],
              }
              const zoneChartOpts = (yTitle) => ({
                responsive: true, maintainAspectRatio: false,
                plugins: {
                  legend: { display: true, labels: { color: '#bbb', font: { family: "'DM Mono', monospace", size: 11 }, boxWidth: 10 } },
                  tooltip: { backgroundColor: '#1c1c1c', borderColor: '#2a2a2a', borderWidth: 1, titleColor: '#555', bodyColor: '#e8e8e8', titleFont: { family: "'DM Mono', monospace", size: 10 }, bodyFont: { family: "'DM Mono', monospace", size: 12 }, padding: 10, cornerRadius: 4 },
                  datalabels: { anchor: 'end', align: 'end', formatter: v => v > 0 ? `${v}%` : null, color: '#bbb', font: { family: "'DM Mono', monospace", size: 11 } },
                },
                scales: {
                  x: { grid: { color: '#1a1a1a' }, border: { color: '#222' }, ticks: { color: '#bbb', font: { family: "'DM Mono', monospace", size: 11 }, maxRotation: 0 } },
                  y: { display: false },
                },
              })

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

                  {/* Bar charts */}
                  <div className="shot-diet-charts">
                    <div className="shot-diet-chart-wrap"><div className="shot-chart-title">Shot distribution by zone</div><Bar data={selChartData} options={zoneChartOpts('% of FGA')} /></div>
                    <div className="shot-diet-chart-wrap"><div className="shot-chart-title">FG% by zone</div><Bar data={fgChartData} options={zoneChartOpts('FG%')} /></div>
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
                        <th className="num">Score</th>
                        <th className="num">USG%</th>
                        <th className="num" title="Opponent pts allowed vs league avg">Ease</th>
                        <th className="num">Min</th>
                        <th className="num">+/-</th>
                        <th className="num">Pts</th>
                        <th className="num">3P</th>
                        <th className="num">3P%</th>
                        <th className="num">Reb</th>
                        <th className="num">Ast</th>
                        <th className="num">Stl</th>
                        <th className="num">Blk</th>
                        <th className="num">Tov</th>
                        <th className="num">FG</th>
                        <th className="num">FG%</th>
                        <th className="num">FT</th>
                        <th className="num">FT%</th>
                        <th className="num">Z</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gameLog.map((g, i) => {
                        const pm = g.plus_minus
                        const pmNum = pm != null ? parseInt(pm, 10) : null
                        const z = g.z_total
                        const inj = g.injured
                        return (
                        <tr key={i} className={`${i % 2 === 0 ? 'row-even' : ''}${inj ? ' gl-injured' : ''}`}>
                          <td className="mono">{g.game_date}</td>
                          <td>
                            <span className="opp-cell">
                              <span className="ha-badge">{g.home_away?.[0] === 'H' ? 'H' : 'A'}</span>
                              {g.opponent}
                            </span>
                          </td>
                          <td className="num mono" style={{ whiteSpace: 'nowrap' }}>
                            {g.team_score != null && g.opp_score != null
                              ? <span className={g.team_score > g.opp_score ? 'z-pos' : 'z-neg'}>
                                  {g.team_score > g.opp_score ? 'W' : 'L'} {g.team_score}-{g.opp_score}
                                </span>
                              : '—'}
                          </td>
                          <td className="num mono">{g.usg_pct != null ? g.usg_pct + '%' : '—'}</td>
                          <td className="num mono" style={{ color: g.opp_ease != null ? (g.opp_ease > 0 ? '#00e676' : '#ff6b6b') : '#888' }}>
                            {g.opp_ease != null ? (g.opp_ease > 0 ? '+' : '') + g.opp_ease + '%' : '—'}
                          </td>
                          <td className="num mono">{inj ? <span className="gl-dnp">DNP</span> : g.min}</td>
                          <td className={`num mono${pmNum != null ? (pmNum > 0 ? ' z-pos' : pmNum < 0 ? ' z-neg' : '') : ''}`}>
                            {pmNum != null ? (pmNum > 0 ? '+' : '') + pmNum : '—'}
                          </td>
                          <td className="num mono">{g.pts}</td>
                          <td className="num mono">{g.fg3m}-{g.fg3a}</td>
                          <td className="num mono">{g.fg3a > 0 ? (g.fg3m / g.fg3a * 100).toFixed(0) + '%' : '—'}</td>
                          <td className="num mono">{g.reb}</td>
                          <td className="num mono">{g.ast}</td>
                          <td className="num mono">{g.stl}</td>
                          <td className="num mono">{g.blk}</td>
                          <td className="num mono">{g.tov}</td>
                          <td className="num mono">{g.fgm}-{g.fga}</td>
                          <td className="num mono">{g.fga > 0 ? (g.fgm / g.fga * 100).toFixed(0) + '%' : '—'}</td>
                          <td className="num mono">{g.ftm}-{g.fta}</td>
                          <td className="num mono">{g.fta > 0 ? (g.ftm / g.fta * 100).toFixed(0) + '%' : '—'}</td>
                          <td className={`num mono bs-ztotal${z != null ? (z > 0 ? ' z-pos' : z < 0 ? ' z-neg' : ' z-neu') : ''}`}>
                            {z != null ? (z > 0 ? '+' : '') + z : '—'}
                          </td>
                        </tr>
                        )
                      })}
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
  const _qs            = new URLSearchParams(window.location.search)
  const _upgradeParam  = _qs.get('upgrade')   // 'pro' | 'elite' | null
  const [token,            setToken]            = useState(() => localStorage.getItem('nba_token'))
  const [showAccount,      setShowAccount]      = useState(() => _qs.get('upgraded') === '1' || !!_upgradeParam)
  const [autoUpgradeTier,  setAutoUpgradeTier]  = useState(() => _upgradeParam)

  function handleLogin(t) {
    localStorage.setItem('nba_token', t)
    setToken(t)
    if (_upgradeParam) { setShowAccount(true); setAutoUpgradeTier(_upgradeParam) }
  }
  function handleLogout()        { localStorage.removeItem('nba_token'); setToken(null) }
  function handleTokenRefresh(t) { localStorage.setItem('nba_token', t); setToken(t) }
  function closeAccount()        { setShowAccount(false); setAutoUpgradeTier(null); window.history.replaceState({}, '', '/') }

  return <>
    <AppMain onLogout={handleLogout} onOpenAccount={() => setShowAccount(true)} token={token} />
    {showAccount && (
      <AccountModal
        onClose={closeAccount}
        onTokenRefresh={t => { handleTokenRefresh(t); closeAccount() }}
        autoUpgrade={autoUpgradeTier}
      />
    )}
  </>
}
