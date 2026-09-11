# VOID project guidance

For the GUI upgrade, read `docs/GUI-UPGRADE-PLAN.md` and `docs/GUI-UPGRADE-AUDIT.md` first. These documents describe the requested target and the verified baseline, not completed implementation.

The user requested active use of these installed skills throughout this work:

- `/Users/dawe/.codex/skills/caveman/SKILL.md`: concise Czech communication; preserve complete technical detail in explicitly requested plans and reports.
- `/Users/dawe/.codex/skills/ponytail/SKILL.md`: reuse existing capabilities, avoid unnecessary infrastructure, and never omit requested features, accessibility, validation, or verification.

The intended default for new GUI conversations is TokenRouter / GLM 5.3 Free: provider `tokenrouter`, API model `z-ai/glm-5.3-free`, endpoint `https://api.tokenrouter.com/v1`. The OpenCode selection identifier is `tokenrouter/z-ai/glm-5.3-free`; do not send that provider-prefixed identifier as the API model. Never put credentials into source, documentation, browser storage, or logs. Existing conversations retain their provider/model snapshot.
