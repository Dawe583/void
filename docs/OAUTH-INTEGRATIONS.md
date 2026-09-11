# Cloud account connections

The cloud app exposes GitHub, Vercel and Supabase in **Tools and connections**. Connections belong to the authenticated personal VOID workspace. They are not per-user grants for a multi-tenant service.

## Agent access

New conversations load the live tool catalog for connected accounts. An idle conversation can refresh its integrations from the context panel. The agent obtains relevant context by calling tools; connecting an account does not copy every repository or database into the prompt. Provider permissions and selected organizations/projects limit access.

GitHub and Supabase use their hosted MCP servers. Vercel uses its integration OAuth token with an allowlisted REST adapter for projects, deployments, deployment events, domains and environment variable metadata. Vercel environment values are redacted. Other Vercel resources are not currently exposed by the adapter.

Only exact allowlisted read tools run as R0. Writes, arbitrary SQL, unknown tools and tools supporting several operations require R3 approval. The approval contains the requested arguments. External operations have **no automatic Undo**. Successful external execution is recorded separately from permission to execute, and interrupted executions are not blindly retried.

Provider results are untrusted data, not instructions. Provider access tokens are resolved immediately before execution, encrypted on the server and never copied into conversation snapshots. Disconnect prevents subsequent calls from existing conversations; it cannot cancel an HTTP operation already in progress.

## Provider registration

Callback URLs for the production app:

- GitHub: `https://void-tui.vercel.app/api/integrations/github/callback`
- Vercel: `https://void-tui.vercel.app/api/integrations/vercel/callback`
- Supabase: `https://void-tui.vercel.app/api/integrations/supabase/callback`

For a different canonical deployment origin, set server variable `VOID_PUBLIC_ORIGIN` and register the corresponding callbacks. Preview deployment URLs do not automatically become authorized callbacks.

### GitHub

Register a confidential OAuth app at <https://github.com/settings/developers>. Enter its client ID and secret in the workspace connection form, then authorize the account. Requested scopes are `repo read:org read:user`. Repository access remains subject to organization OAuth restrictions and SSO policies. The tool catalog is validated against `https://api.githubcopilot.com/mcp/` before a connection is accepted.

### Vercel

Create a **connectable integration** in the team's integration console, using private visibility for personal use. Register the callback above. Enable the permissions required for projects, deployments, domains and environment variables. Enter the integration slug, client ID and client secret in VOID, then install the integration for the intended team/projects.

**Sign in with Vercel is identity-only and is not a platform integration credential.** Vercel Connect was also unavailable for the current team during this implementation. This app therefore uses the documented external integration flow at `https://vercel.com/integrations/:slug/new` and exchanges the one-time code at `https://api.vercel.com/v2/oauth/access_token`. Team selection comes from the token response and cannot be overridden by tool arguments. A real project-list request validates the grant before it is saved.

Creating a Vercel integration requires its logo, registration details and acceptance of Vercel's Integrations Marketplace Agreement, including for private visibility.

### Supabase

The workspace's confidential client was registered using Supabase dynamic client registration at `https://api.supabase.com/platform/oauth/apps/register`. Registration alone does not authorize an account. Click Connect account and complete Supabase login and organization consent. The callback validates the grant with `https://mcp.supabase.com/mcp` before saving it.

Requested permissions include project/database access, analytics, secrets, functions, environment and storage. SQL and migrations remain approval-gated. Do not assume a database write is reversible merely because it used Supabase MCP.

## OAuth boundaries

State and browser binding contain 256 bits of randomness. Pending authorization expires in ten minutes and is single-use. A Secure, HttpOnly, SameSite=Lax callback cookie binds the flow to the initiating browser; ordinary workspace authentication uses a separate Strict cookie. PKCE S256 is used with GitHub and Supabase. Vercel's integration protocol uses state and confidential-client authentication instead.

Callback state is invalidated by a changed registration, disconnect or workspace control-key rotation. Mutating workspace routes require authentication and pass the existing origin/CSRF checks. Fixed provider URLs, rejected redirects, encrypted token storage and serialized refresh protect credentials. OAuth errors do not expose provider response bodies.

Disconnect removes the local grant. It does **not** claim to revoke authorization at the provider; use the provider's authorized-app/integration settings for that. Other copies of a provider token are outside VOID's control.

## Verification

```sh
pnpm test:reverse
pnpm test:oauth
pnpm run typecheck
pnpm test
```

OAuth unit tests use fake HTTP providers. The opt-in `cloud/integrations.test.mjs` additionally uses a real isolated Neon database and an HTTP instance of the cloud server. It checks authentication, CSRF, callback binding, replay, expiry/refresh behavior, session attachment, running-session refusal, secret isolation and disconnect. It explicitly refuses any database whose name is not `void_gui_upgrade_preview`. Supply that database and test workspace keys through environment variables, then run:

```sh
VOID_OAUTH_DATABASE_TEST=1 node --test cloud/integrations.test.mjs
```

This is not evidence of completed production consent for every provider. On 2026-09-11, Supabase client registration and the live redirect to its login page were verified. GitHub login/client registration and Vercel integration registration/consent remained user-dependent. No production external write was performed to test OAuth.

See [the core reverse-engine report](./REVERSE-ENGINE-VALIDATION.md) for the separate core test matrix, repaired defects and supported Undo boundaries.
