// Roto Intel — ESPN Fantasy Basketball overlay
// Extracts player IDs from the matchup page and injects analysis panel

const RI_ID = 'roto-intel-panel'

// ── Player ID extraction ─────────────────────────────────────────────────────

function getPlayerIdsFromElement(el) {
  const ids = new Set()
  el.querySelectorAll('a[href*="/id/"]').forEach(a => {
    const m = a.href.match(/\/id\/(\d+)\//)
    if (m) ids.add(m[1])
  })
  el.querySelectorAll('img[src*="headshots/nba/players"]').forEach(img => {
    const m = img.src.match(/\/(\d+)\.(png|jpg)/)
    if (m) ids.add(m[1])
  })
  return [...ids]
}

function extractTeams() {
  // ESPN matchup page: two team sections side-by-side
  // Try common ESPN class patterns first
  const selectors = [
    '.matchup-team',
    '[class*="Matchup__Team"]',
    '.team--home, .team--away',
    '[class*="teamContainer"]',
  ]

  for (const sel of selectors) {
    const containers = document.querySelectorAll(sel)
    if (containers.length >= 2) {
      const teams = [...containers].map(c => getPlayerIdsFromElement(c)).filter(ids => ids.length > 0)
      if (teams.length >= 2) return { myTeam: teams[0], oppTeam: teams[1] }
    }
  }

  // Fallback: spatial split — left half vs right half of page
  const allLinks = [...document.querySelectorAll('a[href*="/id/"]')]
  const midX = document.documentElement.clientWidth / 2
  const left = new Set(), right = new Set()

  allLinks.forEach(a => {
    const m = a.href.match(/\/id\/(\d+)\//)
    if (!m) return
    const rect = a.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return
    ;(rect.left + rect.width / 2 < midX ? left : right).add(m[1])
  })

  if (left.size > 0 && right.size > 0) {
    return { myTeam: [...left], oppTeam: [...right] }
  }

  // Last resort: return all IDs under one team
  const all = getPlayerIdsFromElement(document.body)
  return all.length > 0 ? { myTeam: all, oppTeam: [] } : null
}

// ── Panel UI ─────────────────────────────────────────────────────────────────

function removePanel() {
  document.getElementById(RI_ID)?.remove()
  document.getElementById('ri-toggle-btn')?.remove()
}

function renderPanel(data) {
  removePanel()

  const panel = document.createElement('div')
  panel.id = RI_ID

  const cats = ['pts','reb','ast','stl','blk','tov','fg3m','fg_pct','ft_pct']
  const labels = { pts:'PTS', reb:'REB', ast:'AST', stl:'STL', blk:'BLK', tov:'TOV', fg3m:'3PM', fg_pct:'FG%', ft_pct:'FT%' }
  const lowerIsBetter = new Set(['tov'])

  const my = data.my_team
  const opp = data.opp_team

  function fmtVal(key, val) {
    if (val == null || isNaN(val)) return '—'
    if (key === 'fg_pct' || key === 'ft_pct') return val.toFixed(1) + '%'
    return val.toFixed(1)
  }

  function rowHTML(cat) {
    const myVal  = my.totals[cat]
    const oppVal = opp.totals[cat]
    const myWins = myVal != null && oppVal != null
      ? (lowerIsBetter.has(cat) ? myVal < oppVal : myVal > oppVal)
      : false
    const oppWins = myVal != null && oppVal != null
      ? (lowerIsBetter.has(cat) ? oppVal < myVal : oppVal > myVal)
      : false
    return `
      <tr>
        <td class="ri-val ${myWins ? 'ri-win' : oppWins ? 'ri-lose' : ''}">${fmtVal(cat, myVal)}</td>
        <td class="ri-cat">${labels[cat]}</td>
        <td class="ri-val ${oppWins ? 'ri-win' : myWins ? 'ri-lose' : ''}">${fmtVal(cat, oppVal)}</td>
      </tr>`
  }

  const unmatchedMy  = my.unmatched.length  ? `<p class="ri-warn">⚠ ${my.unmatched.length} player(s) not found</p>`  : ''
  const unmatchedOpp = opp.unmatched.length ? `<p class="ri-warn">⚠ ${opp.unmatched.length} player(s) not found</p>` : ''

  panel.innerHTML = `
    <div class="ri-header">
      <span class="ri-logo">🏀 Roto Intel</span>
      <button class="ri-close" id="ri-close-btn">✕</button>
    </div>
    <div class="ri-subhead">Projected per-game averages · base scenario</div>
    <div class="ri-teams">
      <span class="ri-team-name">${my.team_name || 'My Team'}</span>
      <span class="ri-team-name ri-team-right">${opp.team_name || 'Opponent'}</span>
    </div>
    <table class="ri-table">
      <tbody>${cats.map(rowHTML).join('')}</tbody>
    </table>
    ${unmatchedMy}${unmatchedOpp}
    <div class="ri-footer">
      <a href="https://app.rotointel.com" target="_blank">Open Roto Intel ↗</a>
    </div>
  `

  document.body.appendChild(panel)
  document.getElementById('ri-close-btn').addEventListener('click', removePanel)
}

function renderError(msg) {
  removePanel()
  const panel = document.createElement('div')
  panel.id = RI_ID
  panel.innerHTML = `
    <div class="ri-header">
      <span class="ri-logo">🏀 Roto Intel</span>
      <button class="ri-close" id="ri-close-btn">✕</button>
    </div>
    <div class="ri-error">${msg}</div>
  `
  document.body.appendChild(panel)
  document.getElementById('ri-close-btn').addEventListener('click', removePanel)
}

function renderLoading() {
  removePanel()
  const panel = document.createElement('div')
  panel.id = RI_ID
  panel.innerHTML = `
    <div class="ri-header">
      <span class="ri-logo">🏀 Roto Intel</span>
      <button class="ri-close" id="ri-close-btn">✕</button>
    </div>
    <div class="ri-loading">
      <div class="ri-spinner"></div>
      <span>Fetching projections…</span>
    </div>
  `
  document.body.appendChild(panel)
  document.getElementById('ri-close-btn').addEventListener('click', removePanel)
}

// ── Toggle button ────────────────────────────────────────────────────────────

function injectToggleButton() {
  if (document.getElementById('ri-toggle-btn')) return

  const btn = document.createElement('button')
  btn.id = 'ri-toggle-btn'
  btn.textContent = '🏀'
  btn.title = 'Roto Intel matchup analysis'
  btn.addEventListener('click', () => {
    if (document.getElementById(RI_ID)) { removePanel(); return }

    const teams = extractTeams()
    if (!teams || (teams.myTeam.length === 0 && teams.oppTeam.length === 0)) {
      renderError('No players found on this page. Navigate to a matchup or scoreboard page.')
      return
    }

    renderLoading()
    chrome.runtime.sendMessage(
      { type: 'FETCH_MATCHUP', myIds: teams.myTeam, oppIds: teams.oppTeam },
      resp => {
        if (resp?.ok) renderPanel(resp.data)
        else renderError('Could not load projections. Make sure you\'re logged in to Roto Intel.')
      }
    )
  })

  document.body.appendChild(btn)
}

// ── Init with MutationObserver ───────────────────────────────────────────────

function init() {
  injectToggleButton()
}

// ESPN is a SPA — wait for content to settle then inject
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

// Re-run on ESPN navigation (URL changes without page reload)
let lastUrl = location.href
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href
    setTimeout(init, 1500)
  }
}).observe(document.body, { childList: true, subtree: true })
