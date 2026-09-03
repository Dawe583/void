# VOID

The launch website for VOID, a concept product: the reversible autonomy layer for
AI agents. It explains the product, demonstrates cross system replay, documents
the technical model, and captures private beta access requests.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev`: API on port 8080, also serves the built site if one exists
- `PORT=18944 BASE_PATH=/ pnpm --filter @workspace/void run dev`: the site, proxies `/api` to 8080
- `pnpm run typecheck`: full typecheck across all packages
- `pnpm run build`: typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen`: regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push`: push DB schema changes (dev only)
- Optional env: `DATABASE_URL` (without it, form submissions live in memory), `STATIC_DIR`, `API_URL`
- Deploys to Vercel with no configuration beyond `vercel.json`: the site is static, `/api/*` runs as Vercel Functions from `api/`. Set `DATABASE_URL` there for durable form storage.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Web: React 19, Vite 7, wouter, Tailwind CSS v4, `motion/react`, Recharts, Fontsource
- API: Express 5, Zod, pino
- DB: PostgreSQL + Drizzle ORM (optional)
- Validation: Zod (`zod/v4` in the db package), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: Vite for the site, esbuild for the API

## Where things live

- `artifacts/void/src/index.css`: the entire design system: tokens, both themes, every keyframe. Light is the default; dark is the CRT theme behind the nav toggle. Change colours here, nowhere else.
- `artifacts/void/src/lib/site-data.ts`: every piece of site copy and demo data, one source of truth for the homepage, the spec page and the Czech mutation.
- `artifacts/void/src/lib/motion.ts`: the shared reveal variants and easings.
- `artifacts/void/src/lib/use-site.ts`: theme, media query, visibility aware interval, active section, page meta, copy helpers.
- `artifacts/void/src/sections/`: homepage sections, one file per idea.
- `artifacts/void/src/pages/`: routed pages. `docs.tsx` holds all five doc pages as data.
- `artifacts/void/src/components/site/`: shell (nav, footer, backdrop, cursor, easter eggs) and the motion primitives.
- `api/`: Vercel Functions, and the code both HTTP layers share. `_core.ts` holds request schemas, receipt sealing, the status payload and rate limiting; `_store.ts` holds persistence; `_http.ts` is the small amount of plumbing Express gives for free.
- `artifacts/api-server/src/routes/`: the same endpoints as a long lived Express server, importing `@shared/_core` and `@shared/_store`.
- `lib/db/src/schema/`: Drizzle tables, one file per table. The migration source of truth.
- `lib/api-spec/openapi.yaml`: the API contract, source for codegen.

## Architecture decisions

- **One implementation, two HTTP layers.** The Vercel Functions in `api/` and the Express routes both import `api/_core` and `api/_store`, so the serverless and long lived shapes cannot drift. `_store.ts` uses `pg` rather than the Drizzle client because Vercel bundles functions from the repository root, where workspace packages do not resolve.
- **No build step requires an environment variable.** The Vite configs default `PORT` and `BASE_PATH`. They used to throw, which meant the repository could not build on any CI that did not happen to set Replit's variables, Vercel included.
- **The API also serves the site.** `artifacts/api-server/src/lib/static-site.ts` mounts the Vite build with a SPA fallback when it finds one. The platform can still route the two separately, but a single Node process behind a bare domain works with no extra config.
- **Storage degrades instead of failing.** Without `DATABASE_URL` the forms keep entries in memory and set `stored: false` in the response. A brand new deployment never loses a visitor to a missing database.
- **The waitlist receipt is a real hash chain.** Each row links to the previous row's hash, mirroring the product's own saga ledger, so the receipt on screen means something.
- **Everything content lives in one module.** Sections import from `site-data.ts` rather than holding copy inline, which is what makes the Czech mutation and the spec page cheap to keep in sync.
- **Recharts and every subpage are lazily loaded.** The homepage ships roughly 150kB gzipped of JS. Charts (109kB gzipped on their own) arrive after first paint.
- **Light is the default theme for every visitor,** regardless of `prefers-color-scheme`. It is the site's look, so a first time visitor sees it whatever their operating system is set to. A stored choice still wins, and the nav toggle reaches the dark theme. Changing that back to following the system is one line in `useTheme` plus one in the pre-paint script in `index.html`.
- **Motion is transform and opacity only.** Reveals deliberately do not animate `filter: blur()`: it forces a compositing layer per element and is the difference between smooth and janky on a mid range phone.

## Product

A single long homepage plus real subpages:

- `/` hero with a typing terminal, integration marquee, the gap, six mechanisms, a photographic band, install tabs, the replay demo, topology, reversibility classes, telemetry charts, rollout, pricing, field notes, the compliance record, FAQ, the access form and an explore grid.
- `/spec` the nine section technical specification with a sticky table of contents and a twenty tool compensation table.
- `/docs` and `/docs/:slug` five real pages: quickstart, policy language, ledger format, MCP proxy, writing an adapter.
- `/pricing` plans plus a protected actions calculator.
- `/security`, `/compliance`, `/changelog`, `/blog` and `/blog/:slug` (three long posts), `/status` (live, calls `/api/status`), `/company`, `/contact`.
- `/cs` a full Czech mutation with translated navigation and footer.
- A 404 with a dissolving wordmark.

## User preferences

- Never use an em dash or an en dash anywhere: UI copy, code comments, commit messages, README. Use a comma, a colon, parentheses, or split the sentence. For ranges write "X to Y". Plain hyphens inside words are fine.
- No fabricated companies, logos, customers or certifications. Every metric or quote carries a visible "illustrative" label, and the footer keeps the concept disclaimer.
- Animation everywhere, but it must run on every device: no hover only affordances, no effect that a phone cannot do at 60fps, and `prefers-reduced-motion` respected throughout.
- The design is deliberately not all ASCII. Monospace is an accent, not the whole language.

## Gotchas

- **Prefix every keyframe with `v-`.** Tailwind ships `ping`, `spin`, `pulse`, `bounce` and more. An unprefixed `@keyframes ping` is silently overridden by Tailwind's, which scaled the live status dot to 2x and faded it to nothing.
- **Never write a bare descendant `span` rule.** `Counter` and `Scramble` render inline spans, so `.stat span { font-size: 13px }` shrinks the number it was meant to label. Scope those rules to `> span`.
- **`display: grid` on a `ul` or `ol` removes the list markers** in Chromium. Use margins between items.
- **`vite preview` only proxies GET.** Test form posts against the API server (which serves the build) rather than the preview server.
- **`lib/db` throws at import time when `DATABASE_URL` is missing.** `storage.ts` imports it lazily inside a try; keep it that way or the API cannot boot without a database.
- **Never let a build config throw on a missing environment variable.** `PORT` and `BASE_PATH` now default. The previous `throw` made `pnpm run build` fail on every machine outside Replit.
- **`api/tsconfig.json` must describe a real emit.** The Vercel Node builder compiles the functions with that exact file, so `noEmit: true` there fails the deploy with `Error: api/contact.ts: Emit skipped`. It is standalone rather than extending the base config, because the base sets `noEmitOnError`, `module: esnext` and a workspace resolution condition, and the repository root has no `"type": "module"`, so functions are emitted and loaded as CommonJS. `pnpm run typecheck` compiles them for real into a scratch directory to catch this locally.
- **Anything under `api/` must import only npm packages and relative files.** Vercel bundles those functions from the repository root, where `@workspace/*` does not resolve. `zod` and `pg` are root dependencies for exactly this reason.
- **Do not exclude workspace packages in `.vercelignore`.** `pnpm install --frozen-lockfile` fails if a package the lockfile knows about is missing from the upload.
- **`pg` is imported statically in `api/_store.ts`.** A dynamic `import("pg")` bundled into ESM output dies with "Dynamic require of events is not supported", and the storage fallback hides it as a quiet `stored: false`.
- Before pointing a domain at the site, replace `https://void.systems` in `artifacts/void/index.html` and in `artifacts/void/public/{sitemap.xml,robots.txt}`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
