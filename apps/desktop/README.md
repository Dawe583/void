# VOID desktop

The native macOS app runs the same GUI and local control-plane API as `pnpm gui`.
Tauri 2 keeps one app instance per user and owns an isolated Node process and binds the backend to an ephemeral
loopback port. The packaged application contains Node 24 and the bundled backend;
end users do not need Node, pnpm, Rust, Vercel or a running terminal.

## Develop and package

Run from the repository root after `pnpm install`:

```sh
pnpm --dir apps/desktop install --ignore-workspace
pnpm --dir apps/desktop dev
pnpm --dir apps/desktop build
```

The build host needs Rust and Xcode Command Line Tools. macOS 13.5 or newer is
required by the bundled Node runtime. macOS arm64 and x64 are
supported on their matching host architectures. The build pins and verifies the
SHA-256 of the official Node distribution. The exact website Aperture logo is
used to generate the macOS application icon.

Artifacts are written to `apps/desktop/src-tauri/target/release/bundle/`.
DMG creation runs without Finder automation. The `.app` can run locally; public distribution also needs an Apple Developer
signing identity and notarization credentials configured using Tauri's standard
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID`
environment variables. Without those credentials the build is an unsigned local
beta, not a notarized installer. Windows/Linux packages are not yet verified.

## Runtime boundary

### First-run provider import

Settings offers local API-key import from OpenCode and Prime for supported
TokenRouter, OpenCode Zen and OpenRouter profiles. This explicit action replaces
the active provider after catalog validation and chooses an available model.
The key stays in the encrypted local workspace and is sent only to its fixed
provider endpoint. Existing OpenCode/Prime files are not modified. OAuth tokens,
command expressions and custom endpoints are not imported. No import API is
available to the cloud or remote-token server mode.

See `docs/MACOS-ALL-IN-ONE-RESEARCH.md` for current support and the next project
setup/recovery stages. iOS implementation is deferred until macOS release gates.

### Execution

Provider selection, model catalogs, connectors, sessions, approvals, signed
history and guarded undo are implemented in the shared workbench/backend. The
shell neither bypasses nor duplicates VOID policy or replay logic. Basic local
inspection is independent of the hosted web app; model calls still require a
configured provider or a running local model server.

Data is stored under the OS application data directory (`~/Library/Application
Support/dev.void.desktop` on macOS). The backend receives `VOID_DATA_DIR` and a
local ledger directory. The workspace encryption key is retained in macOS
Keychain and passed privately to the backend for startup. It is removed from the
runtime environment before MCP processes are launched. A legacy `workspace.key`
is migrated with Keychain readback verification and retired only after the
backend opens successfully. A locked Keychain or conflicting keys stops startup
without overwriting the workspace. The native smoke check and Rust migration
tests use ephemeral or injected storage; they do not access the real Keychain. Directories have mode 0700 and the runtime log has mode
0600. Closing the app closes the ownership pipe, cancels the workbench and closes
HTTP connections; a stuck backend is terminated after five seconds. Closing the
pipe also handles an unexpected shell termination.

The webview has no Node integration, shell access or broad Tauri permissions.
Navigation is restricted to its own loopback origin. Document and conversation
exports allow only same-origin HTTP/Blob downloads into the Downloads folder. External provider requests
run in the backend. The runtime does not inherit `NODE_OPTIONS`, `NODE_PATH` or
cloud operator tokens. A remote page cannot become the desktop workbench.

The shell currently does not embed a PTY or native external-agent adapters.
These require explicit process and terminal permission boundaries; the built-in
VOID agent uses the shared guarded tool interface.

## Verification

```sh
pnpm --dir apps/desktop test
pnpm --dir apps/desktop prepare:runtime
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

The runtime test starts the real backend, checks local pages and APIs, verifies
cross-origin denial and confirms that closing the ownership pipe releases the
server. It does not contact a paid provider.

After packaging, exercise the native executable and its embedded Node runtime:

```sh
apps/desktop/src-tauri/target/release/bundle/macos/VOID.app/Contents/MacOS/void-desktop --smoke-test
```

This checks that the packaged application resolves its own resources and serves
the real workbench, renders it in WKWebView and verifies an actual Blob download
to its temporary directory, then shuts down. It uses a temporary data directory and does
not contact a provider. Close an already running VOID app before this check, as
the single-instance guard otherwise focuses the existing app.
