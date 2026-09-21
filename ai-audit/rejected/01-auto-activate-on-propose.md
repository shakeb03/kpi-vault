# Rejected — Auto-activate proposed metric versions

**AI suggestion:** On `POST /metrics/:key/propose`, set the new version to `active` immediately and keep a “changelog” for awareness.

**Why rejected:**
- Defeats the product goal: Marketing would see DAU jump before Design (or vice versa) agreed on the definition.
- Turns the registry into a blog, not a control plane.
- Audit would record history but could not prevent trust breakage.

**Kept instead:** `pending` versions + `pending_changes` row; dashboards ignore anything not `active`.
