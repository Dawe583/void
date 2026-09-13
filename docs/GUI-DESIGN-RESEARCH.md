# VOID interface and interaction research

VOID should make agent work inspectable and recoverable without turning the chat
into an administration console. The strongest direction is a calm conversation
surface with a document and recovery inspector, progressive disclosure of
infrastructure, and an explicit difference between private work and a public
demonstration. A coherent interaction system is more valuable here than a large
collection of visual libraries.

This assessment covers the existing React web application, mobile Safari, the
macOS desktop shell, and the later SwiftUI migration. Official documentation was
checked on 13 September 2026. Recommendations are engineering judgments, not
claims that every compared library was installed or benchmarked. The current
macOS release uses Tauri and WKWebView; its interface is not implemented in Swift.

## Product identity

The source of the VOID identity is the aperture mark in
`Dawe583/void-empty`, pinned to commit
`25b5e62d49d614f88804b72b55609c74092d98d8`. Its corner frame, central square and
center dot are preserved exactly. The current shared SVG uses the same paths.
This is the most reliable visual connection between the product and its website;
a newly invented icon would weaken it.[^1]

The website describes accountable tool execution, classification and recovery.
The interface should expose those concepts through the work itself: a document
changes, its operation appears in history, a preview shows what Undo restores,
and a signed receipt confirms the action. A decorative safety badge cannot
replace this sequence. The public demonstration therefore uses real managed
documents and the existing signed recovery runtime.

Claude is useful as a composition reference: a restrained header, a dominant
conversation, and a composer within reach. This is a design interpretation of
the requested direction, not a claim that Claude's private component system or
current iOS application was reverse engineered. VOID retains its own mark,
colors, type and recovery terminology.

## Mobile Safari and the toolbar

The previous toolbar mixed Unicode symbols, SVG, automatic flex sizing and
mobile CSS labels generated from `aria-label`. This made icon appearance depend
on font fallback, while several separate responsive blocks controlled the same
buttons. A narrow viewport screenshot could look acceptable without proving the
same control rendered consistently in WebKit or responded correctly to touches.

Apple's toolbar guidance prioritizes deliberate selection of commands, the
current view title, navigation and content actions. It explicitly warns against
overcrowding. Less important commands can move into a More menu; native macOS
and iPadOS also provide automatic toolbar overflow. That automatic native
behavior should not be confused with a custom web menu.[^2]

For VOID mobile web, the selected layout is a four-column header: menu, a title
that can truncate, new conversation, and options. The title owns the remaining
width through `minmax(0, 1fr)`. Each icon has a fixed 20 by 20 CSS pixel viewport
inside a 44 by 44 CSS pixel button. This separates the visible symbol from its
touch target. The public demo needs only menu, product identity and documents.

The options panel uses a modal bottom sheet with real text labels, 52-pixel
rows and a dedicated close control. Native `dialog` provides the modal top layer
and focus behavior. The title is associated using `aria-labelledby`. Actions
are ordinary buttons, not a `menu` role that would require a separate arrow-key
interaction model. The same action content serves the desktop toolbar and the
mobile sheet, reducing the chance that one platform receives a different action.

W3C's WCAG 2.2 minimum target criterion is 24 by 24 CSS pixels with documented
exceptions. The chosen 44-pixel toolbar targets exceed that minimum; they are a
VOID product requirement, not a claim that WCAG universally requires 44 pixels.
Spacing, focus visibility and target overlap still require inspection.[^3]

Safe-area padding belongs to the outer header and composer edges. WebKit's
original iPhone X guidance explains `viewport-fit=cover`, `env()` and combining
insets with minimum padding. It is an older source, useful for the mechanism,
not evidence of current device compatibility by itself.[^4] Portrait and
landscape both need left and right safe areas. Merely adding bottom padding
does not protect controls near a camera cutout in landscape.

The visual viewport is distinct from the layout viewport. Its height, offsets,
scale and resize events help explain what happens when an on-screen keyboard
opens. The current implementation adjusts the application height while editing
at scale 1 and retains normal behavior during pinch zoom.[^5] A resized desktop
window cannot prove iPhone keyboard behavior, Safari browser-chrome transitions,
VoiceOver order or physical touch accuracy. Those remain device acceptance gates.

## Component systems

| Candidate | Relevant documented capability | Fit for VOID | Decision |
| --- | --- | --- | --- |
| Native HTML dialog | Browser modal behavior and shared existing component | Smallest change to the current stack | Use now, test focus and dismissal |
| Base UI Dialog / Drawer | Accessible primitives; documentation distinguishes dialogs from gesture drawers | Strong candidate when gestures or nested overlay behavior become requirements | Evaluate Drawer before inventing drag-to-dismiss |
| Radix Dialog | Focus trapping, controlled state, title/description and Escape handling | Mature alternative for a broader primitive migration | Keep as alternative; do not install alongside Base UI |
| React Aria Modal | Modal, overlay, dialog and sheet patterns | Strong accessibility and internationalization-oriented option | Prefer if complex keyboard or cross-input requirements dominate |
| shadcn Sidebar | Controlled sidebar state, mobile width and off-canvas variants | Useful reference for responsive composition | Adapt patterns, preserve current VOID semantics |
| assistant-ui | Chat primitives with custom runtime integration | Potentially useful for future branching, attachments and richer tool rendering | Prototype against VOID event history before adoption |

Base UI documents that Dialog itself does not support gestures and recommends
Drawer when gestures or snap points are required. This distinction matters:
animating a dialog from below does not make it a gesture-capable sheet.[^6]
Radix explicitly documents focus trapping and title/description support.[^7]
React Aria exposes Modal, ModalOverlay and Dialog as related primitives.[^8]
These are alternative foundations, not features that justify installing all
three into one application.

The existing shadcn Sidebar documentation includes separate mobile width,
controlled state and off-canvas behavior.[^9] VOID already has a working sidebar
and navigation model, so replacing it wholesale would add migration work
without addressing the specific icon-sizing defect. The useful changes are
predictable dimensions, a single icon treatment, preserved scroll position and
clear focus restoration.

assistant-ui supports a custom server and multiple runtime integration paths.
That makes adoption possible without replacing VOID's backend.[^10] However,
VOID's signed events, unknown outcomes, operation identities and operator-only
Undo must survive any adapter. A chat library must not infer success from a
finished animation or manufacture a recovery action from ordinary tool output.
A future prototype should replay a captured conversation and compare message,
tool and recovery ordering before replacing the existing transcript.

No TanStack Table recommendation is based on an unverified current API in this
report. The attempted documentation paths returned access or not-found errors.
The existing tables remain in place. A future table upgrade should be justified
by measured row volume, keyboard requirements, pinned columns and server-side
paging, then checked against an accessible current version of the documentation.

## Motion and effects

Motion remains the selected React animation library. It is already installed,
works with the existing component tree and documents reduced-motion controls,
gestures, layout animation and bundle reduction. Adding GSAP, another spring
library and a second component animation layer would increase maintenance and
make user preferences harder to enforce consistently.[^11][^12]

The interaction hierarchy is deliberate:

- A press gives a small scale response on the send button or starter action.
- Opening options reveals a sheet from the edge where it belongs.
- A new message enters without moving previously read content unnecessarily.
- A document operation appears in history; Undo changes actual persisted state.
- Signature verification produces a textual result that remains understandable
  without an animation.

Large, repeated background movement should not compete with reading. Motion's
accessibility guidance recommends reducing large transform movement and
avoiding parallax or automatic video for users requesting reduced motion.[^11]
VOID combines the operating-system preference with its own animation switch.
The public demonstration follows the same preference, including dialog entry
and button feedback.

`LazyMotion` and the smaller `m` component entry point reduce feature overhead,
but route-level splitting is also important. The application previously loaded
settings, tables, document management and chat code together. Those surfaces now
load in separate chunks. In the measured web build, the main JavaScript chunk
fell from roughly 552 kB to 335 kB before gzip. This is a build measurement, not
a mobile-network speed benchmark. Shared dependencies and the requested page's
own chunk still contribute to total transfer.[^12]

A practical motion budget is 120 to 180 ms for direct button feedback and about
200 to 280 ms for sheet or inspector transitions. These are proposed tuning
ranges rather than standards. Animate opacity and transforms where possible;
avoid repeated large-area filters on mobile. Real-device profiling should
precede adding more ambient effects. Keep essential status changes visible in
text and available to assistive technology.

## Framer and visual inspiration

Framer's SaaS category presents templates for explaining a product, comparing
plans and converting visitors.[^13] That makes it useful for VOID's marketing
site, screenshots and introductory storytelling. It does not establish a
production interaction model for chat history, signed operations, keyboard
navigation or recovery conflicts.

The relevant inspiration is compositional: deliberate spacing, a strong first
view and clear feature hierarchy. Marketing patterns such as continuously
moving showcase panels, oversized display text and stacked promotional cards
should not be copied into a daily working surface without a functional reason.
No template purchase, reuse license or compatibility claim is implied here.

The selected visual system keeps the existing warm paper direction because it
matches the requested Claude-inspired composition and the VOID site. Its
identity comes from the aperture and the recovery workflow, rather than an
additional decorative motif. The current tokens are:

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | `#f6f0e3` | `#12100a` |
| Secondary surface | `#efe8d8` | `#1a1610` |
| Text | `#17150f` | `#f0eade` |
| Muted text | `#6f6857` | `#b1a68f` |
| Divider | `#cfc5b1` | `#4e4435` |
| Action | `#bd4206` | `#e8702c` |

Inter handles controls and reading text. Instrument Serif is limited to the
welcome heading, where it distinguishes the empty state without reducing the
legibility of tool data. Monospace is reserved for code or technical values.
The mobile composer stays at 16 pixels; visible button labels are smaller than
their touch targets. Functional screens prioritize aligned content over
oversized headings.

## Desktop and recovery composition

Desktop uses a conversation column and a document/recovery rail. The rail has
three jobs: show current documents, expose the sequence of changes and preview
what an inverse will do. It should not become an unstructured list of every
connected service. On a narrow screen, the rail becomes an explicitly opened
sheet, preserving space for the conversation.

A recovery preview uses current content and proposed restored content side by
side on desktop, stacked on mobile. The action label says what will happen.
Creating a file and undoing its creation is presented as removing that file;
undoing a deletion is presented as restoring content. A stale operation is
blocked instead of silently replacing a newer human edit. Multiple dependent
changes must be undone in valid order; the interface must not suggest that any
historical state can always be applied independently.

The demo reuses the private chat's Markdown, code and table renderer after the
first assistant reply, while documents remain expandable. A sophisticated
code diff and line-level annotations are separate upgrades. Their absence
does not prevent the real write/review/Undo flow, but they should not be
described as already implemented.

The next substantial GUI work should add a recovery center backed by runtime
operations, not inferred from marketing labels. Each row needs operation ID,
agent/run, affected resource, reversibility, readiness, capture availability,
current status and an explicit limitation. Filters should separate verified
recovery, conflicts and unknown outcomes. Unknown is a first-class state, not a
redesign opportunity to label an ambiguous write as failed safely.

## macOS and SwiftUI

The existing native shell packages the local Node runtime and uses WKWebView.
It preserves the tested TypeScript engine and encrypted workspace storage.
This is a real local macOS application, but it is not a SwiftUI implementation.
A redesign of its bundled web interface is distinct from a native framework
migration.

Apple's `NavigationSplitView` supplies a two- or three-column structure with
selection-driven detail presentation.[^14] That is a suitable future native
shell for VOID: workspace/history, conversation, and the recovery inspector.
SwiftUI toolbars should use standard navigation and system symbols for controls,
while the product mark remains the exact VOID aperture. Native file pickers,
Keychain and platform accessibility should be retained rather than recreated in
JavaScript when the SwiftUI shell becomes the chosen implementation.

The migration should preserve an explicit local service boundary. SwiftUI sends
structured requests to the local engine; it does not reimplement policy,
snapshot encryption or ledger verification. The first native slice should cover
workspace selection, conversation and recovery review with the same contract
tests. Only then should the webview be removed from individual screens.

The current machine lacks a full Xcode/iOS SDK installation and release
notarization credentials. An iPhone application and App Store distribution are
therefore not certified by the current work. The macOS beta remains Apple
Silicon only and may be blocked by Gatekeeper because it is not notarized.
These are distribution limits, not visual defects to conceal in the download UI.

## Public demo boundary

A public build cannot safely contain the private workspace token: that token
also authorizes private sessions, connected accounts and the local Prime bridge.
The demo instead obtains a signed, expiring, HttpOnly cookie that identifies only
its own demo state. Model credentials remain server-side, and the selected
provider endpoint and model are fixed.

The available tools are managed document list, read, write and delete. No host
filesystem, general shell, OAuth account, arbitrary provider endpoint or Prime
worker is reachable through the demo router. Undo is an operator action bound
to a recorded operation in that visitor's workspace. A second visitor cannot
use another visitor's operation ID to restore their data.

Limits reserve capacity before model execution: six messages per visitor and
50 demo runs globally per UTC day, with at most three model turns per run. A
new cookie does not bypass the global bound. Model availability remains subject
to TokenRouter. The label Free identifies the configured model; it is not an
unlimited service guarantee. The cookie expires after 24 hours; expiry is not a
claim of immediate physical deletion from database backups.

## Acceptance and follow-up

The implementation gates combine types, tests, built artifacts and visual
inspection. Browser checks cover 320, 390 and 430 pixel portrait widths, a
667-pixel landscape case, and desktop. Toolbar geometry, horizontal overflow,
menu action execution, modal naming, document creation and Undo need separate
checks. A passing screenshot alone is insufficient.

Native WKWebView smoke tests check the packaged interface, local runtime and
Blob downloads. The mobile-width variant checks SVG dimensions, 44-pixel header
buttons, 52-pixel option rows and a working theme action in WebKit. This improves
engine coverage but does not replace testing Safari on an actual iPhone.

Before declaring mobile Safari finished, test an actual iPhone with expanded
and collapsed browser chrome, keyboard open and closed, portrait/landscape,
VoiceOver, large system text, reduced motion and installation to the Home
Screen. Capture the exact device and OS/browser version with each result.

The next sequence is: certify the current Safari toolbar on a physical device;
consolidate remaining duplicated responsive rules; add runtime-backed recovery
center views; prototype richer document diffs; evaluate a gesture drawer only
if native dialog behavior is insufficient; and migrate one macOS screen to
SwiftUI while preserving the engine contract. General Git recovery, arbitrary
shell inversion and a full SwiftUI application remain separate engineering
work, not features supplied by a UI library.

## Sources

[^1]: VOID. [Canonical site shell at pinned commit](https://github.com/Dawe583/void-empty/blob/25b5e62d49d614f88804b72b55609c74092d98d8/artifacts/void/src/components/site/shell.tsx). Read through authenticated repository access, 13 September 2026.
[^2]: Apple. [Toolbars, Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/toolbars). Current documentation content read through Apple's documentation JSON, 13 September 2026.
[^3]: W3C WAI. [Understanding SC 2.5.8: Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). WCAG 2.2 explanation, accessed 13 September 2026.
[^4]: WebKit. [Designing Websites for iPhone X](https://webkit.org/blog/7929/designing-websites-for-iphone-x/). Historical safe-area guidance, accessed 13 September 2026.
[^5]: MDN. [VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport). API reference, accessed 13 September 2026.
[^6]: Base UI. [Dialog](https://base-ui.com/react/components/dialog). Includes gesture limitation and Drawer guidance, accessed 13 September 2026.
[^7]: Radix UI. [Dialog](https://www.radix-ui.com/primitives/docs/components/dialog). Component accessibility and API reference, accessed 13 September 2026.
[^8]: Adobe React Aria. [Modal](https://react-aria.adobe.com/Modal). Component and sheet examples, accessed 13 September 2026.
[^9]: shadcn/ui. [Sidebar](https://ui.shadcn.com/docs/components/base/sidebar). Mobile width, controlled state and variants, accessed 13 September 2026.
[^10]: assistant-ui. [Custom Runtime](https://www.assistant-ui.com/docs/runtimes/custom/overview). Also [overview](https://www.assistant-ui.com/docs), accessed 13 September 2026.
[^11]: Motion. [Accessibility](https://motion.dev/docs/react-accessibility). Reduced-motion behavior, accessed 13 September 2026.
[^12]: Motion. [Reduce bundle size](https://motion.dev/docs/react-reduce-bundle-size). LazyMotion and component import guidance, accessed 13 September 2026.
[^13]: Framer. [SaaS templates](https://www.framer.com/marketplace/templates/categories/saas/). Marketing-template category, accessed 13 September 2026.
[^14]: Apple. [NavigationSplitView](https://developer.apple.com/documentation/swiftui/navigationsplitview) and [Layout](https://developer.apple.com/design/human-interface-guidelines/layout). Current documentation read through Apple's documentation JSON, 13 September 2026.
