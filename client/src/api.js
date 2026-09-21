const ACTOR_KEY = "dsbi-actor";
const ROLE_KEY = "dsbi-role";

export function getActor() {
  return localStorage.getItem(ACTOR_KEY) || "alex.chen";
}

export function setActor(name) {
  localStorage.setItem(ACTOR_KEY, name);
}

export function getRole() {
  return localStorage.getItem(ROLE_KEY) || "marketing";
}

export function setRole(role) {
  localStorage.setItem(ROLE_KEY, role);
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-Actor": getActor(),
    "X-Actor-Role": getRole(),
    ...(options.headers || {}),
  };
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  health: () => request("/api/health"),
  titles: () => request("/api/titles"),
  eventStats: () => request("/api/events/stats"),
  metrics: () => request("/api/metrics"),
  pending: () => request("/api/changes/pending"),
  dashboard: (role) => request(`/api/dashboard/${role}`),
  audit: () => request("/api/audit?limit=60"),
  latency: () => request("/api/latency"),
  propose: (key, body) =>
    request(`/api/metrics/${key}/propose`, { method: "POST", body: JSON.stringify(body) }),
  approve: (id, note) =>
    request(`/api/changes/${id}/approve`, { method: "POST", body: JSON.stringify({ note }) }),
  reject: (id, note) =>
    request(`/api/changes/${id}/reject`, { method: "POST", body: JSON.stringify({ note }) }),
  seed: (force = false) =>
    request("/api/events/seed", { method: "POST", body: JSON.stringify({ force }) }),
  ingest: (body) =>
    request("/api/events/ingest", { method: "POST", body: JSON.stringify(body) }),
};
