# VOID agent workbench

An OpenAI-compatible model loop whose tools always go through the VOID SDK and
its fail-closed MCP proxy. There is no direct shell or database tool bypass.

The runtime owns provider validation, model discovery, session state, cancellation
and the shared approval broker. GUI and `void agent` consume this domain.

Configure `VOID_UPSTREAM_COMMAND` as a JSON array, `VOID_POLICY_PATH` as a policy
file, and optionally `VOID_FACTS_PATH` and `VOID_LEDGER_DIR`. A missing upstream or
policy refuses the session. Each session has its own ledger workspace, avoiding
concurrent writers to the same JSONL chain.

Set `OPENROUTER_API_KEY` and optional `VOID_PROVIDER_URL`, or validate a provider
through the GUI. GUI keys are held only in process memory; they are never saved
in configuration, transcripts or the ledger. This beta does not implement OS
keychain persistence. Prompts and tool results are sent to the configured model
provider. A successful model catalog request is required before showing connected.

The beta supports one active session, 20 model turns per message, 4096 output
tokens per turn and a 100-session runtime cap. Transcripts are in memory, limited
to 200 events. Signed tool ledgers remain on disk after runtime restart. Model
responses are displayed after each completion, not token streamed. There is no
claim of Codex/Claude Code/OpenCode process adapters, PTY, or desktop packaging.
Those are separate AW work packages.

Validation: `node --test packages/workbench/src/workbench.test.ts` drives real MCP
fixture processes behind a local provider test double, including approval denial.
It does not spend credits or claim external-provider account validation.
