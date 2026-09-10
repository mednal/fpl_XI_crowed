import type { CrowdXI, Entry, EntryInput, LiveStat, Player, PosId, Ranked } from "./types";

export const POS: Record<PosId, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
export const POSLONG: Record<PosId, string> = {
  1: "Goalkeepers", 2: "Defenders", 3: "Midfielders", 4: "Forwards",
};
/** The real FPL squad: 2 keepers, 5 defenders, 5 midfielders, 3 forwards. */
export const SQUAD: Record<PosId, number> = { 1: 2, 2: 5, 3: 5, 4: 3 };
/** What a legal starting XI may hold at each position. The auto-sub rules and
 *  `validateEntry` are the same rule seen twice, so they read it from here. */
export const XI_MIN: Record<PosId, number> = { 1: 1, 2: 3, 3: 2, 4: 1 };
export const XI_MAX: Record<PosId, number> = { 1: 1, 2: 5, 3: 5, 4: 3 };
export const BUDGET = 1000;      // £100.0m in FPL tenths
export const MAXCLUB = 3;
export const POSITIONS: PosId[] = [1, 2, 3, 4];

export const FORMS: Record<string, [number, number, number]> = {
  "3-4-3": [3, 4, 3], "3-5-2": [3, 5, 2], "4-4-2": [4, 4, 2], "4-3-3": [4, 3, 3],
  "4-5-1": [4, 5, 1], "5-2-3": [5, 2, 3], "5-3-2": [5, 3, 2], "5-4-1": [5, 4, 1],
};

export type Squad = {
  formation: string;
  p: Record<PosId, (number | null)[]>;
  captain: number | null;
  vice: number | null;
};

/** A blank squad. The shape a host fixed for the board is where the picker
 *  starts, since that is the eleven positions the crowd XI will be drawn in —
 *  the viewer is still free to change it. An unknown name falls back to 4-4-2. */
export function newSquad(formation?: string | null): Squad {
  return {
    formation: formation && FORMS[formation] ? formation : "4-4-2",
    p: { 1: [null, null], 2: [null, null, null, null, null],
         3: [null, null, null, null, null], 4: [null, null, null] },
    captain: null,
    vice: null,
  };
}

export function startCount(formation: string): Record<PosId, number> {
  const f = FORMS[formation] ?? FORMS["4-4-2"];
  return { 1: 1, 2: f[0], 3: f[1], 4: f[2] };
}

export function squadIds(sq: Squad): number[] {
  const out: number[] = [];
  for (const k of POSITIONS) for (const id of sq.p[k]) if (id) out.push(id);
  return out;
}
export function xiIds(sq: Squad): number[] {
  const sc = startCount(sq.formation);
  const out: number[] = [];
  for (const k of POSITIONS) for (let i = 0; i < sc[k]; i++) { const id = sq.p[k][i]; if (id) out.push(id); }
  return out;
}
export function benchIds(sq: Squad): number[] {
  const sc = startCount(sq.formation);
  const out: number[] = [];
  for (const k of POSITIONS) for (let i = sc[k]; i < SQUAD[k]; i++) { const id = sq.p[k][i]; if (id) out.push(id); }
  return out;
}

/** Where a player sits: which position array, and which slot in it. Slots below
 *  the formation's count are the XI, the rest are the bench. */
export type SlotRef = { pos: PosId; index: number };

export function isStarter(sq: Squad, ref: SlotRef): boolean {
  return ref.index < startCount(sq.formation)[ref.pos];
}

export function cloneSquad(sq: Squad): Squad {
  return {
    formation: sq.formation,
    p: { 1: [...sq.p[1]], 2: [...sq.p[2]], 3: [...sq.p[3]], 4: [...sq.p[4]] },
    captain: sq.captain,
    vice: sq.vice,
  };
}

/** An armband cannot be worn from the bench, so a move that benches its wearer
 *  takes it off them rather than quietly leaving a squad the server will reject. */
function dropArmbands(sq: Squad): Squad {
  const xi = xiIds(sq);
  if (sq.captain && !xi.includes(sq.captain)) sq.captain = null;
  if (sq.vice && !xi.includes(sq.vice)) sq.vice = null;
  return sq;
}

/**
 * The formation a swap between these two slots would leave behind, or null when
 * it is not a substitution the game allows. Swapping inside one position keeps
 * the shape; bringing on a substitute of another position changes it, which is
 * only allowed when what results is a real formation — the same reason FPL
 * greys out the players you cannot swap with.
 *
 * One of the two slots may be empty: taking a starter out leaves a hole, and a
 * substitute moving into it is the same trade with nobody coming back the other
 * way. Two empty slots have nothing to trade.
 */
export function swapFormation(sq: Squad, a: SlotRef, b: SlotRef): string | null {
  if (a.pos === b.pos && a.index === b.index) return null;
  if (!sq.p[a.pos][a.index] && !sq.p[b.pos][b.index]) return null;

  const aStart = isStarter(sq, a);
  const bStart = isStarter(sq, b);
  if (aStart && bStart) return null;              // both are already playing
  // Two substitutes only trade places, which is worth doing: bench order is the
  // order auto-subs come on in. Across positions there is no place to trade.
  if (!aStart && !bStart) return a.pos === b.pos ? sq.formation : null;
  if (a.pos === b.pos) return sq.formation;

  const sc = startCount(sq.formation);
  const on = aStart ? b.pos : a.pos;
  const off = aStart ? a.pos : b.pos;
  const next: Record<PosId, number> = { ...sc, [on]: sc[on] + 1, [off]: sc[off] - 1 };
  const f = `${next[2]}-${next[3]}-${next[4]}`;
  return next[1] === 1 && FORMS[f] ? f : null;
}

function move(arr: (number | null)[], from: number, to: number): void {
  const [x] = arr.splice(from, 1);
  arr.splice(to, 0, x);
}

/** Swaps two slots, returning the squad unchanged if the swap is not legal. */
export function applySwap(sq: Squad, a: SlotRef, b: SlotRef): Squad {
  const formation = swapFormation(sq, a, b);
  if (!formation) return sq;

  const next = cloneSquad(sq);
  next.formation = formation;

  if (a.pos === b.pos) {
    const arr = next.p[a.pos];
    [arr[a.index], arr[b.index]] = [arr[b.index], arr[a.index]];
    return dropArmbands(next);
  }

  // Starters are the front of each array, so the two players are moved to the
  // ends of their new halves: one to the first bench slot, one to the last
  // starting slot, and everyone else keeps their order.
  const starter = isStarter(sq, a) ? a : b;
  const sub = starter === a ? b : a;
  const sc = startCount(formation);
  move(next.p[starter.pos], starter.index, sc[starter.pos]);
  move(next.p[sub.pos], sub.index, sc[sub.pos] - 1);
  return dropArmbands(next);
}

/** Takes a player out and leaves their slot empty. Nobody is promoted off the
 *  bench: taking a starter out is a decision to pick someone else there, not to
 *  reshuffle a team the viewer has already arranged. */
export function removeFromSquad(sq: Squad, ref: SlotRef): Squad {
  const next = cloneSquad(sq);
  next.p[ref.pos][ref.index] = null;
  return dropArmbands(next);
}

export function money(tenths: number): string {
  return "£" + (tenths / 10).toFixed(1) + "m";
}
export function pctText(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(n >= 99.95 ? 0 : 1) + "%";
}

export function spent(sq: Squad, byId: Map<number, Player>): number {
  return squadIds(sq).reduce((s, id) => s + (byId.get(id)?.cost ?? 0), 0);
}
export function clubCount(sq: Squad, byId: Map<number, Player>): Record<number, number> {
  const c: Record<number, number> = {};
  for (const id of squadIds(sq)) {
    const t = byId.get(id)?.team;
    if (t) c[t] = (c[t] ?? 0) + 1;
  }
  return c;
}
export function cheapestPerPos(players: Player[]): Record<PosId, number> {
  const out = { 1: 999, 2: 999, 3: 999, 4: 999 } as Record<PosId, number>;
  for (const p of players) if (p.cost < out[p.pos]) out[p.pos] = p.cost;
  return out;
}

/**
 * Money that must be held back to fill every slot still empty, at the cheapest
 * price available for each position. Without this a viewer can spend their way
 * into a squad they cannot legally finish.
 */
export function reserve(sq: Squad, min: Record<PosId, number>, ignorePos?: PosId): number {
  let r = 0;
  for (const k of POSITIONS) {
    let n = sq.p[k].filter((x) => !x).length;
    if (k === ignorePos) n -= 1;
    if (n > 0) r += n * min[k];
  }
  return r;
}

/** One thing a squad must get right, in the order the picker lists them. */
export type SquadCheck = { key: string; ok: boolean; label: string };

/**
 * The picker's readiness list: every requirement, met or not, with the sentence
 * to show for it. `validateSquad` is this list with the met ones dropped, so the
 * checklist beside the button and the errors it reports can never drift apart.
 */
export function squadChecklist(
  sq: Squad,
  byId: Map<number, Player>,
  budgetOn: boolean,
): SquadCheck[] {
  const out: SquadCheck[] = [];
  const ids = squadIds(sq);
  const done = ids.length === 15;
  out.push({
    key: "squad",
    ok: done,
    label: done ? "All 15 players picked." : `Pick all 15 players (${ids.length}/15 done).`,
  });

  if (budgetOn) {
    const cost = spent(sq, byId);
    out.push({
      key: "budget",
      ok: cost <= BUDGET,
      label: cost <= BUDGET
        ? `Inside the budget, with ${money(BUDGET - cost)} in the bank.`
        : `You are ${money(cost - BUDGET)} over the budget.`,
    });
  }

  const cc = clubCount(sq, byId);
  const over = Object.entries(cc).some(([, n]) => n > MAXCLUB);
  out.push({
    key: "clubs",
    ok: !over,
    label: over
      ? "Max 3 players per club — you have too many from one club."
      : "No more than 3 players from any one club.",
  });

  const xi = xiIds(sq);
  const capOk = !!sq.captain && xi.includes(sq.captain);
  out.push({
    key: "captain",
    ok: capOk,
    label: capOk
      ? `Captain: ${byId.get(sq.captain!)?.n ?? "chosen"}.`
      : "Choose a captain from your starting XI.",
  });

  // The two armbands are one job to the viewer, so the "same player twice" case
  // is reported here rather than as a fifth line they read after fixing this one.
  const viceOk = !!sq.vice && xi.includes(sq.vice) && sq.vice !== sq.captain;
  out.push({
    key: "vice",
    ok: viceOk,
    label: viceOk
      ? `Vice-captain: ${byId.get(sq.vice!)?.n ?? "chosen"}.`
      : sq.vice && xi.includes(sq.vice) && sq.vice === sq.captain
        ? "Captain and vice-captain must be different players."
        : "Choose a vice-captain from your starting XI.",
  });

  return out;
}

/** Checks a squad being built in the browser, for live feedback while picking. */
export function validateSquad(sq: Squad, byId: Map<number, Player>, budgetOn: boolean): string[] {
  return squadChecklist(sq, byId, budgetOn).filter((c) => !c.ok).map((c) => c.label);
}

/**
 * Checks a submitted entry from scratch, on the server, against real prices.
 * The browser is never trusted: this is what decides whether a team is legal.
 */
export function validateEntry(
  input: EntryInput,
  byId: Map<number, Player>,
  budgetOn: boolean,
): string[] {
  const errs: string[] = [];
  const xi = input.xi ?? [], bench = input.bench ?? [];
  const all = [...xi, ...bench];

  if (xi.length !== 11) errs.push("A starting XI must have 11 players.");
  if (bench.length !== 4) errs.push("A bench must have 4 players.");
  if (new Set(all).size !== all.length) errs.push("The same player appears twice.");
  for (const id of all) if (!byId.has(id)) errs.push("That squad contains a player who is not in the game.");
  if (errs.length) return errs;

  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<PosId, number>;
  for (const id of all) counts[byId.get(id)!.pos]++;
  for (const k of POSITIONS) {
    if (counts[k] !== SQUAD[k]) errs.push(`A squad needs exactly ${SQUAD[k]} ${POSLONG[k].toLowerCase()}.`);
  }

  const xiCounts = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<PosId, number>;
  for (const id of xi) xiCounts[byId.get(id)!.pos]++;
  if (xiCounts[1] !== XI_MAX[1]) errs.push("A starting XI needs exactly one goalkeeper.");
  if (xiCounts[2] < XI_MIN[2] || xiCounts[2] > XI_MAX[2]) errs.push("A starting XI needs 3 to 5 defenders.");
  if (xiCounts[3] < XI_MIN[3] || xiCounts[3] > XI_MAX[3]) errs.push("A starting XI needs 2 to 5 midfielders.");
  if (xiCounts[4] < XI_MIN[4] || xiCounts[4] > XI_MAX[4]) errs.push("A starting XI needs 1 to 3 forwards.");

  const clubs: Record<number, number> = {};
  for (const id of all) {
    const t = byId.get(id)!.team;
    clubs[t] = (clubs[t] ?? 0) + 1;
  }
  if (Object.values(clubs).some((n) => n > MAXCLUB)) errs.push("Max 3 players from any one club.");

  if (budgetOn) {
    const total = all.reduce((s, id) => s + byId.get(id)!.cost, 0);
    if (total > BUDGET) errs.push(`That squad costs ${money(total)}, over the ${money(BUDGET)} budget.`);
  }

  if (!xi.includes(input.captain)) errs.push("The captain must be in the starting XI.");
  if (!xi.includes(input.vice)) errs.push("The vice-captain must be in the starting XI.");
  if (input.captain === input.vice) errs.push("Captain and vice-captain must be different players.");
  if (!FORMS[input.formation]) errs.push("That is not a valid formation.");

  return errs;
}

/* ================= crowd maths ================= */

export type Tally = {
  xi: Record<number, number>;
  squad: Record<number, number>;
  captain: Record<number, number>;
  vice: Record<number, number>;
  n: number;
};

export function tally(entries: Pick<Entry, "xi" | "bench" | "captain" | "vice">[]): Tally {
  const t: Tally = { xi: {}, squad: {}, captain: {}, vice: {}, n: entries.length };
  for (const e of entries) {
    for (const id of e.xi ?? []) { t.xi[id] = (t.xi[id] ?? 0) + 1; t.squad[id] = (t.squad[id] ?? 0) + 1; }
    for (const id of e.bench ?? []) t.squad[id] = (t.squad[id] ?? 0) + 1;
    if (e.captain) t.captain[e.captain] = (t.captain[e.captain] ?? 0) + 1;
    if (e.vice) t.vice[e.vice] = (t.vice[e.vice] ?? 0) + 1;
  }
  return t;
}

export function ranked(
  counts: Record<number, number>,
  n: number,
  byId: Map<number, Player>,
  pos?: PosId,
): Ranked[] {
  const out: Ranked[] = [];
  for (const key of Object.keys(counts)) {
    const id = Number(key);
    const player = byId.get(id);
    if (!player) continue;
    if (pos && player.pos !== pos) continue;
    out.push({ id, player, count: counts[id], pct: n ? (counts[id] * 100) / n : 0 });
  }
  out.sort((a, b) => b.count - a.count || b.player.sel - a.player.sel || a.player.n.localeCompare(b.player.n));
  return out;
}

/**
 * The crowd XI: the most-picked player at each position, then the next, and so
 * on — constrained only by what makes a legal formation, so the shape comes out
 * of the votes rather than being fixed in advance.
 */
export function crowdXI(
  t: Tally,
  byId: Map<number, Player>,
  /** The shape the host fixed for the board, if they fixed one. An unknown name
   *  is ignored rather than trusted — the crowd decides, as it always did. */
  formation?: string | null,
): CrowdXI {
  const fixed = formation && FORMS[formation] ? startCount(formation) : null;
  const pools: Record<PosId, Ranked[]> = {
    1: ranked(t.xi, t.n, byId, 1), 2: ranked(t.xi, t.n, byId, 2),
    3: ranked(t.xi, t.n, byId, 3), 4: ranked(t.xi, t.n, byId, 4),
  };
  const rows: Record<PosId, Ranked[]> = { 1: [], 2: [], 3: [], 4: [] };
  const used = new Set<number>();

  const take = (k: PosId, howMany: number) => {
    for (const r of pools[k]) {
      if (howMany <= 0) break;
      if (used.has(r.id)) continue;
      used.add(r.id); rows[k].push(r); howMany--;
    }
  };
  if (fixed) {
    // The host wants the same shape on screen every week, so each row is simply
    // its own most-picked players. Nobody competes across positions.
    for (const k of POSITIONS) take(k, fixed[k]);
  } else {
    take(1, 1); take(2, 3); take(3, 2); take(4, 1);      // the legal minimum, 1-3-2-1

    const caps: Record<number, number> = { 2: 5, 3: 5, 4: 3 };
    for (let slot = 0; slot < 4; slot++) {               // then the four best left over
      let best: Ranked | null = null;
      let bestPos: PosId = 2;
      for (const k of [2, 3, 4] as PosId[]) {
        if (rows[k].length >= caps[k]) continue;
        const cand = pools[k].find((r) => !used.has(r.id));
        if (cand && (!best || cand.count > best.count)) { best = cand; bestPos = k; }
      }
      if (!best) break;
      used.add(best.id); rows[bestPos].push(best);
    }
  }
  for (const k of [2, 3, 4] as PosId[]) rows[k].sort((a, b) => b.count - a.count);

  // Early on a fixed shape may have more slots than there are voted-for players.
  // The board still draws what the host chose, with the unfilled slots empty.
  const shape = fixed ?? ({
    1: rows[1].length, 2: rows[2].length, 3: rows[3].length, 4: rows[4].length,
  } as Record<PosId, number>);

  const picked = POSITIONS.flatMap((k) => rows[k]);
  const cost = picked.reduce((s, r) => s + r.player.cost, 0);
  const clubs: Record<number, number> = {};
  for (const r of picked) clubs[r.player.team] = (clubs[r.player.team] ?? 0) + 1;

  return {
    rows,
    shape,
    formation: `${shape[2]}-${shape[3]}-${shape[4]}`,
    captain: ranked(t.captain, t.n, byId)[0] ?? null,
    vice: ranked(t.vice, t.n, byId)[0] ?? null,
    cost,
    clubBreaches: Object.entries(clubs).filter(([, n]) => n > MAXCLUB).map(([team]) => team),
  };
}

/* ================= scoring ================= */

export type Scored = {
  points: number;
  /** The XI that actually scored, after any auto-subs. */
  xi: number[];
  /** Whoever ended up wearing the armband — the vice, if the captain sat out. */
  captain: number | null;
  armbandMoved: boolean;
  subs: { off: number; on: number }[];
};

const NOT_PLAYED: LiveStat = { pts: 0, min: 0 };

/** Position counts of an XI. A player the game has dropped counts for nothing. */
function shape(ids: number[], byId: Map<number, Player>): Record<PosId, number> {
  const c = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<PosId, number>;
  for (const id of ids) {
    const pos = byId.get(id)?.pos;
    if (pos) c[pos]++;
  }
  return c;
}

function legalXI(ids: number[], byId: Map<number, Player>): boolean {
  const c = shape(ids, byId);
  return POSITIONS.every((k) => c[k] >= XI_MIN[k] && c[k] <= XI_MAX[k]);
}

/**
 * FPL's auto-subs: a starter who played no minutes is replaced by the first
 * player on the bench who did play and whose position keeps the XI legal. The
 * shape check is what stops an outfielder replacing the keeper, or a second
 * keeper coming on — no special case needed for either.
 *
 * Bench order is the order the entry was submitted in, which the picker fixes as
 * keeper first, then by position. Viewers cannot reorder their bench yet.
 */
export function autoSubs(
  xi: number[],
  bench: number[],
  stats: Record<number, LiveStat>,
  byId: Map<number, Player>,
): { xi: number[]; subs: { off: number; on: number }[] } {
  const out = [...xi];
  const subs: { off: number; on: number }[] = [];
  const used = new Set<number>();
  const played = (id: number) => (stats[id] ?? NOT_PLAYED).min > 0;

  for (let i = 0; i < out.length; i++) {
    const off = out[i];
    if (played(off)) continue;
    for (const on of bench) {
      if (used.has(on) || !played(on)) continue;
      const trial = [...out];
      trial[i] = on;
      if (!legalXI(trial, byId)) continue;
      out[i] = on;
      used.add(on);
      subs.push({ off, on });
      break;
    }
  }
  return { xi: out, subs };
}

/**
 * One viewer's gameweek score, the way FPL settles it: captain doubled, bench
 * not counted unless it comes on.
 *
 * `settled` says whether the gameweek has finished. Auto-subs and the armband
 * only move once it has: before then a player on zero minutes has usually just
 * not kicked off yet, and subbing them off would show a score that is wrong in
 * a way nobody can explain on stream.
 */
export function scoreEntry(
  entry: Pick<Entry, "xi" | "bench" | "captain" | "vice">,
  stats: Record<number, LiveStat>,
  byId: Map<number, Player>,
  settled: boolean,
): Scored {
  const started = entry.xi ?? [];
  const { xi, subs } = settled
    ? autoSubs(started, entry.bench ?? [], stats, byId)
    : { xi: [...started], subs: [] as { off: number; on: number }[] };

  let captain: number | null = entry.captain ?? null;
  let armbandMoved = false;
  if (settled && captain && (stats[captain] ?? NOT_PLAYED).min === 0) {
    if (entry.vice && entry.vice !== captain) {
      captain = entry.vice;
      armbandMoved = true;
    }
  }

  const points = xi.reduce(
    (sum, id) => sum + (stats[id] ?? NOT_PLAYED).pts * (id === captain ? 2 : 1),
    0,
  );

  return { points, xi, captain, armbandMoved, subs };
}

/** Places in a table, sharing a rank on a tie the way a league table does. */
export function rankBy<T>(rows: T[], points: (r: T) => number): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => points(b) - points(a));
  let rank = 0;
  let last: number | null = null;
  return sorted.map((r, i) => {
    const p = points(r);
    if (last === null || p !== last) { rank = i + 1; last = p; }
    return { ...r, rank };
  });
}
