import { ZCell } from '@roto-intel/ui'

export const Positive = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <ZCell value="28.4" z={2.1} />
    <ZCell value="9.2" z={1.8} />
    <ZCell value="7.1" z={0.6} />
  </div>
)

export const Negative = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <ZCell value="11.3" z={-1.9} />
    <ZCell value="3.1" z={-0.8} />
  </div>
)

export const Neutral = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <ZCell value="18.0" z={0.1} />
    <ZCell value="5.5" z={-0.3} />
  </div>
)

export const TurnoversInverted = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <ZCell value="1.2" z={-1.5} isTov />
    <ZCell value="3.8" z={1.4} isTov />
  </div>
)
