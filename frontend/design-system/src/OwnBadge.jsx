/**
 * Fantasy ownership status badge.
 * Shows whether the player is on your roster, another team's, or a free agent.
 *
 * @param {{ status: 'mine'|'taken'|'fa' }} props
 */
export function OwnBadge({ status }) {
  if (status === 'mine')  return <span className="own-badge own-mine">Mine</span>
  if (status === 'taken') return <span className="own-badge own-taken">Taken</span>
  if (status === 'fa')    return <span className="own-badge own-fa">FA</span>
  return null
}
