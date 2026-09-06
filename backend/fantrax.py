"""
Fantrax integration.

Fantrax has no public/official API and no OAuth for third-party apps. The only
way to read a league is to POST to its internal endpoint (fantrax.com/fxpa/req)
the same way the browser does, authenticated with the member's session cookies.

We therefore store the user's Fantrax cookies (server-side, in
fantasy_connections.access_token as a JSON blob) plus their league id
(league_key), and replay requests with a requests.Session.

Request format (reverse-engineered; matches the community `fantraxapi` wrapper):
    POST https://www.fantrax.com/fxpa/req?leagueId=<id>
    body: {"msgs": [{"method": "<name>", "data": {"leagueId": "<id>", ...}}]}
    -> {"responses": [{"data": {...}}, ...]}  (aligned with msgs order)

Cookies expire periodically, so callers should surface a "reconnect" state
when NotLoggedIn is raised rather than failing silently.
"""

from __future__ import annotations

import requests

FXPA_URL = "https://www.fantrax.com/fxpa/req"

# Browser-ish headers. Fantrax will 403 / return pageError without a plausible
# UA + JSON content type.
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://www.fantrax.com",
    "Referer": "https://www.fantrax.com/fantasy/league",
}


class FantraxError(Exception):
    """Generic Fantrax API error."""


class FantraxNotLoggedIn(FantraxError):
    """Cookies are missing/expired — the user must reconnect."""


class FantraxNotMember(FantraxError):
    """Authenticated, but not a member of the requested league."""


def parse_cookie_string(raw: str) -> dict:
    """Turn a copied `Cookie:` header (or `name=value; name2=value2`) into a dict.

    Accepts the whole document.cookie / DevTools cookie string; we keep every
    pair and let Fantrax decide which it needs.
    """
    cookies: dict[str, str] = {}
    if not raw:
        return cookies
    # Strip a leading "Cookie:" if the user pasted the full header line.
    raw = raw.strip()
    if raw.lower().startswith("cookie:"):
        raw = raw.split(":", 1)[1]
    for part in raw.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, value = part.split("=", 1)
        name, value = name.strip(), value.strip()
        if name:
            cookies[name] = value
    return cookies


class FantraxClient:
    """Thin client over the fxpa/req endpoint, authenticated with cookies."""

    def __init__(self, league_id: str, cookies: dict | None = None, timeout: float = 20.0):
        self.league_id = str(league_id)
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(_HEADERS)
        if cookies:
            for name, value in cookies.items():
                self.session.cookies.set(name, value, domain=".fantrax.com")

    # ── low-level ────────────────────────────────────────────────────────────
    def _msg_block(self, method: str, **data) -> dict:
        block_data = {"leagueId": self.league_id}
        for k, v in data.items():
            if v is not None:
                block_data[k] = v
        return {"method": method, "data": block_data}

    def call(self, methods) -> list[dict] | dict:
        """POST one or many methods. Returns the single `data` dict, or a list
        of `data` dicts when given a list of methods."""
        single = not isinstance(methods, list)
        blocks = [methods] if single else methods
        json_data = {"msgs": [self._normalise(b) for b in blocks]}
        try:
            resp = self.session.post(
                FXPA_URL, params={"leagueId": self.league_id},
                json=json_data, timeout=self.timeout,
            )
        except requests.RequestException as e:
            raise FantraxError(f"Fantrax request failed: {e}")

        try:
            body = resp.json()
        except ValueError:
            raise FantraxError(
                f"Fantrax returned non-JSON (status {resp.status_code}); "
                "cookies or league id are probably wrong."
            )

        page_error = body.get("pageError") or {}
        code = page_error.get("code")
        if code == "WARNING_NOT_LOGGED_IN":
            raise FantraxNotLoggedIn("Fantrax session expired — reconnect required.")
        if code == "NOT_MEMBER_OF_LEAGUE":
            raise FantraxNotMember("Authenticated user is not a member of this league.")
        if code:
            raise FantraxError(page_error.get("title") or str(page_error))
        if resp.status_code >= 400:
            raise FantraxError(f"Fantrax HTTP {resp.status_code}: {body}")

        responses = body.get("responses") or []
        datas = [r.get("data", {}) for r in responses]
        if single:
            return datas[0] if datas else {}
        return datas

    @staticmethod
    def _normalise(block) -> dict:
        """Accept a dict {method, data}, or a ('method', {...}) tuple."""
        if isinstance(block, dict) and "method" in block:
            return block
        if isinstance(block, (list, tuple)) and len(block) == 2:
            return {"method": block[0], "data": block[1]}
        raise FantraxError(f"Bad method block: {block!r}")

    def _method(self, name: str, **data) -> dict:
        return self._msg_block(name, **data)

    # ── typed helpers ─────────────────────────────────────────────────────────
    def league_info(self) -> dict:
        """getFantasyLeagueInfo — league name, teams, and scoring configuration."""
        return self.call(self._method("getFantasyLeagueInfo"))

    def standings(self, view: str = "STANDINGS") -> dict:
        """getStandings — team standings (and, with view=SCHEDULE, matchups)."""
        return self.call(self._method("getStandings", view=view))

    def team_roster(self, team_id: str, period: int | None = None) -> dict:
        """getTeamRosterInfo (STATS view) — a team's roster with player stats."""
        return self.call(self._method("getTeamRosterInfo", teamId=team_id, period=period, view="STATS"))

    def raw(self, method: str, **data) -> dict:
        """Escape hatch for calling any method while mapping response shapes."""
        return self.call(self._method(method, **data))


# ── response parsers ──────────────────────────────────────────────────────────
# Field shapes confirmed against a real league's getStandings / getTeamRosterInfo
# responses (see the community fantraxapi wrapper for the populated-roster shape):
#   roster: resp["tables"][i]["rows"][j] with "posId", "statusId", optional
#           "scorer" {scorerId,name,teamName,posShortNames,...}, and "cells"
#           aligned to header cells; FP columns are the header cells whose
#           "sortKey" is "SCORE" (total FP) and "FPTS_PER_GAME" (FP/game).
#   standings: resp["tableList"][k] with tableType (e.g. "H2hPointsBased1"),
#           header.cells[].key, rows[].cells[].content, rows[].fixedCells
#           ([rank, {content:teamName, teamId}]).


def _to_float(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(",", "").strip()
    if s in ("", "-", "—"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _to_int(v):
    f = _to_float(v)
    return int(f) if f is not None else None


def is_points_league(standings: dict) -> bool:
    """Detect a points-scoring league from the standings table type."""
    for table in (standings or {}).get("tableList", []) or []:
        if "point" in str(table.get("tableType", "")).lower():
            return True
    return False


def parse_teams(standings: dict) -> dict:
    """Return {team_id: {name, short_name}} from getStandings.fantasyTeamInfo."""
    out = {}
    info = (standings or {}).get("fantasyTeamInfo") or {}
    for tid, t in info.items():
        out[str(tid)] = {"name": t.get("name"), "short_name": t.get("shortName")}
    return out


def parse_standings(standings: dict) -> list:
    """Return a list of standings rows: {rank, team_id, name, <header keys...>}."""
    rows_out = []
    for table in (standings or {}).get("tableList", []) or []:
        if table.get("caption") != "Standings":
            continue
        header = (table.get("header") or {}).get("cells") or []
        keys = [(h.get("key") or h.get("shortName") or f"c{i}") for i, h in enumerate(header)]
        for row in table.get("rows") or []:
            fixed = row.get("fixedCells") or []
            rank = fixed[0].get("content") if len(fixed) > 0 and isinstance(fixed[0], dict) else None
            team_cell = fixed[1] if len(fixed) > 1 and isinstance(fixed[1], dict) else {}
            entry = {
                "rank": _to_int(rank),
                "team_id": team_cell.get("teamId"),
                "name": team_cell.get("content"),
            }
            for k, cell in zip(keys, row.get("cells") or []):
                entry[k] = cell.get("content") if isinstance(cell, dict) else cell
            rows_out.append(entry)
    return rows_out


def parse_roster(roster_resp: dict) -> list:
    """Return a list of rostered players from a getTeamRosterInfo (STATS) response.

    Each player: {id, name, team, pos, pos_id, status_id, fantasy_points,
    fantasy_points_per_game}. Empty roster slots (no "scorer") are skipped.
    """
    players = []
    for group in (roster_resp or {}).get("tables", []) or []:
        header = (group.get("header") or {}).get("cells") or []
        for row in group.get("rows") or []:
            scorer = row.get("scorer")
            if not scorer:
                continue  # empty slot
            total_fp = fppg = None
            for h, cell in zip(header, row.get("cells") or []):
                if not isinstance(cell, dict):
                    continue
                sk = h.get("sortKey")
                if sk == "SCORE":
                    total_fp = _to_float(cell.get("content"))
                elif sk == "FPTS_PER_GAME":
                    fppg = _to_float(cell.get("content"))
            players.append({
                "id":         scorer.get("scorerId"),
                "name":       scorer.get("name"),
                "team":       scorer.get("teamName"),
                "pos":        scorer.get("posShortNames"),
                "pos_id":     row.get("posId"),
                "status_id":  row.get("statusId"),
                "fantasy_points":          total_fp,
                "fantasy_points_per_game": fppg,
            })
    return players


def client_from_row(row) -> FantraxClient:
    """Build a client from a fantasy_connections row (access_token = JSON cookies)."""
    import json as _json
    cookies = {}
    if row and row["access_token"]:
        try:
            cookies = _json.loads(row["access_token"])
        except (ValueError, TypeError):
            cookies = parse_cookie_string(row["access_token"])
    return FantraxClient(str(row["league_key"]), cookies=cookies)
