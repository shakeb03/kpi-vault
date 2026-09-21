/** In-process latency samples for the latency panel (p50/p99). */
const samples = [];
const MAX = 500;

export function recordLatency(route, ms) {
  samples.push({ route, ms, at: Date.now() });
  if (samples.length > MAX) samples.splice(0, samples.length - MAX);
}

export function latencyMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    recordLatency(req.path, Math.round(ms * 100) / 100);
  });
  next();
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

export function getLatencyStats() {
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const byRoute = {};
  for (const s of samples) {
    if (!byRoute[s.route]) byRoute[s.route] = [];
    byRoute[s.route].push(s.ms);
  }
  const routes = Object.entries(byRoute).map(([route, vals]) => {
    const sorted = [...vals].sort((a, b) => a - b);
    return {
      route,
      count: sorted.length,
      p50: percentile(sorted, 50),
      p99: percentile(sorted, 99),
    };
  });
  return {
    sampleCount: samples.length,
    overall: {
      p50: percentile(ms, 50),
      p99: percentile(ms, 99),
    },
    routes: routes.sort((a, b) => b.count - a.count).slice(0, 12),
    note: "Measured from this API process; Redis cold-miss vs hit will move p99.",
  };
}
