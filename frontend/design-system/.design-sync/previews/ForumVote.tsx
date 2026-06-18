import { ForumVote } from '@roto-intel/ui'

export const Neutral = () => (
  <ForumVote score={0} myVote={0} onVote={() => {}} />
)

export const Upvoted = () => (
  <ForumVote score={7} myVote={1} onVote={() => {}} />
)

export const Downvoted = () => (
  <ForumVote score={-2} myVote={-1} onVote={() => {}} />
)

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
    <ForumVote score={12} myVote={1} onVote={() => {}} />
    <ForumVote score={3} myVote={0} onVote={() => {}} sm />
  </div>
)
