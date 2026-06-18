/**
 * Inline section-level Pro feature gate.
 * A horizontal bar with lock icon, label, and upgrade CTA button.
 * Used when a section within a page requires a Pro subscription.
 *
 * @param {{ label?: string, ctaLabel?: string, onUpgrade?: () => void }} props
 */
export function SectionLock({
  label = 'Pro feature',
  ctaLabel = 'Upgrade to Pro · $20/yr',
  onUpgrade,
}) {
  return (
    <div className="progate-section">
      <span className="progate-lock-icon">🔒</span>
      <span className="progate-lock-label">{label}</span>
      <button className="progate-lock-btn" onClick={onUpgrade}>{ctaLabel}</button>
    </div>
  )
}
