# Public VOID demo

Anonymous visitors to the Vercel web app enter an isolated demonstration.
`/demo` opens it explicitly even when the browser already has private workspace
access. The default model is `z-ai/glm-5.3-free` at TokenRouter's fixed HTTPS
endpoint. Provider availability and rate limits can still prevent a reply.

The private workspace token is not embedded in JavaScript, HTML or URLs.
`VOID_DEMO_TOKENROUTER_KEY` is a server-only Vercel secret; `VOID_PUBLIC_DEMO=1`
enables the feature. Changing those variables requires a new deployment.
The existing `VOID_SECRET_KEY`, database and signing key support encrypted demo
state and signed managed-document evidence.

## Scope

Every visitor receives a signed, HttpOnly, Secure, SameSite=Strict cookie with
a 24-hour lifetime. It authenticates only `demo:<visitor>` and the derived
`demo-<visitor>` document/recovery workspace. Route arguments cannot supply a
workspace, provider, model, agent, MCP endpoint or other visitor ID.

Tools are restricted to managed document list/read/write/delete. Writes and Undo
use the existing shared runtime inside SQL transactions. Visitors can inspect
current and restored content before operator Undo, download their documents and
verify the signed ledger. There is no general host filesystem, shell, GitHub,
Vercel, Supabase account or Prime bridge access.

Private workspace login remains available from the demo menu. The private
workspace keeps its existing provider configuration and tools. The demo does not
copy or read those profiles.

## Capacity and failure behavior

- Six messages per visitor and 50 total runs per UTC day, reserved durably before
  model dispatch under one short database lock.
- At most 200 new demo sessions per UTC day; clearing cookies cannot bypass the
  global run limit.
- At most three model turns per run, four tool calls per model turn, 4,000
  characters per prompt and 16,000 per generated document.
- Model calls have a shared 50-second deadline. An interrupted run is marked
  failed after 70 seconds when its state is read. Old workers cannot execute
  more tools or replace a newer run's result.
- Request IDs prevent repeat dispatch for the same message. A changed prompt
  with the same ID is rejected. Unknown external model responses are not retried
  automatically. Completed document changes remain inspectable and recoverable.

The shared lock is deliberately conservative for a maximum of 50 daily runs.
Network requests run outside the lock. Separate tenant admission locks are only
needed if this becomes a larger public service.

Cookie expiry ends access; it does not delete database backups or guarantee
immediate physical erasure. Demo rows and recovery evidence currently persist
until operator retention cleanup. Use non-sensitive examples. A production
self-service account product needs an explicit retention and deletion policy
before expanding these limits.

## Verification

```sh
node --test cloud/demo.test.mjs
pnpm check
```

The HTTP suite checks signed/expired cookies, visitor and global budgets,
separate visitor state, fixed model/tools, request idempotence, rejection of
foreign origins and private capabilities. It uses an isolated in-memory storage
fixture for those authorization checks.

An additional live validation on an isolated Neon database used the actual GLM
model: create `test.md`, change its content, restore the previous content and
verify 15 signed records. A second visitor could not undo the first visitor's
operation. The browser flow separately created `welcome.md` through GLM and
opened the real operator Undo preview. These are real managed-document flows,
not certification of external cloud or local computer actions.
