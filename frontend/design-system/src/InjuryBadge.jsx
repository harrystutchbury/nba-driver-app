const INJ_COLORS = {
  'Out':          { bg: '#ff4444', text: '#fff' },
  'Doubtful':     { bg: '#ff7700', text: '#fff' },
  'Questionable': { bg: '#ccaa00', text: '#000' },
  'Day-To-Day':   { bg: '#ccaa00', text: '#000' },
}

/**
 * Player injury status badge. Shows designation label with colour coding.
 * Optionally shows expected return date beneath the badge.
 *
 * @param {{ designation: 'Out'|'Doubtful'|'Questionable'|'Day-To-Day', description?: string, returnDate?: string, compact?: boolean }} props
 */
export function InjuryBadge({ designation, description, returnDate, compact }) {
  if (!designation) return null
  const colors = INJ_COLORS[designation] ?? { bg: '#555', text: '#fff' }
  const label = compact
    ? (designation === 'Questionable' || designation === 'Day-To-Day' ? 'GTD' : designation === 'Doubtful' ? 'DBT' : 'OUT')
    : designation
  const fmtDate = d => {
    const [y, m, day] = d.split('-')
    return new Date(+y, +m - 1, +day).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  }
  const tooltip = [description || designation, returnDate ? `Expected Return: ${fmtDate(returnDate)}` : null]
    .filter(Boolean).join(' · ')
  return (
    <span className="inj-badge-wrap">
      <span className="inj-badge" style={{ background: colors.bg, color: colors.text }} title={tooltip}>
        {label}
      </span>
      {!compact && returnDate && (
        <span className="inj-return-date">Expected Return {fmtDate(returnDate)}</span>
      )}
    </span>
  )
}
