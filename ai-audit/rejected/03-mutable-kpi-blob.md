# Rejected — Single “KPI JSON” blob per title

**AI suggestion:** Store one mutable JSON document of all KPIs per title; overwrite on edit.

**Why rejected:**
- No version identity → cannot say “dashboard was on v3 when Marketing approved spend.”
- No clean approve/reject diff.
- Cross-title comparison becomes “whatever was last written.”

**Kept instead:** `metric_definitions` + `metric_versions` with integer versions and status.
