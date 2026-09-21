import express from "express";
import cors from "cors";
import { pool, query } from "./db.js";
import { ensureRedis } from "./redis.js";
import { latencyMiddleware, getLatencyStats } from "./latency.js";
import { listAudit, writeAudit } from "./audit.js";
import {
  listMetrics,
  listPendingChanges,
  proposeMetricChange,
  approveChange,
  rejectChange,
  buildDashboard,
} from "./metrics.js";
import { seedEvents, ingestEvent } from "./seed.js";

const app = express();
const PORT = Number(process.env.PORT || 3848);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(latencyMiddleware);

function actorFrom(req) {
  return {
    actor: req.headers["x-actor"] || req.body?.actor || "anonymous",
    actorRole: req.headers["x-actor-role"] || req.body?.actorRole || "marketing",
  };
}

app.get("/api/health", async (_req, res) => {
  try {
    await query("SELECT 1");
    await ensureRedis();
    res.json({ ok: true, service: "definition-safe-bi-api" });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

app.get("/api/titles", async (_req, res) => {
  const { rows } = await query(
    `SELECT id, name, genre, schema_version FROM titles ORDER BY name`
  );
  res.json({ titles: rows });
});

app.get("/api/events/stats", async (_req, res) => {
  const { rows } = await query(
    `SELECT title_id, event_type, COUNT(*)::int AS n
     FROM events GROUP BY 1, 2 ORDER BY 1, 2`
  );
  const { rows: totals } = await query(`SELECT COUNT(*)::int AS total FROM events`);
  res.json({ total: totals[0].total, byTitleType: rows });
});

app.post("/api/events/ingest", async (req, res) => {
  try {
    const event = await ingestEvent(req.body);
    const { actor, actorRole } = actorFrom(req);
    await writeAudit({
      action: "events.ingest",
      actor,
      actorRole,
      entityType: "event",
      entityId: String(event.id),
      detail: { titleId: event.title_id, eventType: event.event_type },
    });
    res.status(201).json({ event });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post("/api/events/seed", async (req, res) => {
  try {
    const result = await seedEvents({
      force: Boolean(req.body?.force),
      days: req.body?.days || 8,
      playersPerTitle: req.body?.playersPerTitle || 120,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/metrics", async (_req, res) => {
  try {
    const metrics = await listMetrics();
    res.json({ metrics });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/changes/pending", async (_req, res) => {
  try {
    const changes = await listPendingChanges();
    res.json({ changes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/metrics/:key/propose", async (req, res) => {
  try {
    const { actor, actorRole } = actorFrom(req);
    const result = await proposeMetricChange({
      metricKey: req.params.key,
      definitionJson: req.body.definitionJson,
      definitionSqlStub: req.body.definitionSqlStub,
      proposedBy: actor,
      actorRole,
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post("/api/changes/:id/approve", async (req, res) => {
  try {
    const { actor, actorRole } = actorFrom(req);
    const result = await approveChange({
      changeId: Number(req.params.id),
      reviewedBy: actor,
      actorRole,
      note: req.body?.note,
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post("/api/changes/:id/reject", async (req, res) => {
  try {
    const { actor, actorRole } = actorFrom(req);
    const result = await rejectChange({
      changeId: Number(req.params.id),
      reviewedBy: actor,
      actorRole,
      note: req.body?.note,
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get("/api/dashboard/:role", async (req, res) => {
  try {
    const role = req.params.role === "design" ? "design" : "marketing";
    const dashboard = await buildDashboard(role);
    res.json(dashboard);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/audit", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 80, 200);
    const entries = await listAudit(limit);
    res.json({ entries });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/latency", (_req, res) => {
  res.json(getLatencyStats());
});

async function boot() {
  // Wait for Postgres readiness (compose healthcheck usually enough; retry for local)
  for (let i = 0; i < 30; i++) {
    try {
      await query("SELECT 1");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
      if (i === 29) throw new Error("Postgres not reachable");
    }
  }
  await ensureRedis();
  const seeded = await seedEvents({ force: false });
  console.log("seed:", seeded);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`definition-safe-bi api on :${PORT}`);
  });
}

boot().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});
