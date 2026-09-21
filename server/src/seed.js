import { query } from "./db.js";
import { writeAudit } from "./audit.js";
import { cacheDelPattern } from "./redis.js";

const TITLE_IDS = ["atlas-siege", "nova-lane"];

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic-ish synthetic traffic for two fictional titles. */
export async function seedEvents({ days = 8, playersPerTitle = 120, force = false } = {}) {
  const { rows: countRows } = await query(`SELECT COUNT(*)::int AS n FROM events`);
  if (countRows[0].n > 0 && !force) {
    return { skipped: true, existing: countRows[0].n };
  }
  if (force) {
    await query(`DELETE FROM events`);
  }

  const rng = mulberry32(42);
  const batch = [];
  const now = new Date();
  now.setUTCHours(12, 0, 0, 0);

  for (const titleId of TITLE_IDS) {
    const players = Array.from({ length: playersPerTitle }, (_, i) => `${titleId}-p${i + 1}`);

    for (let day = -(days - 1); day <= 0; day++) {
      const dayBase = new Date(now);
      dayBase.setUTCDate(dayBase.getUTCDate() + day);

      // Base activity scales by title + weekday noise
      const baseActive = titleId === "atlas-siege" ? 55 : 48;
      const activeCount = Math.min(
        playersPerTitle,
        Math.floor(baseActive + rng() * 25 + (day === 0 ? 10 : 0))
      );
      const active = players.slice(0, playersPerTitle).sort(() => rng() - 0.5).slice(0, activeCount);

      for (const playerId of active) {
        const sessionId = `${playerId}-s${day}`;
        const hour = Math.floor(rng() * 20);
        const occurred = new Date(dayBase);
        occurred.setUTCHours(hour, Math.floor(rng() * 60), 0, 0);

        // Installs concentrated on earlier days so D1 has a cohort
        if (day <= -1 && rng() < 0.22) {
          batch.push({
            titleId,
            eventType: "install",
            playerId,
            sessionId,
            revenueCents: 0,
            props: { store: "synthetic" },
            occurredAt: occurred.toISOString(),
          });
        }

        batch.push({
          titleId,
          eventType: "session_start",
          playerId,
          sessionId,
          revenueCents: 0,
          props: { platform: rand(["ios", "android"]) },
          occurredAt: occurred.toISOString(),
        });

        // Level / wave events for design interest
        if (rng() < 0.7) {
          const t2 = new Date(occurred.getTime() + 60_000 * (1 + Math.floor(rng() * 20)));
          batch.push({
            titleId,
            eventType: titleId === "atlas-siege" ? "wave_complete" : "lane_clear",
            playerId,
            sessionId,
            revenueCents: 0,
            props: {
              level: 1 + Math.floor(rng() * 40),
              difficulty: rand(["normal", "hard"]),
            },
            occurredAt: t2.toISOString(),
          });
        }

        if (rng() < 0.08) {
          const t3 = new Date(occurred.getTime() + 90_000);
          const cents = rand([199, 499, 999, 1999]);
          batch.push({
            titleId,
            eventType: "purchase",
            playerId,
            sessionId,
            revenueCents: cents,
            props: { sku: rand(["starter_pack", "gem_small", "gem_large", "battle_pass"]) },
            occurredAt: t3.toISOString(),
          });
        }
      }

      // Ensure some D1 returns: yesterday installs that also play today
      if (day === 0) {
        const { rows: yInstalls } = await query(
          `SELECT DISTINCT player_id FROM events
           WHERE title_id = $1 AND event_type = 'install'
             AND occurred_at >= $2 AND occurred_at < $3`,
          [
            titleId,
            new Date(dayBase.getTime() - 86400000).toISOString(),
            dayBase.toISOString(),
          ]
        );
        // Also pull from batch installs for yesterday before flush — handled after insert.
        void yInstalls;
      }
    }
  }

  // Insert in chunks
  const chunk = 200;
  for (let i = 0; i < batch.length; i += chunk) {
    const slice = batch.slice(i, i + chunk);
    const values = [];
    const params = [];
    let p = 1;
    for (const e of slice) {
      values.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++}::jsonb,$${p++}::timestamptz)`);
      params.push(
        e.titleId,
        e.eventType,
        e.playerId,
        e.sessionId,
        e.revenueCents,
        JSON.stringify(e.props),
        e.occurredAt
      );
    }
    await query(
      `INSERT INTO events (title_id, event_type, player_id, session_id, revenue_cents, props, occurred_at)
       VALUES ${values.join(",")}`,
      params
    );
  }

  // Boost D1: for each title, make ~40% of yesterday's install cohort return today
  for (const titleId of TITLE_IDS) {
    const yStart = new Date(now);
    yStart.setUTCDate(yStart.getUTCDate() - 1);
    yStart.setUTCHours(0, 0, 0, 0);
    const yEnd = new Date(yStart.getTime() + 86400000);
    const tStart = new Date(now);
    tStart.setUTCHours(0, 0, 0, 0);

    const { rows: installs } = await query(
      `SELECT DISTINCT player_id FROM events
       WHERE title_id = $1 AND event_type = 'install'
         AND occurred_at >= $2 AND occurred_at < $3`,
      [titleId, yStart.toISOString(), yEnd.toISOString()]
    );
    const returners = installs.filter(() => rng() < 0.42);
    for (const { player_id } of returners) {
      await query(
        `INSERT INTO events (title_id, event_type, player_id, session_id, revenue_cents, props, occurred_at)
         VALUES ($1,'session_start',$2,$3,0,'{"d1_boost":true}'::jsonb,$4)`,
        [
          titleId,
          player_id,
          `${player_id}-d1`,
          new Date(tStart.getTime() + 3600_000 * (8 + Math.floor(rng() * 8))).toISOString(),
        ]
      );
    }
  }

  await cacheDelPattern("dash:*");
  await writeAudit({
    action: "events.seed",
    actor: "system",
    actorRole: "system",
    entityType: "events",
    entityId: "seed",
    detail: { inserted: batch.length, titles: TITLE_IDS, days, playersPerTitle },
  });

  const { rows: total } = await query(`SELECT COUNT(*)::int AS n FROM events`);
  return { skipped: false, insertedApprox: batch.length, total: total[0].n };
}

export async function ingestEvent(body) {
  const {
    titleId,
    eventType,
    playerId,
    sessionId = null,
    revenueCents = 0,
    props = {},
    occurredAt = new Date().toISOString(),
  } = body || {};

  if (!titleId || !eventType || !playerId) {
    const err = new Error("titleId, eventType, and playerId are required");
    err.status = 400;
    throw err;
  }

  const { rows: titles } = await query(`SELECT id FROM titles WHERE id = $1`, [titleId]);
  if (!titles.length) {
    const err = new Error(`Unknown titleId. Use atlas-siege or nova-lane.`);
    err.status = 400;
    throw err;
  }

  const { rows } = await query(
    `INSERT INTO events (title_id, event_type, player_id, session_id, revenue_cents, props, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::timestamptz)
     RETURNING id, title_id, event_type, player_id, occurred_at`,
    [titleId, eventType, playerId, sessionId, revenueCents, JSON.stringify(props), occurredAt]
  );
  await cacheDelPattern("dash:*");
  return rows[0];
}
