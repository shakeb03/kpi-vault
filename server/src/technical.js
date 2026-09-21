import { query } from "./db.js";
import { ensureRedis, getCacheStats, listDashKeys } from "./redis.js";
import { getLatencyStats } from "./latency.js";
import { listAudit } from "./audit.js";

export async function getTechnicalSnapshot() {
  await ensureRedis();

  const [
    eventsTotal,
    eventsByTitle,
    definitions,
    versions,
    pending,
    auditCount,
    recentAudit,
    dashKeys,
  ] = await Promise.all([
    query(`SELECT COUNT(*)::int AS n FROM events`),
    query(
      `SELECT t.id, t.name, COUNT(e.id)::int AS events
       FROM titles t
       LEFT JOIN events e ON e.title_id = t.id
       GROUP BY t.id, t.name
       ORDER BY t.name`
    ),
    query(`SELECT COUNT(*)::int AS n FROM metric_definitions`),
    query(
      `SELECT status, COUNT(*)::int AS n FROM metric_versions GROUP BY status ORDER BY status`
    ),
    query(
      `SELECT COUNT(*)::int AS n FROM pending_changes WHERE status = 'pending'`
    ),
    query(`SELECT COUNT(*)::int AS n FROM audit_log`),
    listAudit(8),
    listDashKeys(),
  ]);

  const cache = getCacheStats();
  const latency = getLatencyStats();
  const versionByStatus = Object.fromEntries(
    versions.rows.map((r) => [r.status, r.n])
  );

  let pipelineHighlight = "idle";
  if (pending.rows[0].n > 0) pipelineHighlight = "approval_gate";
  else if (cache.lastInvalidateAt) {
    const age = Date.now() - new Date(cache.lastInvalidateAt).getTime();
    if (age < 60_000) pipelineHighlight = "redis";
  } else if (cache.lastMissAt) {
    const age = Date.now() - new Date(cache.lastMissAt).getTime();
    if (age < 30_000) pipelineHighlight = "postgres";
  } else if (cache.lastHitAt) {
    const age = Date.now() - new Date(cache.lastHitAt).getTime();
    if (age < 30_000) pipelineHighlight = "dashboards";
  }

  return {
    generatedAt: new Date().toISOString(),
    pipelineHighlight,
    events: {
      total: eventsTotal.rows[0].n,
      byTitle: eventsByTitle.rows,
    },
    postgres: {
      role: "source_of_truth",
      tables: {
        events: eventsTotal.rows[0].n,
        metric_definitions: definitions.rows[0].n,
        metric_versions: versionByStatus,
        pending_changes: pending.rows[0].n,
        audit_log: auditCount.rows[0].n,
      },
    },
    redis: {
      role: "hot_path",
      keyPattern: "dash:{marketing|design}",
      ttlSeconds: 20,
      keysPresent: dashKeys,
      stats: cache,
    },
    latency: {
      p50: latency.overall?.p50 ?? null,
      p99: latency.overall?.p99 ?? null,
      sampleCount: latency.sampleCount,
    },
    recentAudit: recentAudit.map((e) => ({
      id: e.id,
      action: e.action,
      actor: e.actor,
      actorRole: e.actor_role,
      createdAt: e.created_at,
      detail: e.detail,
    })),
    schemaNotes: {
      tables: [
        "events",
        "metric_definitions",
        "metric_versions",
        "pending_changes",
        "audit_log",
      ],
      redisKeys: ["dash:marketing", "dash:design"],
    },
  };
}
