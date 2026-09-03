# VOID

Marketing and product website for **VOID**, a concept product: the reversible
autonomy layer for AI agents. Every write an agent makes is intercepted,
classified by how reversible it is, given a compensating action, and recorded in
a signed, hash chained ledger you can replay.

VOID is a product concept. Numbers on the site are illustrative.

## Run and operate

```bash
pnpm install

# the API, port 8080, also serves the built site when one exists
pnpm --filter @workspace/api-server run dev

# the site with hot reload, port 18944, proxies /api to 8080
PORT=18944 BASE_PATH=/ pnpm --filter @workspace/void run dev

pnpm run typecheck          # every package
pnpm run build              # typecheck plus build every package
pnpm --filter @workspace/db run push       # push the schema, dev only
pnpm --filter @workspace/api-spec run codegen   # regenerate hooks and Zod schemas
```

Environment:

| variable       | required | meaning                                                        |
| -------------- | -------- | -------------------------------------------------------------- |
| `PORT`         | yes      | port for the service                                            |
| `BASE_PATH`    | web      | base path for the Vite build, `/` for a root domain             |
| `DATABASE_URL` | no       | Postgres. Without it, form submissions are kept in memory        |
| `STATIC_DIR`   | no       | overrides where the API server looks for the built site         |
| `API_URL`      | no       | proxy target for the dev server, defaults to `http://127.0.0.1:8080` |

## Deploying to a domain

Three shapes work without code changes.

### Vercel

`vercel.json` configures everything. Import the repository, leave every build
setting on its default, and deploy. There is nothing to fill in.

- install: `pnpm install --frozen-lockfile`
- build: `pnpm run build:web`, which builds only the site
- output: `artifacts/void/dist/public`
- `/api/*` is served by the Vercel Functions in `api/`
- everything else falls back to `index.html`, so `/docs/policy` resolves

Set `DATABASE_URL` in the project's environment variables to make the two forms
persist. Without it the functions accept submissions, log them and answer
`stored: false`, which is honest but not durable, and on a serverless runtime it
means nothing is kept. Any Postgres works; Vercel Postgres and Neon both do.

### One Node process

Build both packages, then run the API server. It serves `/api/*` and, if it
finds `artifacts/void/dist/public`, the site as well, including the SPA fallback
that deep links need.

```bash
pnpm run build
PORT=8080 NODE_ENV=production node artifacts/api-server/dist/index.mjs
```

### Two services

What `.replit-artifact/artifact.toml` configures: the static build is served
from `artifacts/void/dist/public` with a `/* -> /index.html` rewrite, and the
API is routed at `/api`.

### Before pointing a real domain at it

Replace `https://void.systems` in `artifacts/void/index.html` (canonical,
hreflang, Open Graph) and in `artifacts/void/public/{sitemap.xml,robots.txt}`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9 strict
- Web: React 19, Vite 7, wouter, Tailwind CSS v4 with CSS variables as tokens
- Motion: `motion/react` for every animation, scroll linked and viewport triggered
- Charts: Recharts, loaded lazily so it stays out of the first paint
- Fonts: self hosted through Fontsource, latin and latin-ext subsets only
- API: Express 5, Zod validation, pino logging, in memory rate limiting
- DB: PostgreSQL with Drizzle ORM, optional
- API codegen: Orval from `lib/api-spec/openapi.yaml`

## Where things live

| path                                | what                                                        |
| ----------------------------------- | ----------------------------------------------------------- |
| `artifacts/void/src/index.css`       | the whole design system: tokens, both themes, every keyframe |
| `artifacts/void/src/lib/site-data.ts`| every piece of site content, one source of truth             |
| `artifacts/void/src/sections/`       | homepage sections                                            |
| `artifacts/void/src/pages/`          | routed pages, including the Czech mutation                   |
| `artifacts/void/src/components/site/`| shell, nav, footer, backdrop, motion primitives              |
| `api/`                               | Vercel Functions, plus the code both HTTP layers share       |
| `api/_core.ts`                       | request schemas, receipt sealing, status data, rate limiting  |
| `api/_store.ts`                      | Postgres persistence with the in memory fallback             |
| `artifacts/api-server/src/routes/`   | the same endpoints as a long lived Express server            |
| `lib/db/src/schema/`                 | Drizzle tables, the migration source of truth                |

## Routes

`/` `/spec` `/pricing` `/security` `/compliance` `/changelog` `/docs`
`/docs/:slug` (quickstart, policy, ledger, mcp-proxy, adapters) `/blog`
`/blog/:slug` `/status` `/company` `/contact` `/cs`, plus a 404 for anything else.

## API

| method | path            | notes                                                  |
| ------ | --------------- | ------------------------------------------------------ |
| GET    | `/api/healthz`  | liveness                                                |
| POST   | `/api/waitlist` | private beta request, returns a hash chained receipt    |
| POST   | `/api/contact`  | contact message                                         |
| GET    | `/api/status`   | service view for the status page                        |
| GET    | `/api/stats`    | request counters for this deployment                    |

Both POST endpoints are Zod validated and rate limited per IP (5 and 4 per
minute). Without `DATABASE_URL` they store in memory and say so in the response,
so a fresh deployment never drops a visitor on the floor.

There are two HTTP layers over one implementation. The Vercel Functions in
`api/` and the Express routes in `artifacts/api-server/` both import `api/_core`
for validation, receipt sealing and rate limiting, and `api/_store` for
persistence, so the two deployment shapes cannot drift.

`api/_store.ts` talks to Postgres through `pg` rather than the Drizzle client,
because Vercel bundles functions from the repository root where workspace
packages do not resolve. Its `CREATE TABLE IF NOT EXISTS` bootstrap mirrors
`lib/db/src/schema` exactly, verified by creating the tables both ways and
diffing the result. `pnpm --filter @workspace/db run push` stays the canonical
migration path; change one definition and change the other.

## Keyboard

- `T` toggles the theme
- `G` toggles the 14px grid overlay
- typing `void` anywhere dissolves the page into falling characters
- in the replay demo: arrow keys step one action, `Home` and `End` jump to the ends

All three are disabled when the visitor asks for reduced motion.

## House rules

- Never use an em dash or an en dash anywhere: copy, comments, commit messages.
  Use a comma, a colon, parentheses, or split the sentence. For ranges write
  "X to Y".
- No fabricated companies, logos, customers or certifications. Anything that
  looks like a metric or a quote carries a visible "illustrative" label.
- Keyframe names are prefixed `v-`. Tailwind ships its own `ping`, `spin`,
  `pulse` and friends, and an unprefixed name silently picks up the wrong one.
- No build step may require an environment variable. `PORT` and `BASE_PATH`
  default, because a config that throws without them cannot build on any CI.
