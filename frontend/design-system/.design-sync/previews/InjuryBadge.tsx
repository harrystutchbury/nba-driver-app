import { InjuryBadge } from '@roto-intel/ui'

export const AllStatuses = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <InjuryBadge designation="Out" description="Right knee sprain" />
    <InjuryBadge designation="Doubtful" description="Ankle soreness" />
    <InjuryBadge designation="Questionable" description="Back tightness" returnDate="2026-03-15" />
    <InjuryBadge designation="Day-To-Day" description="Hip flexor" returnDate="2026-03-12" />
  </div>
)

export const Compact = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <InjuryBadge designation="Out" compact />
    <InjuryBadge designation="Doubtful" compact />
    <InjuryBadge designation="Questionable" compact />
    <InjuryBadge designation="Day-To-Day" compact />
  </div>
)

export const WithReturnDate = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <InjuryBadge designation="Questionable" description="Hamstring tightness" returnDate="2026-03-20" />
    <InjuryBadge designation="Out" description="Season-ending surgery" />
  </div>
)
