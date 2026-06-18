import { PageLock } from '@roto-intel/ui'

export const Default = () => (
  <PageLock onUpgrade={() => {}} />
)

export const ConnectLeague = () => (
  <PageLock
    icon="🏀"
    title="Connect your fantasy league"
    description="Sign up for free to integrate with ESPN and Yahoo Fantasy and unlock roster analysis, trade tools, matchup planning and more."
    ctaLabel="Sign up free"
    onUpgrade={() => {}}
  />
)

export const TradeAnalysis = () => (
  <PageLock
    icon="📊"
    title="Trade Analysis"
    description="Get data-driven trade grades and player impact analysis. Upgrade to Pro to unlock."
    ctaLabel="Upgrade to Pro · $20/yr"
    onUpgrade={() => {}}
  />
)
