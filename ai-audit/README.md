# AI audit trail

Evidence of AI-assisted engineering with **mandatory human review** — aligned with how an AI-native BI role should work day to day.

| Folder | Contents |
|--------|----------|
| `prompts/` | Prompts used for the hardest modules |
| `rejected/` | AI suggestions that were **not** merged, with why |
| `reviewed-diffs/` | Human-reviewed diffs for schema versioning + HITL approval gate |

Rule of thumb used here: AI drafts; humans own the failure mode (silent metric drift).
