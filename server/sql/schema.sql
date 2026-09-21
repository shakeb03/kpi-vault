-- Definition-Safe Cross-Title BI schema
-- Synthetic titles only: Atlas Siege, Nova Lane

CREATE TABLE IF NOT EXISTS titles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  genre TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  title_id TEXT NOT NULL REFERENCES titles(id),
  event_type TEXT NOT NULL,
  player_id TEXT NOT NULL,
  session_id TEXT,
  revenue_cents INTEGER NOT NULL DEFAULT 0,
  props JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_title_occurred ON events (title_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (event_type);
CREATE INDEX IF NOT EXISTS idx_events_player ON events (player_id);

-- Versioned KPI definitions. Dashboards only read status = 'active'.
CREATE TABLE IF NOT EXISTS metric_definitions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  active_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metric_versions (
  id BIGSERIAL PRIMARY KEY,
  metric_id TEXT NOT NULL REFERENCES metric_definitions(id),
  version INTEGER NOT NULL,
  definition_sql_stub TEXT NOT NULL,
  definition_json JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'pending', 'rejected', 'superseded')),
  proposed_by TEXT NOT NULL,
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  UNIQUE (metric_id, version)
);

CREATE TABLE IF NOT EXISTS pending_changes (
  id BIGSERIAL PRIMARY KEY,
  metric_version_id BIGINT NOT NULL REFERENCES metric_versions(id),
  metric_id TEXT NOT NULL REFERENCES metric_definitions(id),
  from_version INTEGER NOT NULL,
  to_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  proposed_by TEXT NOT NULL,
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);

INSERT INTO titles (id, name, genre, schema_version) VALUES
  ('atlas-siege', 'Atlas Siege', 'tower-defense', '1.0.0'),
  ('nova-lane', 'Nova Lane', 'lane-combat', '1.0.0')
ON CONFLICT (id) DO NOTHING;

INSERT INTO metric_definitions (id, key, name, description, active_version) VALUES
  ('m-dau', 'dau', 'Daily Active Users',
   'Distinct players with a session_start on the calendar day (UTC).', 1),
  ('m-d1', 'd1_retention', 'D1 Retention',
   'Share of day-0 install cohort that returns with any event on day+1 (UTC).', 1),
  ('m-rev', 'revenue_proxy', 'Revenue Proxy (USD)',
   'Sum of purchase.revenue_cents / 100 for the selected window (IAP proxy only).', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO metric_versions (metric_id, version, definition_sql_stub, definition_json, status, proposed_by) VALUES
  ('m-dau', 1,
   'SELECT title_id, COUNT(DISTINCT player_id) FROM events WHERE event_type = ''session_start'' AND occurred_at::date = $day GROUP BY 1',
   '{"event_types":["session_start"],"window":"calendar_day_utc","distinct":"player_id"}',
   'active', 'system'),
  ('m-d1', 1,
   'cohort = installs on day0; retained = any event on day0+1; rate = retained/cohort',
   '{"cohort_event":"install","return_any_event":true,"offset_days":1}',
   'active', 'system'),
  ('m-rev', 1,
   'SELECT title_id, SUM(revenue_cents)/100.0 FROM events WHERE event_type = ''purchase'' AND occurred_at >= $from AND occurred_at < $to GROUP BY 1',
   '{"event_types":["purchase"],"field":"revenue_cents","scale":0.01}',
   'active', 'system')
ON CONFLICT (metric_id, version) DO NOTHING;
