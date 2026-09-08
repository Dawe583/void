# VOID Workbench, web preview

Static zero dependency prototype of the future VOID desktop app.
It previews the workbench as a web app first, so the interaction
model can be reviewed before any native shell exists.

## Run

```
cd gui-web
python3 -m http.server 4173
```

Open http://localhost:4173/index.html

No install, no build, no network calls. Every view renders from
`fixtures.js`, which is illustrative mock data. Nothing came from
a live session.

## Structure

```
gui-web/
  index.html       shell, black 44px nav, parchment sub nav, tabs
  styles.css       Apple tokens from docs/GUI-RULES.md
  fixtures.js      MOCK session, calls, holds, ledger, registry, policy
  app.js           hash router, toast, status line
  views/           one file per view, registered on window.VOID_VIEWS
    overview.js    hero, stats, class mix, recent calls
    live.js        intercepted call feed with pause and filter
    holds.js       approval queue, approve or refuse
    ledger.js      chain browser, search, mock verify
    registry.js    case explorer with first match evaluator
    policy.js      rules with toggles, approval channel
    replay.js      inverse plan plus attestation export
```

## Desktop path

This bundle is a plain static site on purpose. A later Tauri or
Electron shell can wrap `gui-web/` without a bundler change.
Native work (tray, global keys, local proxy socket) stays out of
this branch until the core proxy and ledger land on main.

## Design

Tokens follow `docs/GUI-RULES.md`: Action Blue #0066cc is the only
interactive color, system type, pill primary CTAs, hairline cards
with no shadow, 44px touch targets, reduced motion collapse.
Layout dials used: variance 6, motion 4, density 5.
