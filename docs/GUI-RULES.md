# VOID GUI design rules

## Shared React application

The active web application lives in `apps/control-plane/ui`. Vite emits
`dist/web`; the local server, desktop package and Vercel serve the same build.
The retained `apps/control-plane/web` source is a compatibility reference and
must not be used as the starting point for new UI features.

- Use the paper-terminal colors defined in `ui/src/styles.css`. System, light
  and dark appearances share semantic tokens. Keep a visible focus outline.
- Use the shared shell and named routes. Chat occupies a bounded transcript
  with a separate composer. Never make the whole viewport scroll to reach Send.
- Desktop panels use CSS Grid and adjustable, bounded widths. Mobile navigation
  uses a drawer and safe-area-aware bottom bar; context becomes a full panel.
- Dialogs use native modal behavior. Restore focus after closing or replacing
  controls. Background surfaces cannot receive input behind mobile overlays.
- Body text uses system sans; headings may use serif. Monospace belongs to code
  and identifiers. Actions have at least 44 px touch targets.
- Reuse `DataTable`, `Dialog`, `ErrorBox` and the query client. Lists filter on the
  server. Preserve the displayed page when newer data arrives; offer Refresh.
- A completed assistant message replaces its streamed fragments. Merge tool
  cards by call ID; preserve arguments and results. Never execute partial calls.
- Render Markdown through the parser, with raw HTML disabled. Syntax highlighting
  loads on demand. Treat all model and connector output as untrusted content.
- Document edits require the displayed revision. Preserve unsaved content on a
  conflict. Undo requires a fresh server preview and updates the editor revision.
- Distinguish signed, verified, unavailable and unknown. A catalog model named
  Free is not evidence of a zero invoice. Do not invent limits or metrics.
- Default new conversations to TokenRouter / `z-ai/glm-5.3-free`. Credentials
  remain server-side. Existing conversations retain their provider snapshot.
- UI defaults to Czech and supports English. Dates and numbers follow the active
  locale; API names, model names and conversation content remain unchanged.

Validate changes with `pnpm run typecheck`, `pnpm test`, `pnpm build:web` and the
relevant browser flow. Use `pnpm desktop:test` for shared runtime changes. Check
320 px mobile layout, desktop layout, keyboard controls and long content.

## Current visual direction, 2026-09-11

The user explicitly requested the ASCII identity of Dawe583/void-empty. This
supersedes the literal Apple marketing palette and rounded-card grammar below.
The shared stylesheet is the only layout source; duplicate inline page styles
were removed. Use paper #f6f0e3, panels #efe8d8, ink #12100a, burnt orange actions,
serif display headings and monospace labels. The dark theme uses CRT-like neutral
surfaces. ASCII symbols are text, with accessible labels on controls.

Retain Apple's functional principles: clear hierarchy, system body text at 17px,
44px minimum touch controls, visible keyboard focus, responsive content, readable
contrast and native accessible dialogs. On narrow screens, data rows reflow and
navigation stays in a safe-area-aware bottom bar. Never shrink a desktop canvas
to fit a phone. Pause freezes the feed, not proxy execution or pending holds.

## Historical Apple reference

The following reference is retained for provenance. Its exact branding tokens
are not the current VOID visual specification.

Authoritative source: /Users/dawe/.prime/agent/skills/awesome-design-md/references/apple/DESIGN.md

COLORS: Action Blue #0066cc (the ONLY interactive color; focus #0071e3; on-dark links #2997ff). Ink #1d1d1f. White #ffffff canvas, parchment #f5f5f7 alternating sections, pearl #fafafc, dark tiles #272729/#2a2a2c/#252527, black #000000 nav only. Hairline #e0e0e0, divider #f0f0f0.
NO second accent color. NO decorative gradients. NO shadows on cards/buttons/text (single product shadow rgba(0,0,0,0.22) 3px 5px 30px reserved for imagery).

TYPE: SF Pro Display/Text, system-ui fallback (Inter off-system, letter-spacing -0.01em display, line-height 1.44 body). hero 56/600/1.07/-0.28px; display-lg 40/600; display-md 34/600/-0.374px; lead 28/400; tagline 21/600; body-strong 17/600; body 17/400/1.47/-0.374px (NOT 16px); caption 14/400/-0.224px; fine-print 12; nav 12.
Weights ONLY 300/400/600/700, never 500. Negative letter-spacing at display sizes only.

CORNERS (the scale, never mix grammars): xs 5px, sm 8px (utility buttons), md 11px (pearl capsules), lg 18px (utility/store cards), pill 9999px (primary CTAs, chips, search), full 9999px circles. Full-bleed tiles are NOT rounded.

SPACING: base 8; xxs 4, xs 8, sm 12, md 17, lg 24 (card padding), xl 32, xxl 48, section 80 (tile padding). Content max 1440 (store) / 980 (text).

BUTTONS: primary = Action Blue pill, 17px text, padding 11x22, active scale(0.95), focus 2px #0071e3 outline. Secondary = ghost pill (transparent, 1px blue border). Dark utility = #1d1d1f bg, sm 8px radius, 14px text. Pearl capsule = #fafafc bg, 3px divider ring, md 11px, 14px. Icon circular = 44x44, rgba(210,210,215,.64), full.

NAV: global nav black 44px, 12px links. Sub-nav parchment 80% + blur, 52px, 21px category + persistent primary CTA right.

CARDS: store-utility-card = white, 1px hairline, lg 18px, 24px padding, no shadow, 1:1 image inside sm 8px radius. Tiles = full-bleed, 80px padding, light/parchment/dark alternation is the divider.

FOOTER: parchment, 17px/2.41 dense links, 64px padding, legal 12px #7a7a7a.

ACTIVE STATE: transform scale(0.95) on every button. Min touch target 44x44.

BREAKPOINTS: 1440 lock, 1068, 834, 734, 640, 480. Hero 56 -> 40 (1068) -> 34 (640) -> 28 (419).
