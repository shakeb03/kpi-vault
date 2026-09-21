import Redis from "ioredis";

export const redis = new Redis(
  process.env.REDIS_URL || "redis://127.0.0.1:6380",
  {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  }
);

export async function ensureRedis() {
  if (redis.status === "wait" || redis.status === "end") {
    await redis.connect();
  }
  await redis.ping();
}

export async function cacheGet(key) {
  const raw = await redis.get(key);
  return raw ? JSON.parse(raw) : null;
}

export async function cacheSet(key, value, ttlSeconds = 30) {
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
}

export async function cacheDelPattern(pattern) {
  const keys = await redis.keys(pattern);
  if (keys.length) await redis.del(...keys);
}
