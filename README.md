# Definition-Safe Cross-Title BI

Excited by the AI-native full-stack BI role at Panteon Games; I built a small, runnable slice to explore **definition safety across multiple titles** — happy to adapt or throw away what doesn’t match how you already work.

This is a **portfolio / outreach artifact**, not an official Panteon product. It does **not** reverse-engineer live titles, store economics, or player data. Synthetic traffic only, for two clearly fictional games: **Atlas Siege** and **Nova Lane**.

Candidate note: Toronto-based; open to Ankara / Turkey relocation (ODTÜ Teknokent talent pool). Mid/owner-track framing — not claiming senior game-BI tenure.

---

## What this slice solves

Cross-title dashboards go wrong when **KPI definitions drift** without a gate. Marketing and Game Design need different surfaces on the **same** event spine — but DAU / D1 / revenue must not silently change under them.

This repo ships:

1. **Synthetic ingest** for two fictional titles (schema stubs + seed).
2. **Metric Registry** with versioned definitions (DAU, D1 retention, revenue proxy).
3. **HITL approval**: propose → pending → approve/reject. Dashboards only read **active** versions.
4. **Audit log** of who changed what.
5. **Role views**: Marketing vs Game Design on the same events.
6. **Redis** hot path for dashboard payloads + **Postgres** as source of truth.
7. **Latency panel** with real p50/p99 from the running API.
8. **`/ai-audit`**: prompts, rejected AI suggestions + why, reviewed diffs for schema versioning + approval gate.

## Quick start

```bash
docker compose up --build
```

| Service  | URL |
|----------|-----|
| Web UI   | http://127.0.0.1:3847 |
| API      | http://127.0.0.1:3848/api/health |
| Postgres | `localhost:5433` · user/pass/db `bi` / `bi_dev_only` / `definition_safe_bi` |
| Redis    | `localhost:6380` |

On API boot, synthetic events are seeded if the table is empty.

### Try the approval gate

1. Open the UI → **Metric registry**.
2. Propose a DAU change (e.g. count `wave_complete` / `lane_clear` as activity too).
3. Confirm dashboards **do not** move yet; a **pending** row appears.
4. **Approve** → Redis cache invalidated → dashboard reflects vN+1. Or **Reject** with a note → audit keeps the why.

### Local (without Docker for app processes)

```bash
# Postgres + Redis still via compose:
docker compose up -d postgres redis

cd server && npm install && DATABASE_URL=postgres://bi:bi_dev_only@127.0.0.1:5433/definition_safe_bi REDIS_URL=redis://127.0.0.1:6380 npm start

cd client && npm install && npm run dev
```

## Week-1 ownership handoff

**What’s running today**

- Event table + title registry (`atlas-siege`, `nova-lane`) with a v1 event schema.
- Metric definitions versioned in Postgres; pending changes blocked from dashboard reads until approve.
- Role toggle changes default metric set (Design omits revenue proxy).
- Redis caches `/api/dashboard/:role` (~20s TTL); invalidates on approve / reseed / ingest.
- Latency samples collected in-process on every API response.

**What I’d wire next on a real bus**

- Replace seed/ingest HTTP with consumers on your existing event pipeline (Kinesis / Kafka / PubSub — whatever you already trust).
- Map studio title IDs → registry; keep fictional titles as fixtures for CI.
- Promote Redis from payload cache to pre-aggregated hot counters with Postgres rebuild path.
- Add authZ so Marketing/Design approval rights match real team roles (SSO out of scope here on purpose).

**Assumptions**

- UTC calendar days for DAU / D1.
- Revenue is an IAP **proxy** (`revenue_cents`), not finance-grade.
- One pending change per metric at a time.
- Actor identity is a header/demo field (`X-Actor`), not SSO.

**Non-goals (ruthless)**

- Unity, real UA/MMP data, ML, Looker/dbt, SSO, scraping.
- Any live Panteon IP, Raid Rush / Arcane Arena / Panteon Store economics.
- Pretty chart gallery or “platform” scaffolding beyond this slice.

## AWS-shaped deploy notes

Not deployed here; sketch for the same topology:

| Piece | Shape |
|-------|--------|
| API | ECS Fargate / App Runner service, task role with Secrets Manager for `DATABASE_URL` / `REDIS_URL` |
| Web | S3 + CloudFront, or nginx sidecar / ALB → static + `/api` to service |
| Postgres | RDS Postgres 16, private subnets |
| Redis | ElastiCache Redis 7 |
| Ingest | API Gateway or internal ALB → API; later SQS/Kinesis consumer workers |
| Observability | ALB/ECS metrics + the in-app latency panel as a canary for query regressions |

Dev credentials in `docker-compose.yml` are **local only** — rotate / use IAM + secrets in any shared environment.

## Repo layout

```
server/     Node API (Express, pg, ioredis)
client/     React (Vite) UI
ai-audit/   Prompts, rejected suggestions, reviewed diffs
docker-compose.yml
```

## License

MIT — see `LICENSE`.
