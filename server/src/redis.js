import Redis from "ioredis";

export const redis = new Redis(
  process.env.REDIS_URL || "redis://127.0.0.1:6380",
  {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  }
);

/** Process-local cache counters for the Technical tab. */
const cacheStats = {
  hits: 0,
  misses: 0,
  sets: 0,
  invalidations: 0,
  lastHitAt: null,
  lastMissAt: null,
  lastSetAt: null,
  lastInvalidateAt: null,
  lastKeysTouched: [],
};

export function getCacheStats() {
  return { ...cacheStats };
}

export async function ensureRedis() {
  if (redis.status === "wait" || redis.status === "end") {
    await redis.connect();
  }
  await redis.ping();
}

export async function cacheGet(key) {
  const raw = await redis.get(key);
  if (raw) {
    cacheStats.hits += 1;
    cacheStats.lastHitAt = new Date().toISOString();
    cacheStats.lastKeysTouched = [key];
    return JSON.parse(raw);
  }
  cacheStats.misses += 1;
  cacheStats.lastMissAt = new Date().toISOString();
  cacheStats.lastKeysTouched = [key];
  return null;
}

export async function cacheSet(key, value, ttlSeconds = 30) {
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  cacheStats.sets += 1;
  cacheStats.lastSetAt = new Date().toISOString();
  cacheStats.lastKeysTouched = [key];
}

export async function cacheDelPattern(pattern) {
  const keys = await redis.keys(pattern);
  if (keys.length) await redis.del(...keys);
  cacheStats.invalidations += 1;
  cacheStats.lastInvalidateAt = new Date().toISOString();
  cacheStats.lastKeysTouched = keys;
  return keys;
}

export async function listDashKeys() {
  return redis.keys("dash:*");
}
