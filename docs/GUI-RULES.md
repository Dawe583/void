# Apple design rules for VOID GUI (from awesome-design-md references/apple/DESIGN.md)

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

## Operational workbench, September 2026

The awesome-design-md Apple reference was read directly for this pass, together
with frontend-design. Use its system typography, neutral surfaces, focus blue,
44px controls and quiet hierarchy for operational content. Do not turn an agent
workspace into a product marketing page. The shared `web/workbench.css` refines
all four current GUI pages; existing page rules remain as a compatibility base.

Activity rows open a keyboard-accessible native dialog with the complete record
and digests. Search and filters operate on the fetched page. Pausing activity
freezes the ledger display, not the proxy or the approval queue. Both GUI and
live TUI distinguish authenticated records from hash-only evidence. Unknown
process health, provider identity and usage are not invented.
