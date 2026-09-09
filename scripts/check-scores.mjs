/**
 * M3 check: the leaderboard adds up. Builds pools against real FPL data — a
 * finished gameweek if there is one, so auto-subs and the armband are in play —
 * asks the running app for the board, and recomputes every number here rather
 * than trusting the app's own maths. Cleans up after itself.
 *
 * Run `npm run dev` first, then `npm run verify:scores`.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const APP = process.env.APP_URL ?? "http://localhost:3000";
const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

let failures = 0;
const say = (ok, label, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

const fpl = (path) =>
  fetch(`https://fantasy.premierleague.com/api/${path}`, {
    headers: { "User-Agent": "crowd-xi/1.0" },
  }).then((r) => {
    if (!r.ok) throw new Error(`FPL ${path} returned ${r.status}`);
    return r.json();
  });

const boot = await fpl("bootstrap-static/");
const settledEvents = boot.events.filter((e) => e.finished && e.data_checked);
const event = settledEvents[settledEvents.length - 1] ?? boot.events.find((e) => e.is_current);
if (!event) {
  console.log("No gameweek has started yet this season — nothing to score.");
  process.exit(0);
}
const settled = Boolean(event.finished && event.data_checked);
console.log(`\nScoring against ${event.name}${settled ? " (settled)" : " (still running)"}\n`);

const live = await fpl(`event/${event.id}/live/`);
const stats = {};
for (const el of live.elements) stats[el.id] = { pts: el.stats?.total_points ?? 0, min: el.stats?.minutes ?? 0 };

const players = boot.elements.filter((e) => e.status !== "u");
const byId = new Map(players.map((p) => [p.id, p]));
const at = (pos, pred) => players.filter((p) => p.element_type === pos && pred(stats[p.id] ?? { pts: 0, min: 0 }));
const playing = (pos) => at(pos, (s) => s.min > 0);
const absent = (pos) => at(pos, (s) => s.min === 0);
const scoring = (pos) => at(pos, (s) => s.min > 0 && s.pts > 0);

const pick = (list, n, taken) => {
  const out = [];
  for (const p of list) {
    if (out.length === n) break;
    if (!taken.has(p.id)) { out.push(p); taken.add(p.id); }
  }
  if (out.length < n) throw new Error(`not enough players to build the fixture (wanted ${n})`);
  return out;
};

const pts = (id) => (stats[id] ?? { pts: 0 }).pts;
const min = (id) => (stats[id] ?? { min: 0 }).min;

/* ---- three squads, each aimed at one rule ---- */
const taken = new Set();

// A: everybody played, so the total is a plain sum with the captain doubled.
const a = {
  gk: pick(playing(1), 1, taken), def: pick(playing(2), 4, taken),
  mid: pick(scoring(3), 4, taken), fwd: pick(playing(4), 2, taken),
  benchGk: pick(playing(1), 1, taken), benchOut: [
    ...pick(playing(2), 1, taken), ...pick(playing(3), 1, taken), ...pick(playing(4), 1, taken),
  ],
};
const entryA = {
  nick: "All eleven played",
  formation: "4-4-2",
  xi: [...a.gk, ...a.def, ...a.mid, ...a.fwd].map((p) => p.id),
  bench: [...a.benchGk, ...a.benchOut].map((p) => p.id),
  captain: a.mid[0].id,
  vice: a.mid[1].id,
};

// B: one midfielder never came on, and the first bench player who can replace
//    him is a midfielder who did.
const b = {
  gk: pick(playing(1), 1, taken), def: pick(playing(2), 4, taken),
  mid: [...pick(scoring(3), 3, taken), ...pick(absent(3), 1, taken)],
  fwd: pick(playing(4), 2, taken),
  benchGk: pick(playing(1), 1, taken),
  benchMid: pick(scoring(3), 1, taken),
  rest: [...pick(absent(2), 1, taken), ...pick(absent(4), 1, taken)],
};
const entryB = {
  nick: "One starter missing",
  formation: "4-4-2",
  xi: [...b.gk, ...b.def, ...b.mid, ...b.fwd].map((p) => p.id),
  bench: [...b.benchGk, ...b.benchMid, ...b.rest].map((p) => p.id),
  captain: b.mid[0].id,
  vice: b.mid[1].id,
};

// C: the captain never came on; the vice did.
const c = {
  gk: pick(playing(1), 1, taken), def: pick(playing(2), 4, taken),
  mid: [...pick(absent(3), 1, taken), ...pick(scoring(3), 3, taken)],
  fwd: pick(playing(4), 2, taken),
  benchGk: pick(playing(1), 1, taken),
  benchMid: pick(scoring(3), 1, taken),
  rest: [...pick(absent(2), 1, taken), ...pick(absent(4), 1, taken)],
};
const entryC = {
  nick: "Captain never played",
  formation: "4-4-2",
  xi: [...c.gk, ...c.def, ...c.mid, ...c.fwd].map((p) => p.id),
  bench: [...c.benchGk, ...c.benchMid, ...c.rest].map((p) => p.id),
  captain: c.mid[0].id,      // the absentee
  vice: c.mid[1].id,
};

/* ---- what the board should say, worked out here ---- */
function expected(entry) {
  let xi = [...entry.xi];
  let subs = 0;
  if (settled) {
    // Only ever one absentee per fixture above, and the bench midfielder is the
    // first legal replacement, so the swap is unambiguous.
    const outIdx = xi.findIndex((id) => min(id) === 0);
    if (outIdx >= 0) {
      const on = entry.bench.find((id) => min(id) > 0 && byId.get(id).element_type === byId.get(xi[outIdx]).element_type);
      if (on) { xi[outIdx] = on; subs = 1; }
    }
  }
  let captain = entry.captain;
  let moved = false;
  if (settled && min(captain) === 0) { captain = entry.vice; moved = true; }
  const points = xi.reduce((s, id) => s + pts(id) * (id === captain ? 2 : 1), 0);
  return { points, subs, captain, moved };
}

/* ---- seed, ask, check, clean up ---- */
const poolId = "sc" + Math.random().toString(36).slice(2, 7).replace(/[^a-z0-9]/g, "x");
const entries = [entryA, entryB, entryC];

await service.from("pools").insert({
  id: poolId,
  name: "Scores check",
  host: "verify:scores",
  gw: event.id,
  budget: false,
  deadline: event.deadline_time,          // in the past for a finished gameweek
});
await service.from("entries").insert(
  entries.map((e, i) => ({
    pool_id: poolId, voter: `verify-scores-${i}-${Math.random().toString(36).slice(2)}`,
    nick: e.nick, formation: e.formation, xi: e.xi, bench: e.bench, captain: e.captain, vice: e.vice,
    updated_at: new Date().toISOString(),
  })),
);

const cleanup = async () => {
  await service.from("entries").delete().eq("pool_id", poolId);
  await service.from("pools").delete().eq("id", poolId);
};

try {
  const res = await fetch(`${APP}/api/pools/${poolId}/scores`, { cache: "no-store" });
  const data = await res.json();
  say(res.ok, "the endpoint answers", res.ok ? "" : JSON.stringify(data));
  if (!res.ok) throw new Error("no board to check");

  say(data.settled === settled, "it agrees with FPL about whether the gameweek is settled");
  say(data.board.length === 3, "every entry is on the board", `got ${data.board.length}`);

  for (const e of entries) {
    const want = expected(e);
    const row = data.board.find((r) => r.nick === e.nick);
    if (!row) { say(false, `${e.nick}: on the board`); continue; }
    say(row.points === want.points, `${e.nick}: ${want.points} points`, `got ${row.points}`);
    say(row.subs === want.subs, `${e.nick}: ${want.subs} auto-sub(s)`, `got ${row.subs}`);
    say(
      row.captain === (byId.get(want.captain)?.web_name ?? null),
      `${e.nick}: armband on ${byId.get(want.captain)?.web_name}`,
      `got ${row.captain}`,
    );
    say(row.armbandMoved === want.moved, `${e.nick}: armband ${want.moved ? "moved" : "stayed"}`);
  }

  const ordered = data.board.every((r, i) => i === 0 || data.board[i - 1].points >= r.points);
  say(ordered, "the board is in order, best first");
  const ranks = data.board.map((r) => r.rank);
  say(ranks[0] === 1 && ranks.every((r, i) => r <= i + 1), "ranks start at 1 and share on a tie", ranks.join(","));

  const above = data.board.filter((r) => r.points > data.crowd.points).length;
  const below = data.board.filter((r) => r.points < data.crowd.points).length;
  say(data.crowd.rank === above + 1, "the crowd XI is ranked against the field", `${data.crowd.rank}`);
  say(data.crowd.beat === below, `the crowd beat ${below} of ${data.board.length}`, `said ${data.crowd.beat}`);
  say(data.crowd.of === data.board.length, "the field it is measured against is the whole pool");

  // Before the deadline there is nothing to score, and the page must say so
  // rather than showing everyone on nil.
  const soonId = "sc" + Math.random().toString(36).slice(2, 7).replace(/[^a-z0-9]/g, "x");
  await service.from("pools").insert({
    id: soonId, name: "Not started", host: "verify:scores", gw: event.id, budget: false,
    deadline: new Date(Date.now() + 86400000).toISOString(),
  });
  const pending = await (await fetch(`${APP}/api/pools/${soonId}/scores`, { cache: "no-store" })).json();
  say(pending.pending === true, "a pool before its deadline comes back pending", JSON.stringify(pending));
  await service.from("pools").delete().eq("id", soonId);

  const missing = await fetch(`${APP}/api/pools/nosuchpool/scores`, { cache: "no-store" });
  say(missing.status === 404, "an unknown pool is a 404", `got ${missing.status}`);
} finally {
  await cleanup();
}

console.log(`\n${failures ? `${failures} check(s) failed` : "all checks passed"}\n`);
process.exit(failures ? 1 : 0);
