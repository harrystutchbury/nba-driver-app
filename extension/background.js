const API_BASE = 'https://app.rotointel.com'

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'FETCH_MATCHUP') {
    const { myIds, oppIds } = msg
    const url = `${API_BASE}/api/espn-matchup?my_ids=${myIds.join(',')}&opp_ids=${oppIds.join(',')}`
    fetch(url)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: String(err) }))
    return true // keep channel open for async response
  }
})
