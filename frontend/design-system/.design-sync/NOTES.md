# Design-sync notes — @roto-intel/ui

## Build

- Run the build with: `node /Users/harry/projects/nba-driver-app/frontend/design-system/build.mjs`
- **Node modules**: point at `frontend/node_modules` (not `design-system/node_modules`) — React is hoisted to the parent.
- **Plain JS package** (no TypeScript): components are in `.jsx`. The converter finds them via `componentSrcMap` (all 6 listed in config.json). Prop types are hand-written in `dtsPropsFor`.

## CWD quirk — previews must be at `frontend/.design-sync/previews/`

The converter resolves `.design-sync/previews` relative to the process CWD. The Claude Code Bash tool's CWD is pinned to `frontend/`, so authored previews must live at `frontend/.design-sync/previews/<Name>.tsx` (not inside `design-system/.design-sync/previews/`). The canonical source for preview files is `design-system/.design-sync/previews/` (committed there) — copy them to `frontend/.design-sync/previews/` before rebuilding:
```bash
cp design-system/.design-sync/previews/*.tsx .design-sync/previews/
```

## Re-sync command

```bash
caffeinate node /Users/harry/projects/nba-driver-app/frontend/design-system/.ds-sync/package-build.mjs \
  --config /Users/harry/projects/nba-driver-app/frontend/design-system/.design-sync/config.json \
  --node-modules /Users/harry/projects/nba-driver-app/frontend/node_modules \
  --entry /Users/harry/projects/nba-driver-app/frontend/design-system/dist/index.es.js \
  --out /Users/harry/projects/nba-driver-app/frontend/design-system/ds-bundle
```

## Re-sync risks

- **Tokens**: CSS custom properties are inlined from `src/tokens.css`. If new tokens are added to `frontend/src/index.css`, manually add them to the design-system's `src/tokens.css` too.
- **Component extraction**: components were extracted manually from `frontend/src/App.jsx`. If those originals change significantly (e.g. ZCell switches from `div` to `td`), update the design-system src to match.
- **dtsPropsFor**: prop types are hand-written; they won't auto-update if props change in source.
- **Fonts**: DM Mono and Space Grotesk load via Google Fonts remote @import (`runtimeFontPrefixes` set). In offline/sandboxed environments they won't load.
