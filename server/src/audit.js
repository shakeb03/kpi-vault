import { query } from "./db.js";

export async function writeAudit({ action, actor, actorRole, entityType, entityId, detail }) {
  await query(
    `INSERT INTO audit_log (action, actor, actor_role, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [action, actor, actorRole, entityType, entityId, JSON.stringify(detail || {})]
  );
}

export async function listAudit(limit = 100) {
  const { rows } = await query(
    `SELECT id, action, actor, actor_role, entity_type, entity_id, detail, created_at
     FROM audit_log ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}
