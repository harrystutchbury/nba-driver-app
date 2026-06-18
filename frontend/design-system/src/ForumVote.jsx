/**
 * Up/down vote widget used on forum posts and comments.
 * Score turns green when positive, red when negative.
 *
 * @param {{ score: number, myVote: -1|0|1, onVote: (v: -1|0|1) => void, sm?: boolean }} props
 */
export function ForumVote({ score, myVote, onVote, sm }) {
  return (
    <div className={`forum-vote-col${sm ? ' sm' : ''}`}>
      <button
        className={`forum-vote-btn up${myVote === 1 ? ' active' : ''}${sm ? ' sm' : ''}`}
        onClick={e => { e.stopPropagation(); onVote(myVote === 1 ? 0 : 1) }}
      >▲</button>
      <span className={`forum-score${sm ? ' sm' : ''} ${score > 0 ? 'pos' : score < 0 ? 'neg' : ''}`}>
        {score}
      </span>
      <button
        className={`forum-vote-btn dn${myVote === -1 ? ' active' : ''}${sm ? ' sm' : ''}`}
        onClick={e => { e.stopPropagation(); onVote(myVote === -1 ? 0 : -1) }}
      >▼</button>
    </div>
  )
}
