/**
 * Fills a pool with plausible fake viewers, so the live board and the leaderboard
 * can be looked at with a crowd in them. Needs a dev server running:
 *
 *   npm run dev
 *   npm run seed -- <poolId> [count] [--delay 400] [--base http://localhost:3001]
 *
 * Each fake viewer posts with no cookie, so the route mints them a fresh signed
 * voter and they land as separate entries — the same path a real browser takes,
 * validation included. They also each carry their own x-forwarded-for, because
 * the rate limiter buckets by IP and 30 teams from one address is the ceiling.
 *
 * Picks are weighted by real selected-by percent, so a consensus XI emerges
 * instead of fifteen hundred random names. `--noise` widens the spread.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

const poolId = positional[0];
const count = Number(positional[1] ?? 25);
const delay = Number(flag("delay", 250));
const noise = Number(flag("noise", 1));
// How many of a manager's best starters are in the running for the armband,
// and how sharply the favourite is preferred over the rest.
const capField = Math.max(2, Number(flag("cap", 8)));
const capBias = Number(flag("cap-bias", 1.1));

if (!poolId) {
  console.error("Usage: npm run seed -- <poolId> [count] [--delay ms] [--noise 0-3] [--cap 8] [--cap-bias 1.1] [--base url]");
  process.exit(1);
}

try {
  for (const line of readFileSync("./.env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) process.env[m[1]] = m[2];
  }
} catch { /* the seeder only needs BASE; .env.local is a convenience */ }

const BASE = flag("base", process.env.BASE ?? "http://localhost:3000");

const SQUAD = { 1: 2, 2: 5, 3: 5, 4: 3 };
const MAXCLUB = 3;
const BUDGET = 1000;
const FORMS = {
  "3-4-3": [3, 4, 3], "3-5-2": [3, 5, 2], "4-4-2": [4, 4, 2], "4-3-3": [4, 3, 3],
  "4-5-1": [4, 5, 1], "5-2-3": [5, 2, 3], "5-3-2": [5, 3, 2], "5-4-1": [5, 4, 1],
};

const FIRST = "Sam Alex Jordan Kai Noor Leo Mia Omar Tess Rory Dani Yusuf Nina Finn Priya Cole Zara Ben Ivy Mo Hana Theo Lena Ash".split(" ");
const LAST = ["the Gaffer", "FPL", "Wildcard", "TripleCap", "Benchwarmer", "Hauls", "OneWeekWonder", "Differential", "BusParker"];
const nickname = () =>
  `${pick(FIRST)}${Math.random() < 0.45 ? ` ${pick(LAST)}` : ""}`;

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One draw from `pool`, each player's chance proportional to its weight. */
function weighted(pool) {
  let total = 0;
  for (const p of pool) total += p.w;
  let r = Math.random() * total;
  for (const p of pool) {
    r -= p.w;
    if (r <= 0) return p;
  }
  return pool[pool.length - 1];
}

const boot = await (await fetch("https://fantasy.premierleague.com/api/bootstrap-static/")).json();
const players = boot.elements
  .filter((e) => e.status !== "u")
  .map((e) => ({
    id: e.id,
    n: e.web_name,
    pos: e.element_type,
    team: e.team,
    cost: e.now_cost,
    // A flat prior plus real popularity: the exponent decides how much the crowd
    // agrees with itself. noise 0 makes everyone pick the same XI.
    w: 0.4 + Math.pow(Number(e.selected_by_percent) || 0, 1.6 / Math.max(noise, 0.25)),
  }));

const byPos = { 1: [], 2: [], 3: [], 4: [] };
for (const p of players) byPos[p.pos].push(p);

/** A legal 15: right shape, max 3 per club, inside budget. */
function buildSquad() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const club = {};
    const picked = { 1: [], 2: [], 3: [], 4: [] };
    let ok = true;

    for (const pos of [1, 2, 3, 4]) {
      while (picked[pos].length < SQUAD[pos]) {
        const room = byPos[pos].filter(
          (p) => (club[p.team] ?? 0) < MAXCLUB && !picked[pos].includes(p),
        );
        if (!room.length) { ok = false; break; }
        const p = weighted(room);
        picked[pos].push(p);
        club[p.team] = (club[p.team] ?? 0) + 1;
      }
      if (!ok) break;
    }
    if (!ok) continue;

    // Trade the priciest picks down until the squad fits. A real manager does the
    // same thing: keep the players they wanted, fund them off the bench.
    const all = () => [...picked[1], ...picked[2], ...picked[3], ...picked[4]];
    for (let i = 0; i < 60 && all().reduce((s, p) => s + p.cost, 0) > BUDGET; i++) {
      const dear = all().sort((a, b) => b.cost - a.cost)[0];
      const held = picked[dear.pos];
      const cheaper = byPos[dear.pos]
        .filter((p) => p.cost < dear.cost && !held.includes(p) &&
          ((club[p.team] ?? 0) < MAXCLUB || p.team === dear.team))
        .sort((a, b) => a.cost - b.cost)
        .slice(0, 25);
      if (!cheaper.length) break;
      const swap = weighted(cheaper);
      held[held.indexOf(dear)] = swap;
      club[dear.team]--;
      club[swap.team] = (club[swap.team] ?? 0) + 1;
    }
    if (all().reduce((s, p) => s + p.cost, 0) > BUDGET) continue;

    return picked;
  }
  return null;
}

/** Start the players this manager rates most, in a shape that fits them. */
function toEntry(picked) {
  const formation = pick(Object.keys(FORMS));
  const [d, m, f] = FORMS[formation];
  const best = (pos, n) => [...picked[pos]].sort((a, b) => b.w - a.w).slice(0, n);

  const starters = [...best(1, 1), ...best(2, d), ...best(3, m), ...best(4, f)];
  const xi = starters.map((p) => p.id);
  const bench = [...picked[1], ...picked[2], ...picked[3], ...picked[4]]
    .filter((p) => !xi.includes(p.id))
    .map((p) => p.id);

  // The armband race is the thing the board is built around, so it needs a
  // favourite, two or three real contenders and a tail of punts — not a
  // three-horse field. Rank decay does that: the most-owned starter is drawn
  // far more often than the eighth, and `--cap` widens or narrows the field.
  const top = [...starters].sort((a, b) => b.w - a.w);
  const field = top.slice(0, capField).map((p, i) => ({ ...p, w: p.w / Math.pow(i + 1, capBias) }));
  // One manager in fifteen captains someone nobody else has. Differentials are
  // what makes a leaderboard move.
  const captain = Math.random() < 0.07 ? pick(starters) : weighted(field);

  // Vice is its own vote, not just "whoever was second" — otherwise every team
  // in the pool names the same one and the fallback never gets exercised.
  const vice = weighted(field.filter((p) => p.id !== captain.id)) ?? top.find((p) => p.id !== captain.id);

  return { formation, xi, bench, captain: captain.id, vice: vice.id };
}

console.log(`Seeding ${count} teams into ${poolId} at ${BASE}\n`);
let sent = 0;
for (let i = 0; i < count; i++) {
  const picked = buildSquad();
  if (!picked) { console.log(" skip  could not build a legal squad"); continue; }
  const entry = toEntry(picked);
  const nick = nickname();

  const res = await fetch(`${BASE}/api/pools/${poolId}/entries`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Its own address, so this fake crowd is not one connection to the limiter.
      "x-forwarded-for": `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${(i % 254) + 1}`,
    },
    body: JSON.stringify({ nick, ...entry }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) {
    sent++;
    const cost = [...picked[1], ...picked[2], ...picked[3], ...picked[4]]
      .reduce((s, p) => s + p.cost, 0);
    console.log(`  ok   ${nick.padEnd(22)} ${entry.formation}  £${(cost / 10).toFixed(1)}m`);
  } else {
    console.log(` FAIL  ${nick} — ${body.error ?? res.status}`);
  }
  if (delay) await sleep(delay);
}
console.log(`\n${sent}/${count} teams in. Open ${BASE}/p/${poolId}/live`);
