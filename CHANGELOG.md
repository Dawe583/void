# Changelog

All notable user-facing changes since the first repository commit.

## Unreleased

### Added

- d125b7e9: Restored the product baseline from upstream history.
- 9ef84fe2: Synchronized the product branch with upstream history.
- f40bbead: Improved the interactive telemetry and replay story.
- 976e0bd2: Added the first registry, hold, shadow run, taint, and attestation concepts.
- f120d562: Added the product build plan.
- b02de3b4: Added the workflow execution plan and market plan.
- b2d3e9f1: Added the package scaffold and authoritative context pack.
- 4a157891: Added the terminal interface workstream to the plan.
- e9f55b1f: Added a visual preview for the terminal interface.
- e3093e56: Added the workbench master prompt.
- af093034: Added the terminal render model.
- c074fd5f: Added the Agent Workbench workstream.
- 1107eecb: Added the append only ledger, canonical form, signing, and verification.
- 0d2e0059: Added runtime registry evaluation.
- f7b89d77: Added declared facts loading and precondition validation.
- ec9ad970: Added a complete MCP message inventory for the proxy.
- c6adaeb0: Fixed terminal classification coverage found in review.
- 07970ddd: Added the proxy inventory verification checklist.
- 5d878b52: Added policy loading, decisions, and blocking holds.
- a692f88b: Added the terminal approval channel.
- 1200068b: Changed the proxy interface from draft to frozen contract.
- 523c26f6: Added review helpers, Slack-shaped approvals, and the demo moment.
- 400bdf08: Added the first control plane pages.
- 532354ed: Added the proxy message pipeline.
- bd78892e: Improved terminal watch and approval views.
- f1b11092: Added an adversarial registry migration audit.
- f5e0372c: Improved the root project explanation.
- 75edef91: Expanded the demo moment and terminal preview.
- 02909fa6: Added verified ledger feed support and the feed command.
- 2c3ee6a0: Added SQL parsing support for connector classification.
- b0cff15a: Changed connector and snapshot store contracts from draft to frozen.
- cb5b0626: Changed the proxy to write real ledger entries during interception.
- 6e36fb25: Added replay planning against snapshot manifests.
- b1c28f5e: Added blast radius probes.
- 662cbe62: Added S3 connector capture and restore logic.
- 698e9bc2: Added local and S3-backed snapshot stores.
- b7c1b919: Added Postgres connector capture, inverse, and replay logic.
- 371c4d2c: Added connector round trip proof for restore and drift refusal.
- eb776cf9: Added the local control plane API server.
- c327656e: Added approval broker wiring for held calls.
- 7fd9d6b3: Added taint graph construction from ledger entries.
- 1b9176d7: Added Streamable HTTP upstream transport support.
- 8644f817: Added taint graph querying from the CLI.
- cedff44a: Expanded registry coverage across more agent tool surfaces.
- a6150688: Added signed ledger attestations and standalone verification.

### Changed

- 69fa9a41: Refreshed the dependency set and prompt asset used by the workspace.
- 0ce7cc61: Refreshed the VOID artifact with new interface components and assets.
- 2eeae3f1: Rebuilt the site with a fuller design system, complete pages, and a working backend.
- 9fc95d90: Changed the default site theme to light.
- a2000b64: Restored the site to the original Replit-style visual language.
- 41357f32: Adjusted the site palette toward beige paper and burnt orange.
- 93c19b96: Improved the dark theme and strengthened the warm palette.
- 4ef6f792: Reworked deployment wiring so the live pieces connect correctly.
- 170f7afc: Moved this repository to product-only focus after the site split.
- 86586427: Added classification for the pilot registry entries and the classify command.
- a7e666ec: Changed remaining registry entries to structured guards.
- 59b88a25: Added the runnable proxy binary.
- e84e6657: Changed blast radius handling to prefer measured probe results.
- f9790f24: Added connector lookup and snapshot manifest wiring.
- Lowered the declared Node.js floor from >=26 to >=24 so hosted build platforms that offer Node 24 can build the repo; verified green under Node v24.21.0.

### Fixed

- 32e9d891: Made the repository deployable on Vercel and exposed the API through serverless functions.
- 5b8d7013: Fixed the serverless function build so it emits deployable code.
- 8b097a19: Fixed registry guards that matched too broadly.
- 04e19881: Fixed hold error wording.

### Added since wave 4

- 79d8683: Added the whole-product arc e2e moment.
- 3a482ca: Synced operator docs to the wave 5 surfaces.
- 411d505: Audited the 270 registry entries and pinned the invariants.
- 7041b06: Hardened the wave-5 surface in an adversarial pass.
- 6967fcc: Closed S08 for the control plane with signature aware feeds.

### Fixed since wave 4

- The control plane verify endpoint now reports signed separately from chain
  integrity, and the web UI downgrades to an integrity-only warning when no
  signing key is configured instead of labeling a hash-only view verified.
- The decision endpoint rejects posts that do not carry an application/json
  content type.
- The unknown-tool classification outcome no longer carries assume or tone
  fields.
