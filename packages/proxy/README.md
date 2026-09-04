# @void/proxy

The MCP proxy. It terminates the agent's connection as a server and opens its own
to the upstream server as a client.

## Responsible for

Being transparent, then being a checkpoint. Every message forwarded honestly in
both directions, including notifications, with no capability advertised that the
upstream does not have. Around `tools/call` it classifies, asks policy, records
to the ledger, and holds or denies.

Phase 1 is **stdio only**. Streamable HTTP is WP-02, and it arrives with its own
exit criteria: localhost binding, Origin validation, a required bearer token.

## Posture

Fail closed. An unknown tool, an unclassified call, a ledger append failure, a
missing or invalid policy file and an internal error all resolve to deny. Observe
only is an explicit opt in flag, never a fallback. This trades availability for
safety: a VOID crash becomes an outage of the agent's write path, and the first
user is told so.

## Must never import

A connector. It resolves them by id through a list it is handed, so adding a tool
surface stays additive. It does not import the site, the control plane or
`@workspace/*`.

## Must never do

Return a generic error on a deny or a cancel. The error names the rule id, the
class and what approval would require, because a vague refusal trains agents to
retry with a reworded request, which turns a safety tool into an evasion trainer.

## Public surface

- `Posture`, `DEFAULT_POSTURE`
- `Transport`, `SUPPORTED_TRANSPORTS`, `isSupportedTransport`

The transports and the message path are WP-01 and WP-02 and do not exist yet.
