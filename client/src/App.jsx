import { useCallback, useEffect, useState } from "react";
import { api, getActor, getRole, setActor, setRole } from "./api.js";

function formatMetric(m) {
  if (!m || m.value === null || m.value === undefined) return "—";
  if (m.unit === "percent") return `${m.value}%`;
  if (m.unit === "USD") return `$${m.value.toLocaleString()}`;
  return String(m.value);
}

function Spark({ points }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <div className="spark" title="7-day DAU (active definition)">
      {points.map((p) => (
        <span
          key={p.day}
          style={{ height: `${Math.max(4, (p.value / max) * 100)}%` }}
          title={`${p.day}: ${p.value}`}
        />
      ))}
    </div>
  );
}

function Dashboard({ role, data, loading, error }) {
  if (loading) return <p className="empty">Loading dashboard…</p>;
  if (error) return <p className="msg err">{error}</p>;
  if (!data) return <p className="empty">No dashboard data.</p>;

  return (
    <>
      <div className="status-row">
        <span className="pill">role: {data.role}</span>
        <span className={`pill ${data.cache === "hit" ? "ok" : "warn"}`}>
          redis: {data.cache}
        </span>
        <span className="pill">
          metrics: {(data.activeMetricKeys || []).join(", ")}
        </span>
      </div>
      {data.series?.map((s) => (
        <div className="title-block" key={s.title.id}>
          <h3>
            {s.title.name}{" "}
            <span className="mono" style={{ color: "var(--muted)", fontWeight: 400 }}>
              {s.title.id} · {s.title.genre}
            </span>
          </h3>
          <div className="metric-row">
            {Object.entries(s.metrics || {}).map(([key, m]) => (
              <div className="metric" key={key}>
                <div className="label">{key}</div>
                <div className="value">{formatMetric(m)}</div>
                <div className="meta">v{m?.version ?? "?"} · {m?.window || ""}</div>
              </div>
            ))}
          </div>
          <Spark points={s.spark || []} />
        </div>
      ))}
      {role === "design" && (
        <p className="sub" style={{ marginTop: "0.75rem" }}>
          Design view hides revenue_proxy by default — same event spine, different
          default KPI surface.
        </p>
      )}
    </>
  );
}

function MetricRegistry({ metrics, onProposed, actor }) {
  const [key, setKey] = useState("dau");
  const [json, setJson] = useState(
    JSON.stringify(
      { event_types: ["session_start", "wave_complete", "lane_clear"], window: "calendar_day_utc", distinct: "player_id" },
      null,
      2
    )
  );
  const [sqlStub, setSqlStub] = useState(
    "COUNT DISTINCT player_id where event_type IN (session_start, wave_complete, lane_clear) for calendar day"
  );
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function propose(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const definitionJson = JSON.parse(json);
      const result = await api.propose(key, {
        definitionJson,
        definitionSqlStub: sqlStub,
        actor,
      });
      setMsg(`Pending change #${result.change.id} created (v${result.change.to_version}). Dashboards unchanged until approval.`);
      onProposed();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <table className="table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Active</th>
            <th>Definition</th>
          </tr>
        </thead>
        <tbody>
          {(metrics || []).map((m) => (
            <tr key={m.id}>
              <td className="mono">{m.key}</td>
              <td className="mono">v{m.active_version}</td>
              <td>
                <div>{m.name}</div>
                <div className="mono" style={{ color: "var(--muted)", marginTop: 4 }}>
                  {JSON.stringify(m.definition_json)}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="form-stack" style={{ marginTop: "1rem" }} onSubmit={propose}>
        <label>
          Propose change for metric
          <select value={key} onChange={(e) => setKey(e.target.value)}>
            <option value="dau">dau</option>
            <option value="d1_retention">d1_retention</option>
            <option value="revenue_proxy">revenue_proxy</option>
          </select>
        </label>
        <label>
          New definition JSON
          <textarea value={json} onChange={(e) => setJson(e.target.value)} />
        </label>
        <label>
          SQL stub (human-readable)
          <input value={sqlStub} onChange={(e) => setSqlStub(e.target.value)} />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Submitting…" : "Propose (creates pending HITL)"}
        </button>
        {msg && <p className="msg ok">{msg}</p>}
        {err && <p className="msg err">{err}</p>}
      </form>
    </>
  );
}

function PendingChanges({ changes, onDone }) {
  const [notes, setNotes] = useState({});
  const [err, setErr] = useState(null);

  async function act(id, kind) {
    setErr(null);
    try {
      if (kind === "approve") {
        await api.approve(id, notes[id] || "Approved after review");
      } else {
        await api.reject(id, notes[id] || "");
      }
      onDone();
    } catch (ex) {
      setErr(ex.message);
    }
  }

  if (!changes?.length) {
    return <p className="empty">No pending definition changes. Propose one from the registry.</p>;
  }

  return (
    <>
      {err && <p className="msg err">{err}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Metric</th>
            <th>Versions</th>
            <th>Proposed</th>
            <th>Diff / note</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.id}>
              <td className="mono">#{c.id}</td>
              <td>
                <div>{c.metric_name}</div>
                <div className="mono">{c.metric_key}</div>
              </td>
              <td className="mono">
                v{c.from_version} → v{c.to_version}
              </td>
              <td>
                <div>{c.proposed_by}</div>
                <div className="mono" style={{ color: "var(--muted)" }}>
                  {new Date(c.proposed_at).toLocaleString()}
                </div>
              </td>
              <td>
                <div className="mono" style={{ color: "var(--muted)" }}>
                  was: {JSON.stringify(c.current_definition)}
                </div>
                <div className="mono">new: {JSON.stringify(c.proposed_definition)}</div>
                <input
                  style={{ marginTop: 6, width: "100%" }}
                  placeholder="Review note (required to reject)"
                  value={notes[c.id] || ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                />
              </td>
              <td>
                <div className="actions">
                  <button className="primary" onClick={() => act(c.id, "approve")}>
                    Approve
                  </button>
                  <button className="danger" onClick={() => act(c.id, "reject")}>
                    Reject
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function AuditLog({ entries }) {
  if (!entries?.length) return <p className="empty">Audit log empty.</p>;
  return (
    <ul className="audit-list">
      {entries.map((e) => (
        <li key={e.id}>
          <div className="when">{new Date(e.created_at).toLocaleString()}</div>
          <div>
            <strong className="mono">{e.action}</strong> by {e.actor} ({e.actor_role}) ·{" "}
            {e.entity_type}/{e.entity_id}
          </div>
          <div className="mono" style={{ color: "var(--muted)", marginTop: 2 }}>
            {JSON.stringify(e.detail)}
          </div>
        </li>
      ))}
    </ul>
  );
}

function LatencyPanel({ data }) {
  if (!data) return <p className="empty">No samples yet — hit a few endpoints.</p>;
  return (
    <>
      <div className="latency-big">
        <div>
          <div className="n">{data.overall?.p50 ?? "—"}ms</div>
          <div className="l">p50 overall</div>
        </div>
        <div>
          <div className="n">{data.overall?.p99 ?? "—"}ms</div>
          <div className="l">p99 overall</div>
        </div>
        <div>
          <div className="n">{data.sampleCount ?? 0}</div>
          <div className="l">samples</div>
        </div>
      </div>
      <p className="sub">{data.note}</p>
      <table className="table">
        <thead>
          <tr>
            <th>Route</th>
            <th>n</th>
            <th>p50</th>
            <th>p99</th>
          </tr>
        </thead>
        <tbody>
          {(data.routes || []).map((r) => (
            <tr key={r.route}>
              <td className="mono">{r.route}</td>
              <td>{r.count}</td>
              <td className="mono">{r.p50}ms</td>
              <td className="mono">{r.p99}ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export default function App() {
  const [role, setRoleState] = useState(getRole());
  const [actor, setActorState] = useState(getActor());
  const [health, setHealth] = useState(null);
  const [eventStats, setEventStats] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [dashLoading, setDashLoading] = useState(true);
  const [dashError, setDashError] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [pending, setPending] = useState([]);
  const [audit, setAudit] = useState([]);
  const [latency, setLatency] = useState(null);

  const refreshAll = useCallback(async () => {
    setDashLoading(true);
    setDashError(null);
    try {
      const [h, stats, dash, mets, pend, aud, lat] = await Promise.all([
        api.health(),
        api.eventStats(),
        api.dashboard(role),
        api.metrics(),
        api.pending(),
        api.audit(),
        api.latency(),
      ]);
      setHealth(h);
      setEventStats(stats);
      setDashboard(dash);
      setMetrics(mets.metrics || []);
      setPending(pend.changes || []);
      setAudit(aud.entries || []);
      setLatency(lat);
    } catch (e) {
      setDashError(e.message);
      setHealth({ ok: false });
    } finally {
      setDashLoading(false);
    }
  }, [role]);

  useEffect(() => {
    refreshAll();
    const t = setInterval(() => {
      api.latency().then(setLatency).catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [refreshAll]);

  function changeRole(next) {
    setRole(next);
    setRoleState(next);
  }

  function changeActor(name) {
    setActor(name);
    setActorState(name);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Definition-Safe BI</h1>
          <p>
            Cross-title analytics spine for fictional titles <strong>Atlas Siege</strong> and{" "}
            <strong>Nova Lane</strong>. Metric definitions are versioned; dashboards only move
            after human approval.
          </p>
        </div>
        <div className="controls">
          <label>
            Actor
            <input
              value={actor}
              onChange={(e) => changeActor(e.target.value)}
              onBlur={refreshAll}
            />
          </label>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: 4 }}>
              ROLE VIEW
            </div>
            <div className="role-toggle">
              <button
                type="button"
                className={role === "marketing" ? "active" : ""}
                onClick={() => changeRole("marketing")}
              >
                Marketing
              </button>
              <button
                type="button"
                className={role === "design" ? "active" : ""}
                onClick={() => changeRole("design")}
              >
                Game Design
              </button>
            </div>
          </div>
          <button type="button" onClick={refreshAll}>
            Refresh
          </button>
        </div>
      </header>

      <div className="status-row">
        <span className={`pill ${health?.ok ? "ok" : "err"}`}>
          api {health?.ok ? "healthy" : "down"}
        </span>
        <span className="pill">events: {eventStats?.total ?? "—"}</span>
        <span className="pill">pending changes: {pending.length}</span>
      </div>

      <div className="grid main">
        <section className="panel">
          <h2>{role === "design" ? "Game Design dashboard" : "Marketing dashboard"}</h2>
          <p className="sub">
            Same Postgres events + Redis hot path. Active metric registry versions only.
          </p>
          <Dashboard
            role={role}
            data={dashboard}
            loading={dashLoading}
            error={dashError}
          />
        </section>

        <section className="panel">
          <h2>Latency panel</h2>
          <p className="sub">Real p50/p99 from this running API process.</p>
          <LatencyPanel data={latency} />
        </section>
      </div>

      <div className="grid bottom" style={{ marginTop: "1rem" }}>
        <section className="panel">
          <h2>Metric registry</h2>
          <p className="sub">
            Propose a new definition → pending change. Approve to publish; reject with a why.
          </p>
          <MetricRegistry metrics={metrics} actor={actor} onProposed={refreshAll} />
        </section>

        <section className="panel">
          <h2>Pending HITL approvals</h2>
          <p className="sub">Until approved, dashboards keep serving the previous active version.</p>
          <PendingChanges changes={pending} onDone={refreshAll} />
        </section>
      </div>

      <section className="panel" style={{ marginTop: "1rem" }}>
        <h2>Audit log</h2>
        <p className="sub">Who proposed, approved, or rejected what — and when.</p>
        <AuditLog entries={audit} />
      </section>
    </div>
  );
}
