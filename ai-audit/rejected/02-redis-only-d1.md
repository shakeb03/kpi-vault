# Rejected — Compute D1 in Redis only

**AI suggestion:** Maintain D1 retention entirely as Redis sets (day0 cohort / day1 returners) without Postgres truth.

**Why rejected:**
- Fine for a demo hot path; unsafe as source of truth if Redis flushes or TTL skews cohorts.
- Definition changes (e.g. “return = session_start only” vs “any event”) require rebuild from raw events.

**Kept instead:** Postgres computes from `events`; Redis caches the **dashboard payload** with short TTL + explicit invalidation.
