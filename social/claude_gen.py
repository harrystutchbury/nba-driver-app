"""Claude API content generation for the social pipeline."""

import os
import logging
import anthropic

log = logging.getLogger(__name__)

_CLIENT = None

SYSTEM_PROMPT = (
    "You are the Roto Intel content writer. Write sharp, direct, data-driven fantasy "
    "basketball content. Lead with the number, follow with the insight. Never use hype "
    "language like MUST ADD or LEAGUE WINNER. Write for serious fantasy players who can "
    "handle real analysis. Maximum two sentences per tweet. Active voice. Specific "
    "numbers always. Example: 'Jaren Jackson Jr. BLK rate up 34% in the last 14 days. "
    "Still available in 40% of leagues.'"
)


def _client() -> anthropic.Anthropic:
    global _CLIENT
    if _CLIENT is None:
        _CLIENT = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _CLIENT


def _ask(prompt: str, max_tokens: int = 512) -> str:
    msg = _client().messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=max_tokens,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text.strip()


def weekly_performers_tweet(players: list[dict]) -> str:
    """Single tweet for the weekly best performers post."""
    names = ", ".join(
        f"{p['name']} ({p.get('team','')}) — {p.get('period_value', 0):.1f} PV"
        for p in players[:3]
    )
    prompt = (
        f"Write a tweet (max 240 chars) introducing this week's top fantasy performers: {names}. "
        "Reference period value scores. End with a forward-looking hook. No hashtags."
    )
    return _ask(prompt, 200)


def weekly_performers_thread(players: list[dict]) -> list[str]:
    """Follow-up thread replies breaking down top performers by category."""
    tweets = []
    for p in players[:5]:
        top_cats = _top_categories(p)
        prompt = (
            f"Write one tweet (max 240 chars) about {p['name']} ({p.get('team','')}) "
            f"for fantasy basketball. Their top projected categories this week are: "
            f"{top_cats}. Be specific. No hashtags."
        )
        tweets.append(_ask(prompt, 200))
    return tweets


def risers_fallers_tweet(risers: list[dict], fallers: list[dict]) -> str:
    top_riser = risers[0] if risers else None
    top_faller = fallers[0] if fallers else None
    prompt = (
        "Write a tweet (max 240 chars) about this week's biggest fantasy movers. "
    )
    if top_riser:
        prompt += (
            f"Biggest riser: {top_riser['name']} ({top_riser.get('team','')}) "
            f"z-score delta +{top_riser.get('z_delta', 0):.2f}. "
        )
    if top_faller:
        prompt += (
            f"Biggest faller: {top_faller['name']} ({top_faller.get('team','')}) "
            f"z-score delta {top_faller.get('z_delta', 0):.2f}. "
        )
    prompt += "Sharp and direct. No hashtags."
    return _ask(prompt, 200)


def deepdive_tweet(player: dict) -> str:
    prompt = (
        f"Write a tweet (max 240 chars) deep-diving on {player['name']} "
        f"({player.get('team','')}) for fantasy basketball. "
        f"Their recent z-score is {player.get('z_total', 0):.2f} vs season average of "
        f"{player.get('z_base', 0):.2f} — that's a delta of {player.get('z_delta', 0):+.2f}. "
        "Explain what this means for fantasy managers in one or two sentences. No hashtags."
    )
    return _ask(prompt, 200)


def best_performances_thread(games: list[dict]) -> list[str]:
    tweets = []
    for g in games:
        stats_str = _game_stat_line(g)
        prompt = (
            f"Write one tweet (max 240 chars) about {g['name']} ({g.get('team','')}) "
            f"having a standout game vs {g.get('opponent','')} on {g.get('game_date','')}: "
            f"{stats_str}. Highlight what made this performance special. No hashtags."
        )
        tweets.append(_ask(prompt, 200))
    return tweets


def daily_overall_tweet(players: list[dict]) -> str:
    names = ", ".join(
        f"{p['name']} ({p.get('team','')})"
        for p in players[:3]
    )
    prompt = (
        f"Write a tweet (max 240 chars) about tomorrow's top fantasy performers: {names}. "
        "Focus on schedule spot and projected output. No hashtags."
    )
    return _ask(prompt, 200)


def daily_waiver_tweet(players: list[dict]) -> str:
    names = ", ".join(
        f"{p['name']} ({p.get('team','')})"
        for p in players[:3]
    )
    prompt = (
        f"Write a tweet (max 240 chars) about tomorrow's best available free agents: {names}. "
        "Focus on streamable value and matchup. No hashtags."
    )
    return _ask(prompt, 200)


def daily_category_tweet(leaders: dict) -> str:
    lines = [
        f"{cat.upper()}: {p['name']} ({p.get('team','')}) — {p.get(cat, '?')}"
        for cat, p in list(leaders.items())[:4]
    ]
    prompt = (
        f"Write a tweet (max 240 chars) listing tomorrow's projected category leaders: "
        f"{'; '.join(lines)}. Tight and specific. No hashtags."
    )
    return _ask(prompt, 200)


def instagram_caption(content_type: str, players: list[dict], hashtags: bool = True) -> str:
    names = ", ".join(p.get("name", "") for p in players[:5])
    prompt = (
        f"Write an Instagram caption (2-3 sentences max) for a Roto Intel {content_type} post "
        f"featuring: {names}. Data-driven, sharp tone. "
    )
    if hashtags:
        prompt += (
            "End with these hashtags on a new line: "
            "#FantasyBasketball #NBA #RotoIntel #FantasyBball #NBApicks"
        )
    return _ask(prompt, 350)


def _top_categories(player: dict, n: int = 3) -> str:
    cats = ["pts", "reb", "ast", "stl", "blk", "fg3m"]
    scored = [
        (cat, player.get(cat) or 0)
        for cat in cats
        if player.get(cat) is not None
    ]
    scored.sort(key=lambda x: x[1], reverse=True)
    return ", ".join(f"{cat.upper()} {val:.1f}" for cat, val in scored[:n])


def _game_stat_line(game: dict) -> str:
    parts = []
    for cat in ["pts", "reb", "ast", "stl", "blk", "fg3m"]:
        if game.get(cat):
            parts.append(f"{game[cat]} {cat.upper()}")
    return "/".join(parts[:4])
