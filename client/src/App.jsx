import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getActor, getRole, setActor, setRole } from "./api.js";

const PAGES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "changes", label: "Metric changes" },
  { id: "history", label: "History" },
];

const METRIC_LABELS = {
  dau: "Daily active users",
  d1_retention: "D1 retention",
  revenue_proxy: "Revenue proxy",
};

const PRESETS = {
  dau: [
    {
      id: "sessions",
      label: "Count players who started a session today (UTC)",
      stub: "Distinct players with a session_start event on the calendar day (UTC).",
      json: {
        event_types: ["session_start"],
        window: "calendar_day_utc",
        distinct: "player_id",
      },
    },
    {
      id: "broader",
      label: "Count players with any session or level activity today (UTC)",
      stub: "Distinct players with session_start, wave_complete, or lane_clear on the calendar day (UTC).",
      json: {
        event_types: ["session_start", "wave_complete", "lane_clear"],
        window: "calendar_day_utc",
        distinct: "player_id",
      },
    },
  ],
  d1_retention: [
    {
      id: "any",
      label: "Return = any event on the next day",
      stub: "Share of yesterday’s install cohort that returns with any event today (UTC).",
      json: {
        cohort_event: "install",
        return_any_event: true,
        offset_days: 1,
      },
    },
    {
      id: "session",
      label: "Return = session start only on the next day",
      stub: "Share of yesterday’s install cohort that returns with a session_start today (UTC).",
      json: {
        cohort_event: "install",
        return_any_event: false,
        return_event_types: ["session_start"],
        offset_days: 1,
      },
    },
  ],
  revenue_proxy: [
    {
      id: "all",
      label: "Sum all in-app purchases today (USD)",
      stub: "Sum of purchase revenue today (cents ÷ 100), all SKUs.",
      json: {
        event_types: ["purchase"],
        field: "revenue_cents",
        scale: 0.01,
      },
    },
    {
      id: "no_pass",
      label: "Sum purchases today, excluding battle pass SKU",
      stub: "Sum of purchase revenue today (cents ÷ 100), excluding battle_pass SKUs.",
      json: {
        event_types: ["purchase"],
        field: "revenue_cents",
        scale: 0.01,
        exclude_skus: ["battle_pass"],
      },
    },
  ],
};

function metricLabel(key) {
  return METRIC_LABELS[key] || key;
}

function formatValue(m) {
  if (!m || m.value === null || m.value === undefined) return "—";
  if (m.unit === "percent") return `${m.value}%`;
  if (m.unit === "USD") return `$${Number(m.value).toLocaleString()}`;
  return String(m.value);
}

function describeDefinition(key, definitionJson, sqlStub) {
  if (sqlStub && String(sqlStub).trim()) return String(sqlStub).trim();
  const d = definitionJson || {};
  if (key === "dau") {
    const types = (d.event_types || ["session_start"]).join(", ");
    return `Counts distinct players with these events today (UTC): ${types}.`;
  }
  if (key === "d1_retention") {
    if (d.return_any_event === false) {
      return `Share of yesterday’s install cohort that returns today with: ${(d.return_event_types || ["session_start"]).join(", ")}.`;
    }
    return "Share of yesterday’s install cohort that returns today with any event.";
  }
  if (key === "revenue_proxy") {
    if (d.exclude_skus?.length) {
      return `Sum of purchase revenue today (USD), excluding SKUs: ${d.exclude_skus.join(", ")}.`;
    }
    return "Sum of purchase revenue today (USD), all SKUs.";
  }
  return JSON.stringify(d);
}

function actionLabel(action) {
  if (action === "metric.propose") return "Proposed";
  if (action === "metric.approve") return "Approved";
  if (action === "metric.reject") return "Rejected";
  if (action === "events.seed") return "Seeded data";
  if (action === "events.ingest") return "Ingested event";
  return action;
}

function historySummary(entry) {
  const d = entry.detail || {};
  if (entry.action === "metric.propose") {
    return `${metricLabel(d.metricKey || "")} v${d.fromVersion} → v${d.toVersion}`.trim();
  }
  if (entry.action === "metric.approve" || entry.action === "metric.reject") {
    const note = d.note ? ` — ${d.note}` : "";
    return `v${d.fromVersion} → v${d.toVersion}${note}`;
  }
  if (entry.action === "events.seed") {
    return `${d.total ?? d.insertedApprox ?? "synthetic"} events`;
  }
  if (entry.action === "events.ingest") {
    return `${d.titleId || ""} ${d.eventType || ""}`.trim();
  }
  return "";
}

function DashboardPage({ role, data, loading, error, latency }) {
  if (loading) return <p className="empty">Loading…</p>;
  if (error) return <p className="msg err">{error}</p>;
  if (!data) return <p className="empty">No data yet.</p>;

  return (
    <>
      <div className="page-intro">
        <p>
          Numbers for the{" "}
          <strong>{role === "design" ? "Game Design" : "Marketing"}</strong> view of Atlas
          Siege and Nova Lane.
        </p>
        <p>These use the approved metric definitions only. Pending changes do not affect this page.</p>
      </div>

      {data.series?.map((s) => (
        <section className="title-block" key={s.title.id}>
          <h2>{s.title.name}</h2>
          <div className="metrics">
            {Object.entries(s.metrics || {}).map(([key, m]) => (
              <div className="metric" key={key}>
                <div className="label">{metricLabel(key)}</div>
                <div className="value">{formatValue(m)}</div>
                <div className="version">Definition v{m?.version ?? "—"}</div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {role === "design" && (
        <p className="empty" style={{ marginBottom: "1.5rem" }}>
          Game Design hides revenue by default. Same events, fewer metrics.
        </p>
      )}

      <div className="latency-strip">
        <span>
          Typical response <strong>{latency?.overall?.p50 ?? "—"} ms</strong>
          <span style={{ color: "var(--muted)" }}> (median)</span>
        </span>
        <span title="99th percentile response time">
          Slow requests (p99) <strong>{latency?.overall?.p99 ?? "—"} ms</strong>
          <span style={{ color: "var(--muted)" }}> — 99th percentile</span>
        </span>
        <span>
          Samples <strong>{latency?.sampleCount ?? 0}</strong>
        </span>
      </div>
    </>
  );
}

function MetricChangesPage({ metrics, pending, onDone }) {
  const [metricKey, setMetricKey] = useState("dau");
  const presets = PRESETS[metricKey] || [];
  const [presetId, setPresetId] = useState(presets[0]?.id || "");
  const activePreset = useMemo(
    () => presets.find((p) => p.id === presetId) || presets[0],
    [presets, presetId]
  );
  const [text, setText] = useState(activePreset?.stub || "");
  const [notes, setNotes] = useState({});
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const list = PRESETS[metricKey] || [];
    setPresetId(list[0]?.id || "");
    setText(list[0]?.stub || "");
  }, [metricKey]);

  useEffect(() => {
    if (activePreset) setText(activePreset.stub);
  }, [activePreset]);

  async function propose(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const result = await api.propose(metricKey, {
        definitionJson: activePreset.json,
        definitionSqlStub: text,
      });
      setMsg(
        `Submitted. Change #${result.change.id} is waiting for approval — dashboards are unchanged.`
      );
      onDone();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function act(id, kind) {
    setErr(null);
    try {
      if (kind === "approve") {
        await api.approve(id, notes[id] || "Approved");
      } else {
        await api.reject(id, notes[id] || "");
      }
      onDone();
    } catch (ex) {
      setErr(ex.message);
    }
  }

  return (
    <>
      <div className="page-intro">
        <p>Change how a metric is calculated. Dashboards update only after someone approves.</p>
      </div>

      <section className="zone">
        <h2>Active definitions</h2>
        <p className="help">What the dashboards use right now.</p>
        <div className="def-list">
          {(metrics || []).map((m) => (
            <div className="def-item" key={m.id}>
              <h3>{m.name}</h3>
              <p className="body">
                {describeDefinition(m.key, m.definition_json, null)}
              </p>
              <p className="meta">Version {m.active_version} · approved</p>
            </div>
          ))}
        </div>
      </section>

      <section className="zone">
        <h2>Pending approval</h2>
        <p className="help">Needs approval before dashboards can use it.</p>
        {err && <p className="msg err">{err}</p>}
        {!pending?.length ? (
          <p className="empty">No changes waiting for approval.</p>
        ) : (
          pending.map((c) => (
            <div className="pending-card" key={c.id}>
              <h3>
                {c.metric_name}{" "}
                <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                  v{c.from_version} → v{c.to_version}
                </span>
              </h3>
              <div className="who">
                Proposed by {c.proposed_by} · {new Date(c.proposed_at).toLocaleString()}
              </div>
              <div className="diff">
                <div className="row">
                  <span className="tag">Current</span>
                  <div className="old">
                    {describeDefinition(
                      c.metric_key,
                      c.current_definition,
                      null
                    )}
                  </div>
                </div>
                <div className="row">
                  <span className="tag">Proposed</span>
                  <div>
                    {describeDefinition(
                      c.metric_key,
                      c.proposed_definition,
                      c.proposed_sql_stub
                    )}
                  </div>
                </div>
              </div>
              <div className="pending-actions">
                <input
                  placeholder="Note (required to reject)"
                  value={notes[c.id] || ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                />
                <button type="button" className="primary" onClick={() => act(c.id, "approve")}>
                  Approve
                </button>
                <button type="button" className="danger" onClick={() => act(c.id, "reject")}>
                  Reject
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="zone">
        <h2>Propose a change</h2>
        <p className="help">Dashboards will not update until this is approved.</p>
        <form className="stack" onSubmit={propose}>
          <label>
            Metric
            <select value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>
              <option value="dau">Daily active users</option>
              <option value="d1_retention">D1 retention</option>
              <option value="revenue_proxy">Revenue proxy</option>
            </select>
          </label>
          <label>
            How should it be calculated?
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Definition text
            <textarea value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Submitting…" : "Submit for approval"}
          </button>
          {msg && <p className="msg ok">{msg}</p>}
          {err && !pending?.length && <p className="msg err">{err}</p>}
        </form>
      </section>
    </>
  );
}

function HistoryPage({ entries }) {
  if (!entries?.length) return <p className="empty">No history yet.</p>;

  const rows = entries.filter((e) =>
    ["metric.propose", "metric.approve", "metric.reject"].includes(e.action)
  );

  if (!rows.length) {
    return <p className="empty">No metric changes recorded yet.</p>;
  }

  return (
    <>
      <div className="page-intro">
        <p>Who changed a metric definition, and what they did.</p>
      </div>
      <table className="history-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Person</th>
            <th>Action</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td className="time">{new Date(e.created_at).toLocaleString()}</td>
              <td>
                {e.actor}
                <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>{e.actor_role}</div>
              </td>
              <td>
                <span
                  className={`status-dot ${
                    e.action === "metric.approve"
                      ? "ok"
                      : e.action === "metric.reject"
                        ? "err"
                        : ""
                  }`}
                />
                {actionLabel(e.action)}
              </td>
              <td>{historySummary(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [role, setRoleState] = useState(getRole());
  const [actor, setActorState] = useState(getActor());
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
      const [dash, mets, pend, aud, lat] = await Promise.all([
        api.dashboard(role),
        api.metrics(),
        api.pending(),
        api.audit(),
        api.latency(),
      ]);
      setDashboard(dash);
      setMetrics(mets.metrics || []);
      setPending(pend.changes || []);
      setAudit(aud.entries || []);
      setLatency(lat);
    } catch (e) {
      setDashError(e.message);
    } finally {
      setDashLoading(false);
    }
  }, [role]);

  useEffect(() => {
    refreshAll();
    const t = setInterval(() => {
      api.latency().then(setLatency).catch(() => {});
    }, 5000);
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
          <p className="subtitle">
            Multi-title metrics that only change after someone approves
          </p>
        </div>
        <div className="top-controls">
          <label className="field">
            <span>Your name</span>
            <input
              value={actor}
              onChange={(e) => changeActor(e.target.value)}
              onBlur={refreshAll}
            />
          </label>
          <div className="field">
            <span>View as</span>
            <div className="segment" role="group" aria-label="Role">
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
        </div>
      </header>

      <nav className="nav" aria-label="Primary">
        {PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            className={page === p.id ? "active" : ""}
            onClick={() => setPage(p.id)}
          >
            {p.label}
          </button>
        ))}
      </nav>

      <main>
        {page === "dashboard" && (
          <DashboardPage
            role={role}
            data={dashboard}
            loading={dashLoading}
            error={dashError}
            latency={latency}
          />
        )}
        {page === "changes" && (
          <MetricChangesPage metrics={metrics} pending={pending} onDone={refreshAll} />
        )}
        {page === "history" && <HistoryPage entries={audit} />}
      </main>
    </div>
  );
}
