/**
 * Z-score stat cell — displays a raw stat value with its z-score below it.
 * Colours the z-score label green (elite), red (poor), or muted (average).
 * Used throughout box score and player stat tables.
 *
 * @param {{ value: string|number, z: number, isTov?: boolean }} props
 */
export function ZCell({ value, z, isTov }) {
  const good = isTov ? z < -0.5 : z > 0.5
  const bad  = isTov ? z > 0.5  : z < -0.5
  const cls  = good ? 'z-pos' : bad ? 'z-neg' : 'z-neu'
  return (
    <div className={`bs-stat-cell ${cls}`}>
      <span className="bs-val">{value}</span>
      <span className="bs-z">{z > 0 ? '+' : ''}{z.toFixed(1)}</span>
    </div>
  )
}
