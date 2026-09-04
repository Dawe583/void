# @void/registry

The Reversibility Registry: the classification data, and later the case
evaluator that reads it.

## Responsible for

An entry does not carry a class. It carries an ordered list of cases, each
guarded by a precondition, because reversibility is a property of a call
evaluated against the state of its target. This package owns that data, the
types describing it, the pure queries over it, and `REGISTRY_DISCLAIMER`, which
travels with the data verbatim wherever the data goes.

It is one module for one reason: the page at `/registry`, the endpoint at
`/api/registry` and the classification made at intercept time must not be able
to disagree about what a class means.

## Must never import

Nothing. Not the ledger, not a workspace package, not a node builtin, not zod.
It is data and pure functions, which is what lets the browser bundle, the Vercel
Function and the runtime all read the same module.

## Where the data actually lives

`api/_registry.ts`, still, and `src/index.ts` re-exports it. That direction is
deliberate: a relative import that leaves `api/` raises the inferred emit root of
`api/tsconfig.json` to the repository root, every compiled function moves from
`<out>/registry.js` to `<out>/api/registry.js`, and Vercel resolves no route at
all. `tsc` exits 0 on that. See `docs/DECISIONS.md` 6b.

The move happens at WP-04a, in the opposite direction: `api/_registry.ts` becomes
`export * from "@void/registry";`, a bare specifier resolved through
`node_modules`, which is the only form that leaves the flat emit untouched. It is
gated on a preview deploy.

Consumers today are unchanged and must stay that way until that commit:
`artifacts/void/src/pages/registry.tsx` and `artifacts/api-server` use the
`@shared/*` alias, `api/registry.ts` uses `./_registry_http`.

## Public surface

Re-exported from `api/_registry.ts`:

- Types: `RegistryTone`, `RegistryCase`, `RegistryEntry`, `RegistryQuery`
- Data: `registry`, `REGISTRY_VERSION`, `REGISTRY_DISCLAIMER`, `TONE_LABEL`
- Queries: `worstCase`, `bestCase`, `isConditional`, `spread`, `findEntry`,
  `searchRegistry`, `registryVendors`, `registryTags`, `registryStats`

The case evaluator, which answers "which case holds for this call against this
declared configuration", is WP-04a and does not exist yet.
