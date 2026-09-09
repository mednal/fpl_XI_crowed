/**
 * Per-IP limiting for the two write routes. A sliding window held in memory:
 * no dependency, no round trip, and it survives exactly as long as the server
 * process does. On a serverless host each instance keeps its own counters, so
 * treat this as a brake on scripted abuse rather than a precise quota — if the
 * numbers ever have to be exact, this is the file to move into Postgres.
 */

const hits = new Map<string, number[]>();

/** Stop the map growing without bound on a long-lived server. */
function sweep(now: number, windowMs: number) {
  for (const [key, times] of hits) {
    const live = times.filter((t) => now - t < windowMs);
    if (live.length) hits.set(key, live);
    else hits.delete(key);
  }
}

export type Limit = { ok: boolean; retryAfter: number };

export function rateLimit(key: string, limit: number, windowMs: number): Limit {
  const now = Date.now();
  if (hits.size > 5000) sweep(now, windowMs);

  const times = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (times.length >= limit) {
    const retryAfter = Math.ceil((windowMs - (now - times[0])) / 1000);
    hits.set(key, times);
    return { ok: false, retryAfter: Math.max(1, retryAfter) };
  }

  times.push(now);
  hits.set(key, times);
  return { ok: true, retryAfter: 0 };
}

/**
 * The caller's address as the proxy in front of us reports it. Behind Vercel the
 * left-most x-forwarded-for entry is the real client; with no proxy at all every
 * caller shares one bucket, which is the safe way round.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
