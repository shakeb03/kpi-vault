# Reviewed diff — Schema versioning + approval gate

Human-reviewed shape that shipped (abridged). Full SQL lives in `server/sql/schema.sql`; handlers in `server/src/metrics.js`.

## Tables

```sql
-- definitions are stable keys; versions carry the mutable contract
metric_definitions (id, key, name, description, active_version)
metric_versions (
  metric_id, version, definition_sql_stub, definition_json,
  status CHECK IN ('active','pending','rejected','superseded'),
  proposed_by, proposed_at, reviewed_by, reviewed_at, review_note
)
pending_changes (
  metric_version_id, metric_id, from_version, to_version,
  status CHECK IN ('pending','approved','rejected'), ...
)
audit_log (action, actor, actor_role, entity_type, entity_id, detail, created_at)
```

## Gate behavior (reviewed)

1. `propose` inserts `metric_versions.status = 'pending'` + `pending_changes.status = 'pending'`. Does **not** bump `active_version`.
2. Dashboard SQL joins `metric_versions` where `version = active_version AND status = 'active'`.
3. `approve` transaction: old version → `superseded`; new → `active`; bump `active_version`; clear Redis `dash:*`.
4. `reject` requires `review_note`; version → `rejected`; dashboards unchanged.

## Deliberate non-cleverness

- No ORM migrations framework — one init SQL for the slice.
- Definition execution is interpreted in Node from `definition_json` (stubs, not arbitrary SQL exec) to avoid SQL injection theater in a portfolio slice.
- Actor via `X-Actor` header for demo HITL; real SSO later.
