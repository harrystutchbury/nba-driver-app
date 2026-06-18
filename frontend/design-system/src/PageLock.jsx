/**
 * Full-page Pro feature gate. Renders a centred card with icon, title, description, and upgrade CTA.
 * Used when an entire page requires a Pro subscription.
 *
 * @param {{ title?: string, description?: string, ctaLabel?: string, icon?: string, onUpgrade?: () => void }} props
 */
export function PageLock({
  title = 'Pro feature',
  description = 'Upgrade to Pro to unlock this — $20/yr.',
  ctaLabel = 'Upgrade to Pro',
  icon = '🔒',
  onUpgrade,
}) {
  return (
    <div className="progate-page">
      <div className="progate-page-card">
        <div className="progate-page-icon">{icon}</div>
        <h2 className="progate-page-title">{title}</h2>
        <p className="progate-page-sub">{description}</p>
        <button className="progate-page-btn" onClick={onUpgrade}>{ctaLabel}</button>
      </div>
    </div>
  )
}
