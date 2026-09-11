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
