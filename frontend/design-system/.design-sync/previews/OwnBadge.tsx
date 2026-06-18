import { OwnBadge } from '@roto-intel/ui'

export const AllStatuses = () => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
    <OwnBadge status="mine" />
    <OwnBadge status="taken" />
    <OwnBadge status="fa" />
  </div>
)

export const InContext = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    {[
      { name: 'Anthony Edwards', status: 'mine' as const },
      { name: 'Nikola Jokić', status: 'taken' as const },
      { name: 'Collin Flagg', status: 'fa' as const },
    ].map(p => (
      <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <span style={{ color: 'var(--text)' }}>{p.name}</span>
        <OwnBadge status={p.status} />
      </div>
    ))}
  </div>
)
