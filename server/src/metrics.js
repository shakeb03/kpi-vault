import { query, withClient } from "./db.js";
import { cacheGet, cacheSet, cacheDelPattern } from "./redis.js";
import { writeAudit } from "./audit.js";

export async function listMetrics() {
  const { rows } = await query(
    `SELECT d.id, d.key, d.name, d.description, d.active_version,
            v.definition_json, v.definition_sql_stub, v.status AS version_status,
            v.proposed_by, v.proposed_at
     FROM metric_definitions d
     JOIN metric_versions v
       ON v.metric_id = d.id AND v.version = d.active_version AND v.status = 'active'
     ORDER BY d.key`
  );
  return rows;
}

export async function listPendingChanges() {
  const { rows } = await query(
    `SELECT pc.id, pc.metric_id, d.key AS metric_key, d.name AS metric_name,
            pc.from_version, pc.to_version, pc.status, pc.proposed_by, pc.proposed_at,
            pc.reviewed_by, pc.reviewed_at, pc.review_note,
            mv.definition_json AS proposed_definition,
            mv.definition_sql_stub AS proposed_sql_stub,
            ov.definition_json AS current_definition
     FROM pending_changes pc
     JOIN metric_definitions d ON d.id = pc.metric_id
     JOIN metric_versions mv ON mv.id = pc.metric_version_id
     LEFT JOIN metric_versions ov
       ON ov.metric_id = pc.metric_id AND ov.version = pc.from_version
     WHERE pc.status = 'pending'
     ORDER BY pc.proposed_at ASC`
  );
  return rows;
}

export async function proposeMetricChange({
  metricKey,
  definitionJson,
  definitionSqlStub,
  proposedBy,
  actorRole,
}) {
  const { rows: defs } = await query(
    `SELECT * FROM metric_definitions WHERE key = $1`,
    [metricKey]
  );
  if (!defs.length) {
    const err = new Error(`Unknown metric key: ${metricKey}`);
    err.status = 404;
    throw err;
  }
  const def = defs[0];
  const nextVersion = def.active_version + 1;

  // Only one pending change per metric at a time
  const { rows: open } = await query(
    `SELECT id FROM pending_changes WHERE metric_id = $1 AND status = 'pending'`,
    [def.id]
  );
  if (open.length) {
    const err = new Error("A pending change already exists for this metric. Approve or reject it first.");
    err.status = 409;
    throw err;
  }

  const { rows: versions } = await query(
    `INSERT INTO metric_versions
       (metric_id, version, definition_sql_stub, definition_json, status, proposed_by)
     VALUES ($1, $2, $3, $4, 'pending', $5)
     RETURNING *`,
    [
      def.id,
      nextVersion,
      definitionSqlStub || "pending stub",
      JSON.stringify(definitionJson),
      proposedBy,
    ]
  );
  const version = versions[0];

  const { rows: changes } = await query(
    `INSERT INTO pending_changes
       (metric_version_id, metric_id, from_version, to_version, status, proposed_by)
     VALUES ($1, $2, $3, $4, 'pending', $5)
     RETURNING *`,
    [version.id, def.id, def.active_version, nextVersion, proposedBy]
  );

  await writeAudit({
    action: "metric.propose",
    actor: proposedBy,
    actorRole,
    entityType: "pending_change",
    entityId: String(changes[0].id),
    detail: {
      metricKey,
      fromVersion: def.active_version,
      toVersion: nextVersion,
      definitionJson,
    },
  });

  return { change: changes[0], version };
}

export async function approveChange({ changeId, reviewedBy, actorRole, note }) {
  const { rows } = await query(`SELECT * FROM pending_changes WHERE id = $1`, [changeId]);
  if (!rows.length) {
    const err = new Error("Change not found");
    err.status = 404;
    throw err;
  }
  const change = rows[0];
  if (change.status !== "pending") {
    const err = new Error(`Change is already ${change.status}`);
    err.status = 409;
    throw err;
  }

  await withClient(async (client) => {
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE metric_versions SET status = 'superseded'
         WHERE metric_id = $1 AND version = $2 AND status = 'active'`,
        [change.metric_id, change.from_version]
      );
      await client.query(
        `UPDATE metric_versions
         SET status = 'active', reviewed_by = $1, reviewed_at = NOW(), review_note = $2
         WHERE id = $3`,
        [reviewedBy, note || null, change.metric_version_id]
      );
      await client.query(
        `UPDATE metric_definitions SET active_version = $1 WHERE id = $2`,
        [change.to_version, change.metric_id]
      );
      await client.query(
        `UPDATE pending_changes
         SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), review_note = $2
         WHERE id = $3`,
        [reviewedBy, note || null, changeId]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });

  await cacheDelPattern("dash:*");

  await writeAudit({
    action: "metric.approve",
    actor: reviewedBy,
    actorRole,
    entityType: "pending_change",
    entityId: String(changeId),
    detail: {
      metricId: change.metric_id,
      fromVersion: change.from_version,
      toVersion: change.to_version,
      note: note || null,
    },
  });

  return { ok: true, changeId, activeVersion: change.to_version };
}

export async function rejectChange({ changeId, reviewedBy, actorRole, note }) {
  const { rows } = await query(`SELECT * FROM pending_changes WHERE id = $1`, [changeId]);
  if (!rows.length) {
    const err = new Error("Change not found");
    err.status = 404;
    throw err;
  }
  const change = rows[0];
  if (change.status !== "pending") {
    const err = new Error(`Change is already ${change.status}`);
    err.status = 409;
    throw err;
  }
  if (!note || !String(note).trim()) {
    const err = new Error("Rejection requires a review note (why)");
    err.status = 400;
    throw err;
  }

  await query(
    `UPDATE metric_versions
     SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), review_note = $2
     WHERE id = $3`,
    [reviewedBy, note, change.metric_version_id]
  );
  await query(
    `UPDATE pending_changes
     SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), review_note = $2
     WHERE id = $3`,
    [reviewedBy, note, changeId]
  );

  await writeAudit({
    action: "metric.reject",
    actor: reviewedBy,
    actorRole,
    entityType: "pending_change",
    entityId: String(changeId),
    detail: {
      metricId: change.metric_id,
      fromVersion: change.from_version,
      toVersion: change.to_version,
      note,
    },
  });

  return { ok: true, changeId, status: "rejected" };
}

function dayBounds(dayOffset = 0) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  const start = d.toISOString();
  const end = new Date(d.getTime() + 86400000).toISOString();
  return { start, end, day: start.slice(0, 10) };
}

async function computeDau(titleId, definitionJson) {
  const eventTypes = definitionJson.event_types || ["session_start"];
  const { start, end } = dayBounds(0);
  const { rows } = await query(
    `SELECT COUNT(DISTINCT player_id)::int AS value
     FROM events
     WHERE title_id = $1
       AND event_type = ANY($2::text[])
       AND occurred_at >= $3 AND occurred_at < $4`,
    [titleId, eventTypes, start, end]
  );
  return { value: rows[0]?.value || 0, window: "today_utc", eventTypes };
}

async function computeD1(titleId, definitionJson) {
  const cohortEvent = definitionJson.cohort_event || "install";
  const returnAny = definitionJson.return_any_event !== false;
  const returnTypes = definitionJson.return_event_types || null;
  const { start: d0s, end: d0e } = dayBounds(-1);
  const { start: d1s, end: d1e } = dayBounds(0);

  const { rows: cohort } = await query(
    `SELECT DISTINCT player_id FROM events
     WHERE title_id = $1 AND event_type = $2
       AND occurred_at >= $3 AND occurred_at < $4`,
    [titleId, cohortEvent, d0s, d0e]
  );
  const cohortSize = cohort.length;
  if (!cohortSize) {
    return { value: null, cohort: 0, retained: 0, window: "installs_yesterday → return_today" };
  }
  const ids = cohort.map((r) => r.player_id);
  let retainedRows;
  if (returnAny) {
    ({ rows: retainedRows } = await query(
      `SELECT COUNT(DISTINCT player_id)::int AS retained FROM events
       WHERE title_id = $1 AND player_id = ANY($2::text[])
         AND occurred_at >= $3 AND occurred_at < $4`,
      [titleId, ids, d1s, d1e]
    ));
  } else {
    ({ rows: retainedRows } = await query(
      `SELECT COUNT(DISTINCT player_id)::int AS retained FROM events
       WHERE title_id = $1 AND player_id = ANY($2::text[])
         AND event_type = ANY($3::text[])
         AND occurred_at >= $4 AND occurred_at < $5`,
      [titleId, ids, returnTypes || ["session_start"], d1s, d1e]
    ));
  }
  const retained = retainedRows[0]?.retained || 0;
  return {
    value: Math.round((retained / cohortSize) * 1000) / 10,
    unit: "percent",
    cohort: cohortSize,
    retained,
    window: "installs_yesterday → return_today",
  };
}

async function computeRevenue(titleId, definitionJson) {
  const eventTypes = definitionJson.event_types || ["purchase"];
  const scale = definitionJson.scale ?? 0.01;
  const { start, end } = dayBounds(0);
  const { rows } = await query(
    `SELECT COALESCE(SUM(revenue_cents), 0)::bigint AS cents
     FROM events
     WHERE title_id = $1
       AND event_type = ANY($2::text[])
       AND occurred_at >= $3 AND occurred_at < $4`,
    [titleId, eventTypes, start, end]
  );
  const cents = Number(rows[0]?.cents || 0);
  return { value: Math.round(cents * scale * 100) / 100, unit: "USD", window: "today_utc" };
}

export async function computeMetricForTitle(metricKey, titleId) {
  const { rows } = await query(
    `SELECT d.key, d.active_version, v.definition_json
     FROM metric_definitions d
     JOIN metric_versions v ON v.metric_id = d.id AND v.version = d.active_version AND v.status = 'active'
     WHERE d.key = $1`,
    [metricKey]
  );
  if (!rows.length) return null;
  const def = rows[0].definition_json;
  const version = rows[0].active_version;
  let result;
  if (metricKey === "dau") result = await computeDau(titleId, def);
  else if (metricKey === "d1_retention") result = await computeD1(titleId, def);
  else if (metricKey === "revenue_proxy") result = await computeRevenue(titleId, def);
  else result = { value: null };
  return { metricKey, titleId, version, ...result };
}

const ROLE_METRICS = {
  marketing: ["dau", "d1_retention", "revenue_proxy"],
  design: ["dau", "d1_retention"],
};

export async function buildDashboard(role) {
  const r = role === "design" ? "design" : "marketing";
  const cacheKey = `dash:${r}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return { ...cached, cache: "hit" };

  const { rows: titles } = await query(`SELECT id, name, genre FROM titles ORDER BY name`);
  const keys = ROLE_METRICS[r];
  const series = [];

  for (const title of titles) {
    const metrics = {};
    for (const key of keys) {
      metrics[key] = await computeMetricForTitle(key, title.id);
    }
    const { rows: dauMeta } = await query(
      `SELECT d.active_version, v.definition_json
       FROM metric_definitions d
       JOIN metric_versions v ON v.metric_id = d.id AND v.version = d.active_version
       WHERE d.key = 'dau'`
    );
    const eventTypes = dauMeta[0]?.definition_json?.event_types || ["session_start"];
    const dauVersion = dauMeta[0]?.active_version;
    const spark = [];
    for (let offset = -6; offset <= 0; offset++) {
      const { start, end, day } = dayBounds(offset);
      const { rows: dayRows } = await query(
        `SELECT COUNT(DISTINCT player_id)::int AS value FROM events
         WHERE title_id = $1 AND event_type = ANY($2::text[])
           AND occurred_at >= $3 AND occurred_at < $4`,
        [title.id, eventTypes, start, end]
      );
      spark.push({ day, value: dayRows[0]?.value || 0, definitionVersion: dauVersion });
    }
    series.push({ title, metrics, spark });
  }

  const payload = {
    role: r,
    generatedAt: new Date().toISOString(),
    activeMetricKeys: keys,
    series,
    cache: "miss",
  };
  await cacheSet(cacheKey, { ...payload, cache: "hit" }, 20);
  return payload;
}
