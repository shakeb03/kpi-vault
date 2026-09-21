# Prompt — Metric registry + HITL gate

**Goal:** Design Postgres schema + API so KPI definition changes cannot affect dashboards until a human approves.

**Constraints given to the model:**
- Metrics: DAU, D1 retention, revenue proxy
- States: active / pending / rejected / superseded
- Dashboards must join only `status = 'active'` versions
- Reject requires a non-empty review note
- One open pending change per metric
- Audit every propose / approve / reject
- Redis cache must invalidate on approve

**Ask:** Propose schema tables and Express handlers. Prefer boring SQL over clever ORMs.

**Human follow-up:** Rejected auto-apply-on-propose and “soft publish” ideas — see `../rejected/`.
