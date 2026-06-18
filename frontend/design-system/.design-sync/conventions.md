# Roto Intel UI — Design Agent Conventions

## Setup

No provider wrapper required. Components are self-contained.

The design system is **dark-first**: set `background: var(--bg)` (`#0a0e1a`) on the page root and `color: var(--text)` (`#ffffff`). For light mode add `data-theme="light"` to the root element.

Import the stylesheet before using components:
```html
<link rel="stylesheet" href="styles.css" />
```

Fonts (Space Grotesk, DM Mono) load from Google Fonts via the stylesheet — no extra setup.

## Styling idiom — CSS custom properties

Style with the token vocabulary from `styles.css`. Never invent class names; use `var(--*)` for colours and the component class names for layout.

| Token | Value (dark) | Use |
|---|---|---|
| `--bg` | `#0a0e1a` | Page background |
| `--surface` | `#141824` | Cards, panels |
| `--border` | `#1e2740` | Dividers, outlines |
| `--text` | `#ffffff` | Primary text |
| `--muted` | `#8892a4` | Secondary / meta text |
| `--label` | `#b8c4d8` | Field labels |
| `--accent` | `#00e676` | Primary CTA, highlights, active states |
| `--skill` | `#00e676` | Positive z-scores, elite performance |
| `--neg` | `#ff4d6a` | Negative values, bad stats |
| `--pos` | `#ffd060` | Warnings, caution |
| `--role` | `#7c8cff` | Role/volume stats (purple) |
| `--opponent` | `#ffb84d` | Opponent context |
| `--mono` | DM Mono | Numbers, stat values, badges |
| `--sans` | Space Grotesk | All other text |

## Component reference

Read `components/general/<Name>/<Name>.d.ts` for each component's prop API. Read `components/general/<Name>/<Name>.prompt.md` for usage guidance.

Key components:

- **ZCell** — stat cell with z-score. `value` = display string, `z` = z-score float, `isTov` = invert colour (turnovers)
- **InjuryBadge** — player injury tag. `designation` one of `'Out'|'Doubtful'|'Questionable'|'Day-To-Day'`; `compact` shows short form (OUT/DBT/GTD)
- **OwnBadge** — fantasy ownership. `status` one of `'mine'|'taken'|'fa'`
- **PageLock** — full-page pro gate card with icon, title, description, and CTA button
- **SectionLock** — inline section gate bar with lock icon and CTA
- **ForumVote** — up/down vote widget. `score` = current total, `myVote` = -1|0|1, `sm` = compact

## Idiomatic snippet

```jsx
import { ZCell, InjuryBadge, OwnBadge } from '@roto-intel/ui'

function PlayerRow({ player }) {
  return (
    <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
      <td style={{ color: 'var(--text)', fontFamily: 'var(--sans)', padding: '8px 12px' }}>
        {player.name}
        <OwnBadge status={player.ownershipStatus} />
        <InjuryBadge designation={player.injury} compact />
      </td>
      <ZCell value={player.pts.toFixed(1)} z={player.ptsZ} />
      <ZCell value={player.reb.toFixed(1)} z={player.rebZ} />
      <ZCell value={player.to.toFixed(1)} z={player.toZ} isTov />
    </tr>
  )
}
```
