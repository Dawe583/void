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
  index.html       shell, black 44px nav, parchment sub nav, sidebar
  styles.css       Apple tokens from docs/GUI-RULES.md plus chat layer
  fixtures.js      MOCK session, calls, holds, ledger, registry, policy,
                   providers, models, routing, usage, keys
  app.js           hash router, sidebar, palette, shortcuts, status line,
                   theme init, boot sequence, service worker
  manifest.json  PWA shell (installable, standalone, dark chrome)
  sw.js            offline cache for the app shell, network first rest
  js/api.js        real OpenAI compatible client (streaming, models, test)
  views/           one file per view, registered on window.VOID_VIEWS
    chat.js        agent session: streaming, tool cards, plan mode,
                   slash commands, voice input, attachments
    artifacts.js   right drawer for generated files (preview, copy)
    overview.js    dark hero, stats, class mix, recent calls, hub
    intercept.js   one call through classify, policy, model, ledger preview
    live.js        intercepted call feed with pause and filter
    holds.js       approval queue, compensation plan, SLA timer,
                   focus mode, j/k/a/d keys
    ledger.js      chain browser, full entry schema, focus mode,
                   working verify
    registry.js    case explorer with first match evaluator
    policy.js      rules with toggles, approval channel
    providers.js   gateway, direct, local, BYOK keys, real test
    models.js      catalog, routing, fallbacks, spend, request log
    replay.js      preview then commit gate, timeline, attestation export
    sessions.js    wrapped agent sessions, transports, posture
    connectors.js  postgres and S3 undo plus snapshot store
    facts.js       declared facts, probe cache, mock probe run
    taint.js       read to write edges plus scope query
    audit.js       period export, frame map, verifier, forgers
    cli.js         command builder with copy and exit codes
    github.js      token login, profile, repos, open PRs (real API)
    settings.js    posture, keys, policy source, channels
    shortcuts.js   cheatsheet, press ?
```

## Chat is real, governance is mock

Chat calls your configured provider for real (key in Providers,
stored in this browser only). Attachments work like Claude:
images (JPEG, PNG, GIF, WebP, downscaled), PDF and DOCX (text
extracted locally), any text or code file inlined, anything else
inserted as a filename reference. Max 20 files per chat, 30 MB
per file, 5 MB per image. Everything else (holds, ledger,
replay, audit) is an interactive local simulation of the VOID
write path, clearly labeled mock.

## File generation

Every code block has Copy and Download (extension follows the
language: py, js, ts, html, css, json, md, sh, sql and more).
Every assistant reply has Save file (markdown). Whole chats
export to markdown or JSON.

## Shortcuts

Cmd or Ctrl K palette, Cmd or Ctrl N new chat, Cmd or Ctrl 1-4
chat/holds/ledger/replay, Enter send, Shift Enter newline,
Esc stop or close, ? cheatsheet, j/k move, a approve, d refuse.

## Desktop path

This bundle is a plain static site on purpose. A later Tauri or
Electron shell can wrap `gui-web/` without a bundler change.
Native work (tray, global keys, local proxy socket) stays out of
this branch until the core proxy and ledger land on main.

## Design

VOID Aperture, exactly like apps/tui-preview: warm near-black paper,
single orange accent, mono labels, serif display, ASCII glyphs,
no gradients, one soft shadow reserved for palette and drawers.
Dark first, light theme fully supported, theme toggle in nav,
system font stacks only, fully offline except provider calls
and the optional PDF/DOCX engines from CDN.
