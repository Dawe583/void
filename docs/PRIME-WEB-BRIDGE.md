# Prime Agent in the VOID web app

Choose `prime-agent` in Settings to run new conversations through your local
installation. Existing conversations retain their executor. The PC must be online
and the bridge must be running. VOID Cloud remains available as a separate choice.
The selected model is passed to Prime's provider: OpenCode Zen maps to `opencode`;
TokenRouter maps to the locally configured `tokenrouter` provider. Provider keys
remain in Prime's local credential store. Saved Zen profiles in VOID are encrypted
server-side and can be activated in Settings without pasting the key again.

The bridge polls outbound HTTPS. It opens no local listening port. Worker requests
require both the workspace credential and a distinct `VOID_BRIDGE_TOKEN` configured
on Vercel. `.env.prime-bridge` is ignored by Git and must have mode 0600:

```json
{
  "origin": "https://void-tui.vercel.app",
  "token": "workspace credential",
  "workerToken": "separate worker credential",
  "cwd": "/absolute/workspace",
  "sessions": "/absolute/private/prime-sessions",
  "executable": "/absolute/path/to/prime-agent"
}
```

Run `node scripts/src/prime-bridge.mjs /absolute/path/to/.env.prime-bridge`.
On this machine, a user LaunchAgent keeps the bridge running after login. Stop it
with `launchctl bootout gui/$(id -u)/app.void.prime-bridge`. Resume it with
`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/app.void.prime-bridge.plist`.
The secret file and LaunchAgent are machine configuration, not repository assets.

Prime uses its existing skills, native Python/shell tools and MCP configuration.
Settings shows the configured MCP server inventory. This does not certify that
every server's OAuth session is valid. Codex-only app connectors cannot be exported
as local tools by copying configuration. Local commands can access the workspace
and infrastructure available to this user; a workspace credential therefore also
authorizes submitting work to the local executor. Do not share that credential.

Local tool execution is not covered by VOID's managed document Undo. Every local
run has a signed R3 dispatch/result digest, while tool notifications contain names
only. Raw tool arguments and results are not uploaded. Final assistant text is
filtered for configured credentials, but this is not a general secret detector.
The worker does not upload local configuration or credential files.

A claim is durable before the child starts and is never automatically reassigned.
Lost workers become unknown after 90 seconds when a worker reconnects and checks
for stale jobs. Interrupted work may already have made changes. Cancellation is
polled every 10 seconds; it cannot undo already-dispatched external effects.
Each run has a 30-minute worker limit. Conversation context stays in the local
Prime session directory. Do not delete it while continuing a web conversation.

`verifyOnly: true` in the private bridge configuration disables tools, extensions,
skills and context files for an isolated deployment smoke test. It is not a user
setting or a claim of production tool availability.

Validation: `node --test scripts/src/prime-bridge.test.mjs`; opt-in isolated DB
checks in `cloud/prime.test.mjs` and `cloud/recovery.test.mjs` use
`VOID_GUI_DATABASE_TEST=1` and only `void_gui_upgrade_preview`.
