# Mobile web refinement

12 September 2026. This changes the responsive web workbench, not the deferred
native iOS application.

## Changes

- Mobile display headings use a 28 to 32 px scale; page headings use 28 px,
  body copy 14 px and form inputs 16 px to avoid automatic input zoom.
- The chat uses one compact header, a centered introduction, compact starter
  actions and a bottom composer. The chat's bottom navigation is removed;
  every destination remains available through the sidebar. Other pages retain
  their bottom navigation and indicate the current destination.
- Theme, language, animation preference, export and context move into a mobile
  options popover. New conversation remains directly accessible in the header.
  The old sub-360 px rule that hid the language control is removed.
- Model/search dialogs become bottom sheets. The original VOID aperture logo,
  colors and typography families remain intact. Composition takes inspiration
  from Claude's focused mobile chat rather than replacing VOID branding.
- Motion 13.2 uses LazyMotion with domAnimation and lightweight m components
  for welcome/starter entrance, message entrance, drawer, backdrop, context,
  dialogs and tap feedback. Existing CSS supplies surface and focus effects.
  Duplicate CSS entrance animations were removed from Motion-owned elements.
- System reduced motion and the existing animation switch control Motion.
  VisualViewport resize updates available height while editing on mobile;
  the composer and bottom sheets account for this height and safe-area insets.

## Verification

The shared backend ran in a disposable local workspace with a deterministic
local model fixture. No real provider calls, production conversations or user
files were needed for the message-layout tests.

Browser checks:

| Viewport | Check | Result |
| --- | --- | --- |
| 320 x 568 | Welcome, Settings, full options menu | No page-level horizontal overflow; heading 28 px; language control available |
| 390 x 844 | Light/dark chat, long response, code, table, model sheet, navigation | Composer stays visible; dialogs and menu usable; no app console warnings/errors observed |
| 430 x 932 | Welcome and composer | No page-level horizontal overflow; heading 32 px |
| 667 x 375 | Landscape welcome and composer | No page-level horizontal overflow; compact 25 px heading |
| 1440 x 900 | Desktop welcome and composer | No page-level horizontal overflow; desktop display scale retained |

Additional checks: Czech/English switch, menu-to-Settings navigation, mock chat
submission, model picker open/close and animation-off state (no welcome transform).
TypeScript and the production web build pass. The normal repository check passes
586 tests plus 9 OAuth tests; 4 opt-in cloud tests are skipped.

Limits: viewport overrides are not a physical iPhone or Android device. Actual
virtual-keyboard behavior, mobile browser chrome, VoiceOver and frame-rate/power
profiling remain real-device checks. No 60 fps or device certification claim is
made from these browser checks. Native iOS remains deferred.


## Follow-up verification, 2026-09-13

The iOS report specifically identified top-panel composition and button sizing.
The follow-up replaces remaining header font glyphs with 20-pixel SVG icons in
44-pixel targets and moves options into a named native dialog with 52-pixel rows.
Navigation icons now share the SVG vocabulary. Options reuse the same actions
on desktop and mobile. The old outside-pointer listener was removed because
native dialog dismissal now owns that behavior.

Measured private Settings at 320 pixels: three 44 by 44 header buttons, no
horizontal overflow. Theme and Czech/English switches were clicked successfully.
Public demo was inspected at 320x568, 390x844, 430x932, 667x375 and 1440x900.
The composer stayed within the viewport and the desktop document rail collapsed
on narrow screens. An actual GLM conversation created a document; operator Undo
removed it and the history retained both write and inverse.

Native `--smoke-mobile` renders a visible 390-pixel WKWebView window and asserts
header targets, icon dimensions, option rows and theme interaction before testing
Blob export. A hidden-window run measured an unfinished animation; the final
check uses a rendered window and a 0.1-pixel geometry tolerance. Packaged runtime
integration and this WebKit check pass. This is macOS WebKit coverage, not a
claim of physical iPhone/Safari keyboard or VoiceOver certification.

The main web JavaScript chunk is now approximately 335 kB before gzip, compared
with 552 kB before route splitting. Other chunks load when their surfaces are
needed. Full design comparison and next stages: GUI-DESIGN-RESEARCH.md.
