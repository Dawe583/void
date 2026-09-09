# Security review, adversarial pass 2

## Scope and evidence

Reviewed the WP-15 context pack, commit ecdd151f, ledger storage/signing/
verification/attestation, proxy framing/session/forwarding, policy parsing and
channels, control-plane API, and approval-state changes from wave 5.
This is a targeted source review, not a claim that every repository file or
external dependency received a complete audit.

Threats: hostile upstream MCP server, hostile agent, hostile local user, and
malicious ledger files. A local upstream running as the proxy OS user is not
sandboxed. It can read that user's files. Local development keys cannot protect
against a compromise of that same user.

Native command execution is currently blocked by `bash(): orphan-journal
enrollment failed`. The parent ran RED tests and observed assertion failures. Five targeted fixes
are written; parent-run GREEN tests passed 8/8. Ledger and proxy typechecks
also passed. The RED runner
reported exit 0 despite assertion failures, so GREEN must use TAP and inspect
the failure count. Parent owns full workspace fan-in.

## Findings

| ID | Severity | Finding and impact | Status and owner track |
| --- | --- | --- | --- |
| S01 | High | `ledger/src/store.ts` catches every read error as empty content. A directory at the ledger path makes verification claim a valid zero-entry chain. Permission and I/O failures must not look like absence. | Fixed, parent-run regression tests pass; adversarial-2 |
| S02 | High | Store and chain verification do not bind unsigned envelope workspace to signed body workspace. A valid ledger can be copied or relabeled into another workspace, and `attestLedger` will sign that new workspace label. | Fixed, parent-run regression tests pass; adversarial-2 |
| S03 | High | `proxy/src/forward/tools.ts` returns arbitrary dependency exception text as a denial rationale. A signer/store/policy exception containing a credential reaches the hostile agent. | Fixed, parent-run regression tests pass; adversarial-2 |
| S04 | High | HTTP SSE retains unlimited partial lines. `maxBufferSize` only checks completed `data:` lines, so a stream without newlines or a huge comment can exhaust memory. Empty data lines also consume an unbounded array when delimiters are excluded from the event count. | Fixed, parent-run regression tests pass; adversarial-2 |
| S05 | High | Control-plane approval POST accepts cross-origin `text/plain` JSON without Origin or Host validation. A website can send a simple POST to localhost to approve a known or guessed hold. No CORS response header does not prevent this write. | Flagged for ui-wiring, parent must authorize server scope |
| S06 | High | Blast-radius policy trusts agent `rows`, `count`, `limit`, or `n`, including negative values, when no probe exists or a probe fails. The caller can claim a small count to reach an allow rule. This violates the measured-count contract. | Partly fixed: negative, fractional, unsafe-integer and non-numeric agent counts are ignored. Positive counts still need parent/proxy owner decision; existing fallback contract retained |
| S07 | Medium | Unknown/unclassified tools become R3 but can still pass a broad allow rule. R3 substitution alone is not unconditional denial. | Parent explicitly retained this operator foot-gun this wave. Use shipped strict/balanced packs, not broad allow rules. No semantics changed |
| S08 | High | Feed/API and SDK verification paths call `verifyChain` without a key, then expose `verified: true` or accept startup. A locally rewritten and rehashed ledger can pass without a valid signature. | Parent design decision pending; distinguish chain integrity from authenticated verification and pin a trusted key. No signature-verification refactor this wave |
| S09 | Medium | Signature verification accepts any next key returned by an injected lookup. There is no outgoing-key-signed rotation transition or validity-window enforcement. The default dev provider only recognizes its single key, so arbitrary attacker keys are not accepted by default. | Flagged for parent/ledger owner; define rotation before multi-key providers ship |
| S10 | Medium | Notification relaying and stdout writes have no backpressure. A valid progress flood can grow the output queue even after SSE framing is bounded. Agent stdin uses readline before the line ceiling, so an unterminated inbound line can also grow without limit. | Flagged for parent/proxy owner; bound raw input and queued output, terminate abusive sessions |
| S11 | Medium | Session coerces numeric strings, so `1`, `"1"`, and `"01"` collide. It accepts unsafe integers and retains used IDs forever. The runProxy server-request relay receives Session but not its nested maps, so server response remapping is not recorded. | Flagged for parent/proxy owner; preserve typed IDs and reject duplicate active requests |
| S12 | Medium | Policy validator can throw on `rules: [null]`, accepts empty array match as catch-all, and accepts invalid class values. Null validation throws before the documented typed load error. YAML parser error text can include source snippets in startup logs. | Flagged for policy-packs/parent policy owner; pack loader catches throws but core validator remains incomplete |
| S13 | Medium | Ledger readers load entire files into memory. A malicious multi-GB file can exhaust CLI, SDK, or control-plane memory. | Flagged for replay-registry/parent ledger owner; bounded streaming parser or explicit size ceiling |
| S14 | Medium | Slack webhook URL is operator-configured but has no HTTPS/host/redirect policy, and response bodies enter failure messages. Policy rationale is intentionally shown to the agent and Slack, so it must never contain secrets. | Flagged for parent/policy channel owner; operator input is not a remote-user SSRF boundary today |
| S15 | Medium | Local upstream inherits the proxy environment, including `VOID_SIGNING_KEY` if configured. Same-user local processes can also read development key files. | Flagged for parent/proxy owner; strip proxy-only secrets as defense in depth and document lack of OS isolation |
| S16 | Medium | Approval persistence originally trusted existing directory permissions and symlinks despite creating new paths with 0700. Existing public-write directories do not become private through recursive mkdir. | Flagged for approve-command; owner reports directory/file mode, symlink, and 1 MiB checks added; verification pending |

## Fixed-now scope

* Only ENOENT becomes empty ledger content. Other read errors propagate.
* Store verification binds requested workspace, envelope, and signed body.
  Chain verification binds envelope to signed body. Attestation creation rejects
  an input workspace different from its requested workspace.
* Dependency failures return a generic denial, without raw exception text.
  Raw text is not copied into logs either, because it can contain secrets.
* SSE rejects oversized completed and partial lines, including comments. Empty
  data lines count toward the event budget. Refused readers are cancelled.
* Agent radius fallback accepts only nonnegative safe integers. Existing valid
  positive fallback and authoritative probe behavior stay unchanged.

## Checks that did not establish a vulnerability

* JSON.parse consumes the entire framed message. Two JSON objects on one line
  are rejected, not parsed as a first object plus a hidden second request.
  Newline-separated objects are separate MCP messages, as intended.
* Entry signature tag, entry algorithm, and signed preimage algorithm are
  checked on authenticated verification. Unsupported algorithms fail. A
  multi-algorithm provider and rotation remain unsupported, not silently valid.
* Merkle pairs preserve input order. Reversing two distinct hashes changes the
  digest. Duplicating an odd terminal leaf is standard here; the signed
  attestation also binds entry count and head. This is not an unordered-set
  digest.
* Attestation signature binds its workspace. `verifyAttestation` compares that
  workspace to entry envelopes. The S02 gap is the missing binding from those
  envelopes back to signed bodies and to the workspace being attested.
* Installed YAML source sets `maxAliasCount` to 100 and rejects excess alias
  expansion. Billion-laughs protection is not disabled. Policy text still has
  no file-size ceiling.
* Operator-selected `--policy ../../path` is not a path-containment boundary.
  It is an intentional ability to choose a local file, not remote traversal.
* Control-plane request bodies already have a 64 KiB ceiling. Oversize or bad
  JSON currently returns an internal error rather than a precise 413/400.
  Static paths use decoded-path containment; no URL traversal escape found.
  Static symlinks remain trusted deployment content.

## Verification evidence

Parent ran `node --test packages/ledger/src/security.test.ts packages/proxy/src/security.test.ts`
after the fixes and reported exit 0 with this tail:

```text
tests 8
pass 8
fail 0
```

Parent also ran the complete affected package suites and typechecks:

```text
TSC_LEDGER=0
TSC_PROXY=0
security suites: tests 8, pass 8, fail 0
ledger full: pass 49, fail 0
proxy full: pass 79, fail 0
```

These are parent-run results because this child could not start native commands.
The full workspace fan-in is separate.

## Verification commands

From repository root, before and after fixes:

```sh
node --test --test-reporter=tap packages/ledger/src/security.test.ts packages/proxy/src/security.test.ts
CI=true npx tsc -p packages/ledger/tsconfig.json
CI=true npx tsc -p packages/proxy/tsconfig.json
```

The parent must run the complete package and e2e suites after all tracks land.
No dependency was added. No authentication, rotation, parser-format, or
approval-queue contract was silently redesigned by this review.
