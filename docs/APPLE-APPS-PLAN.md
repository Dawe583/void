# VOID for macOS and iOS

Priority update, 12 September 2026: macOS and the advertised recovery contract
take precedence. iOS implementation and distribution are deferred until the
macOS product passes the capability release gates. The iOS sections below are
future design, not current work or an announced release commitment.

Status: implementation plan, 12 September 2026. Swift migration is not yet
implemented. The downloadable macOS beta uses the existing Tauri shell and
bundled Node runtime. Home Screen installation on iOS is the online web app.

## Product decision

Build a shared SwiftUI application for macOS and iOS, with native navigation,
chat, operation timeline, recovery previews, approvals, workspace browser and
settings. Keep the web app on Vercel. Preserve the exact aperture logo from
Dawe583/void-empty, using the canonical SVG in the current UI as its source.

Keep the tested TypeScript recovery engine on macOS during migration. A native
SwiftUI interface does not require rewriting the recovery engine. On iOS,
implement a smaller Swift execution core for resources inside the app sandbox
and explicitly granted documents. Never silently route a Local action to a Mac
or cloud service. Show the actual executor and recovery coverage on every call.

Local execution and local inference are separate features. Local storage and
Undo must work without internet. TokenRouter and OpenCode Zen require internet.
Prime, shell tools and stdio MCP run on the Mac. iOS can use remote HTTP MCP or
an explicitly paired Mac, but cannot launch the Mac's executables locally.

## A1: Distribution and installation

- Settings contains a direct versioned macOS DMG link, architecture, minimum OS,
  release status and signing status. First release: Apple Silicon, macOS 13.5+.
- Build from the current source, test the packaged backend and WKWebView, publish
  a GitHub prerelease with its SHA-256 checksum. Never bundle workspace tokens,
  API credentials or the developer's workspace. Local installation has separate
  storage and requires explicit provider setup or authenticated credential import.
- iOS Settings provides Safari Home Screen instructions now, labelled web app.
  Replace/add a native install button only when a verified TestFlight or App Store
  URL exists. Downloading an arbitrary IPA from a website is not an installation
  path for ordinary devices. Do not present a disabled or invented native link.
- Public Mac releases need Developer ID signing and notarization. Current machine
  has an Apple Development identity, not the required Developer ID identity.
- Native iOS build/testing requires full Xcode and the iOS SDK; this machine
  currently has Command Line Tools only. TestFlight also needs provisioning,
  App Store Connect access and a suitable Apple Developer membership.

Acceptance: actual DMG download returns bytes; checksum matches; fresh isolated
workspace starts without Node installed; UI accurately distinguishes local app,
web app and native iOS availability. Verify download links after publication.

## A2: SwiftUI macOS client, preserve the engine

Create one Xcode multiplatform app and a shared Swift package. Set initial
deployment targets to macOS 14 and iOS 17 for the native client. Keep the older
Tauri beta compatible with macOS 13.5. Use SwiftUI, Foundation, URLSession,
Security and CryptoKit before adding dependencies.

1. Implement a typed URLSession client for the existing control-plane API and
   event stream. Publish versioned Codable request/response fixtures from the
   current API. Render chat, ledger and recovery plans natively; WKWebView can
   remain an explicitly transitional screen until each native screen passes.
2. Port the existing process ownership contract to a macOS-only actor: bundled
   verified Node, ephemeral loopback port, private Application Support directory,
   Keychain key, readiness handshake, owned stdin pipe and bounded shutdown.
   Reject unexpected readiness messages and do not inherit provider secrets into
   arbitrary child tools. Retain existing origin and authorization controls.
3. First ship native workspace navigation, timeline, operation details and Undo
   preview/confirmation. Then chat streaming, cancellations, approvals, providers
   and MCP settings. Preserve the current API's conflict and unknown outcomes.
4. Select a workspace with the system file picker and explicit scope. Connect
   Prime as a separate executor with its real status. Do not label arbitrary
   Prime tool calls as captured by VOID.
5. Migrate credentials through a user-authorized Keychain flow. Never compile the
   current user's token into an app, downloadable archive or public configuration.
6. Package both arm64 and x86_64 only after testing each architecture with its
   matching runtime. Sign nested executables, notarize and staple the release.

Acceptance: native chat streams and cancels; an isolated managed-document change
can be previewed, applied, restored and verified; process exit and forced app
termination leave no unowned server; corrupt journal, missing artifacts and
concurrent writers fail closed. Compare outcomes against the existing engine.

## A3: iOS local recovery core

Share views, API models and policy vocabulary with macOS. Platform-specific
executors remain separate. Build local recovery before exposing writable tools.

1. Store the signed operation journal and durable state in SQLite transactions.
   Store encryption/signing material in Keychain and artifacts with authenticated
   encryption. Explicitly reserve artifact quota before mutation.
2. Initially support app-owned text documents only: exact-byte capture, hashed
   preconditions, create/update/delete, recovery preview and post-restore check.
   Imported external documents first become explicit app-owned copies; later
   add security-scoped URLs and coordinated external writes as a separate adapter.
3. Persist intent and recovery artifacts before writing. Use atomic replacement
   where possible, then persist observed outcome. Reconcile after interruption.
   An uncertain effect remains unknown and must never be blindly repeated.
4. Bind approval to the exact plan digest, workspace, target and captured state.
   Refuse restoration when the target changed, a signature fails or an artifact
   is unavailable. Repeated Undo must be idempotent. Never treat compensation
   as exact restoration.
5. Add URLSession provider chat and a bounded native tool loop. Expose only the
   managed local document tools until each additional adapter passes recovery
   tests. Save provider keys in Keychain; default to GLM 5.3 Free through
   TokenRouter when that provider is connected and the model is available.
6. Treat background suspension as normal. Persist state before each tool effect,
   resume through reconciliation, and show suspended jobs. Do not promise an
   indefinitely running background agent on iOS.

Acceptance: airplane-mode capture/edit/delete/restore, app termination at each
durability boundary, full disk/quota rejection before mutation, corrupted vault,
wrong workspace key, expired file access, concurrent edits, Unicode and binary
contents, repeated Undo and recovery after restart. Run on simulator and a real
iPhone before TestFlight. Online provider calls have separate network tests.

## A4: Mac pairing and service context

Reuse the existing outbound Prime bridge and durable jobs on Vercel. Add device
pairing with short-lived single-use enrollment and revocable per-device keys.
Keep workspace authorization distinct from worker authorization. Store device
keys in Keychain and never include them in QR history, logs or release assets.

The iOS client displays three explicit modes: On this device, Paired Mac and
Cloud. Show the target workspace, online state, available tools and recovery
coverage before sending a task. A disconnected Mac leaves work pending or
unknown according to the job state; it does not silently transfer execution.

Use ASWebAuthenticationSession for service OAuth. Keep client secrets on the
backend, use PKCE/state and tested callback validation. Reuse current service
connections rather than copying browser cookies or Codex-only connectors.

Acceptance: revoked devices lose access; another workspace cannot claim jobs;
duplicate requests do not duplicate effects; cancellation, expired credentials,
network loss before/after dispatch and reconnect display truthful job states.

## A5: Native experience and release gate

Use NavigationSplitView on Mac/iPad and NavigationStack on iPhone. Keep the
timeline searchable and filterable by session, target, executor, class and
outcome. Use tables on desktop, compact cards on mobile, a focused recovery
preview and an explicit confirmation for the bound recovery plan. Support
English and Czech, Dynamic Type, VoiceOver, keyboard navigation, dark mode and
Reduce Motion. Animate streaming and state changes without hiding failures.

Release only after contract tests, native recovery fault tests, real-device
checks, signing/provisioning and download verification pass. Keep TestFlight
and DMG versions visibly separate from the online web version. A full Swift
port of the Mac engine is optional after protocol parity; it is not a prerequisite
for a SwiftUI Mac app and must not delay the tested recovery path.

Apple references:
- https://developer.apple.com/documentation/swiftui
- https://developer.apple.com/testflight/
- https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- https://support.apple.com/guide/iphone/turn-a-website-into-an-app-iph42ab2f3a7/ios
