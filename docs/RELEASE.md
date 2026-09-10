# VOID 0.1.0 release runbook

## Status and version policy

0.1.0 is a coherent development release, not an npm publication or a production
readiness claim. Product packages use the `@void/<package>` convention. The
root is `@void/workspace`. Keep `private: true` throughout this release. Do not
remove that safeguard to make a publish command pass.

Versions move together while cross-package contracts and the on-disk formats
are being validated. Before 1.0, record incompatible API, policy, snapshot, or
ledger changes explicitly and provide migration instructions. Do not silently
rewrite old signed records. At 1.0, use semantic versioning and publish a
compatibility policy for every persisted format.

## Runtime support

The supported development floor is Node.js 26 (`engines.node: >=26`). Use the
same Node major for development and release CI. This is a support baseline, not
a claim that Ed25519 or `node:test` first appeared in Node 26.

Source review: `tsconfig.base.json` targets ES2022. Product tsconfigs use
`noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, and
`verbatimModuleSyntax`. The binaries import `.ts` files directly. Tests use
`node:test` and `node:assert/strict`; runtime code uses Node crypto, filesystem,
streams, `fetch`, `AbortController`, `Headers`, and `TextDecoder`. None of those
reviewed APIs establishes a Node 26-only runtime requirement. Native TypeScript
stripping is enabled by default from Node 22.18; Decision 6a records a successful
Node 22.22.2 test. An exact older-version compatibility floor has not been
retested for this release and is not supported by the new engine declaration.

Node 26 is the current verification target. Its default spec test reporter is
not accepted by the workspace test-count gate, so use the TAP reporter for
release checks. Do not add an experimental type-stripping flag. Native type
stripping does not make these source packages publishable under `node_modules`;
that restriction is a separate distribution blocker below.

## Done, with evidence boundaries

The wave 4 handoff at commit `cac57d7f` reports **346 package checks and 26 e2e
checks passing**. These are a recorded baseline, not a fresh wave 5 count. The
blackboard contains older totals; do not add them to this baseline. Record the
final revision and fresh totals when integrating wave 5.

Implemented development surfaces include:

- MCP interception with a stdio agent side and stdio or Streamable HTTP
  upstreams, declared facts, policy decisions, blocking holds, and a local
  signed ledger.
- Postgres and S3 connector contracts, snapshots, manifests, inverse planning,
  and target drift refusal with injected executors.
- CLI classification, verified ledger views, replay, taint queries, and
  verification; SDK interception and approval handles; a local control plane
  API and development pages.
- JSONL durability, SHA-256 chaining, Ed25519 signatures, attestations, and
  verification tests that detect tampering. The ledger is tamper evident, not
  tamper proof. A compromised signing host can forge future entries. Published
  checkpoints outside that host's control are needed to anchor past evidence.

The local e2e programs are `scripts/src/e2e.mjs`, `e2e-connectors.mjs`, and
`e2e-final.mjs`. The baseline final sweep contains two honest NOTEs: CLI approval
was missing, and replay through the binary lacked connector wiring. Wave 5
addresses those paths separately. Re-run the sweep before removing either
NOTE. Fixture executors do not prove restoration against a real service.

Wave 5 source status, pending integrated verification:

- `void approve` and the proxy share a filesystem request path. The proxy uses
  `--approvals-dir`, then `VOID_APPROVALS_DIR`, then
  `~/.void/approvals/<workspace>`. An exclusive `proxy.lock` prevents a second
  proxy writer. Binary wiring is implemented; real end-to-end verification is
  still required before closing the baseline NOTE. These files do not prove
  human identity. After a crash, remove a stale lock only after confirming the
  prior proxy exited.
- Replay can plan from persisted Postgres snapshots without an executor. Apply
  reports `ExecutorNotConfigured` without configuration and
  `ExecutorAdapterUnavailable` even when `VOID_PG_URL` is present. No production
  driver is installed. Persisted S3 replay and live binary drift proof remain
  open. In-process injected-executor tests do not close those gaps.

## Blocks public release

1. **npm organization and credential.** Confirm ownership of the `@void` scope
   and choose a scoped publish token or trusted publishing identity. No npm
   credential has been verified here. Never put tokens in a manifest, shell
   transcript, log, test, or release document.
2. **Publish CI.** Add a reviewed, gated publishing workflow with an explicit
   package allowlist, protected release approval, provenance, and a clean
   install test. Keep all packages private until that workflow is ready. A
   green local suite is not evidence that a release workflow ran.
3. **Installable artifacts.** Current exports point to TypeScript source and
   several modules use relative imports across package directories. Node does
   not strip TypeScript inside `node_modules`, and a separately packed package
   cannot assume its sibling source tree exists. Define and test a compiled or
   bundled distribution before npm publication. Include policy pack YAML,
   registry disclaimers, license text, and required runtime assets. Root bin
   mappings only expose development entrypoints; they do not solve this.
4. **Real-service e2e.** Use a service machine with disposable Postgres and
   S3-compatible storage. Prove direct versus proxied transcripts, an R3 hold
   cancelled before any write, an inverse with exact before/after comparison,
   and refusal after target drift. No production accounts or autonomous writes
   to customer data. Replay apply still needs a real executor supplied by the
   host; a configured URL alone is not a database driver.
5. **Credential-blocked git push.** The handoff reports that pushing is blocked
   by repository credentials. A human must restore authorized access, then
   push the reviewed branch and release tag. No push or remote CI result is
   claimed by this runbook.
6. **WP-15 delivery evidence.** A published `@void/cli` version, clean-machine
   quickstart under five minutes, Docker image, and MCP registry listing still
   require release evidence. The WP-15 exit is not complete just because the
   source and metadata are present.
7. **Security and licensing signoff.** Resolve release-blocking findings in
   `packages/security-notes.md` after the wave 5 adversarial review. In
   particular, unclassified calls permitted by broad allow rules and unmeasured
   blast radius trusted from arguments remain blockers until fixes and
   regression tests prove otherwise; hash-only views labeled verified are closed
   for the control plane, which now distinguishes chain integrity from
   signature-checked verification and never reports verified without a
   configured key. The
   control-plane decision endpoint now rejects posts that do not carry an
   application/json content type, with a regression test; the remaining
   control-plane blocker is that the whole surface is unauthenticated and
   localhost-only by convention, not by enforcement. The root `LICENSE` is Apache 2.0 and product metadata matches it. Confirm NOTICE and
   the registry disclaimer are included in each distributed artifact. Decision
   5 reserves paid features, but the control plane manifest currently declares
   Apache 2.0; resolve that boundary deliberately before distribution. This
   task does not create a new license or silently relicense a package.

## Verification and release sequence

Run from the repository root on a clean, reviewed revision. The root maintainer
owns dependency installation and the lockfile. Do not install during a worker
verification run.

1. Record `git rev-parse HEAD`, `node --version`, and `pnpm --version`. Confirm
   the tree contains only the intended release changes and no credentials.
2. Check entrypoint syntax and release metadata:

   ```sh
   node --check packages/cli/bin/void.mjs
   node --check packages/proxy/bin/void-proxy.mjs
   node --test --test-reporter=tap scripts/src/release-packaging.test.mjs
   ```

3. Typecheck each directory under `packages/` with
   `CI=true npx tsc -p tsconfig.json` from that package directory. Also check
   `apps/control-plane`. Then run the integrated gates:

   ```sh
   pnpm run typecheck
   pnpm test
   node scripts/src/e2e.mjs
   node scripts/src/e2e-connectors.mjs
   node scripts/src/e2e-final.mjs all
   ```

   Confirm nonzero test counts, zero failures, and no skipped release gates.
   Keep any unresolved e2e NOTE in the release report.
4. Run the benchmark on the service machine and record the command, machine,
   runtime, workload scale, p50/p95/p99, and sample counts. A fixture benchmark
   is not a production latency guarantee.
5. Complete the real-service checks above. Review fail-closed failures, stale
   approvals, ledger tampering, drift, and shutdown behavior. Verify signatures
   using trusted public keys; a hash-only check is not signer authentication.
6. After the distribution blockers are fixed, run `npm pack --dry-run` for each
   intended public package. Inspect every file. Install the resulting tarballs
   in a clean external directory, without workspace symlinks, and run both
   bins, policy pack loading, and the five-minute first-hold quickstart.
7. Obtain human approval for publishing, confirm npm identity without exposing
   credentials, run protected CI, and publish only the reviewed artifacts.
   Verify the published version with `npm view @void/cli version`. Record the
   tag, commit, artifact digests, provenance, and remote workflow URL.

If a released artifact fails verification, stop rollout. Deprecate the bad npm
version and ship a corrected version rather than replacing it. Restore the last
verified binary only if its persisted-format compatibility is proven. Never
truncate, rewrite, or delete ledger records as a release rollback.

## 1.0 checklist

- [ ] All publication and WP-15 blockers above are closed with command output.
- [ ] Independent clean-machine install reaches the first hold in five minutes.
- [ ] Postgres and S3 restore and drift refusal pass against disposable services.
- [ ] Unknown tools, unclassified calls, invalid policy, internal errors, and
      failed ledger appends cannot widen into permission to write.
- [ ] Human approval identity, local trust boundaries, and remote authentication
      are specified and tested. Development approvals are not an identity system.
- [ ] API, CLI, policy grammar, snapshot format, and ledger format compatibility
      promises have migration and downgrade tests.
- [ ] Offline attestation verification has trusted key distribution and a
      separately installable verifier with no VOID package dependency.
- [ ] Security review findings are resolved, accepted risks are explicit, and
      key rotation, backup, recovery, and checkpoint procedures are exercised.
- [ ] License boundaries, NOTICE, registry disclaimers, and contribution terms
      are checked in the actual release artifacts.
- [ ] Support ownership, incident handling, rollback, and measured performance
      budgets are documented without claims from fixture-only evidence.
