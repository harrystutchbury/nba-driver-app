import { SectionLock } from '@roto-intel/ui'

export const Default = () => (
  <div style={{ padding: '0 16px' }}>
    <SectionLock onUpgrade={() => {}} />
  </div>
)

export const CustomLabel = () => (
  <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
    <SectionLock label="Matchup projections — Pro only" onUpgrade={() => {}} />
    <SectionLock label="Advanced driver breakdown" ctaLabel="Upgrade · $20/yr" onUpgrade={() => {}} />
  </div>
)
