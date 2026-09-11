# VOID: context

With `DECISIONS.md` and `STANDARDS.md` this is the context pack and it is
authoritative. When code disagrees with the pack, the code is wrong; when the
pack is wrong, a work package updates it. Never diverge quietly.

VOID is a process that sits between an AI agent and the tools it can write to.
For each call it decides a reversibility class from the state of the target,
applies a policy, and appends a signed record to a hash chained ledger. Later it
can replay the inverses. Everything else follows from that sentence. The
marketing site here sells the finished idea; BUILD-PLAN.md section 1 names the
three places it is ahead of what is buildable.

## Vocabulary, used precisely

- **Intercept**: terminate the agent's tool call, decide, then forward, hold or
  refuse it. VOID does not invent business intent. Its authorized managed
  executor performs the requested mutation and later its verified recovery.
- **Classify**: assign a class to one call by evaluating that tool's registry
  cases against the target's state.
- **Class R0 to R3**: fully reversible, reversible with trace, mitigable only,
  irreversible. A class belongs to a call, never to a tool.
- **Precondition**: a fact about the target that must hold for a case to apply,
  such as bucket versioning enabled. Declared, not probed.
- **Case**: one verdict in a registry entry, valid only while its precondition
  holds. Cases are ordered, first match wins.
- **Inverse**: returns the target to its prior state exactly. Only R0 and R1
  have one.
- **Compensation**: reduces the harm of a call with no inverse. R2 has
  compensations, not inverses.
- **Hold**: pause a call and wait for a human decision. Version one blocks.
- **Blast radius**: the count of resources affected, with explicit exact,
  bounded or unknown precision. Sampling cannot prove an exact count or satisfy
  an exact policy limit. Unknown is not zero.
- **Ledger**: the append only, hash chained, per entry signed record of every
  intercepted call.
- **Taint**: a later call's tracked dependency on an earlier one's result, which
  orders a replay correctly.
- **Attestation**: a ledger slice a third party verifies offline, without our
  software and without trusting us.

## Layout after WP-00

The executable recovery contract and current coverage are maintained in
`RECOVERY-CONTRACT.md` and `RECOVERY-COVERAGE.md`. Registry metadata, a connected
account and a working inverse are distinct capabilities. The managed runtime
in `packages/runtime` is being integrated incrementally; legacy hosts are not
automatically covered by its guarantees.

```
api/          Vercel Functions, and still the registry data (DECISIONS 6b)
artifacts/    the site, and the Express layer that serves it
docs/         the context pack and the plans
lib/          site support packages, not product
packages/
  registry/   class data, case evaluator, schema
  ledger/     canonical JSON, chain, signing, stores, verification
  proxy/      MCP proxy: server side, client side, transports
  policy/     match rules, decide, hold, approval channel interface
  connectors/ one per tool surface: facts, snapshot, inverse
  cli/        run, ledger verify, replay, attest
apps/
  control-plane/  approvals, live feed, ledger browser. Paid, later
```

`packages/registry` imports nothing: not the ledger, not node builtins. A
connector never imports another connector. The proxy resolves connectors by id,
never imports one. The ledger exposes `append` and `read`, never `update`.

## The test for whether a change belongs

Does this make the write path more accountable, or is it a feature that happens
to be nearby? If the second, it does not ship. (BUILD-PLAN.md section 1.)

Cloud workspace login uses a Secure, HttpOnly, same-site cookie with a 400-day lifetime renewed on authenticated use. The workspace token remains in server configuration and survives deployments. Logout clears this browser session; token rotation revokes all sessions. Browser data removal or browser expiry policies can still require login. Never embed the token in public assets, source, or URLs.
