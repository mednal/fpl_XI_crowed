import type { CrowdXI, Entry, EntryInput, Player, PosId, Ranked } from "./types";

export const POS: Record<PosId, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
export const POSLONG: Record<PosId, string> = {
  1: "Goalkeepers", 2: "Defenders", 3: "Midfielders", 4: "Forwards",
};
/** The real FPL squad: 2 keepers, 5 defenders, 5 midfielders, 3 forwards. */
export const SQUAD: Record<PosId, number> = { 1: 2, 2: 5, 3: 5, 4: 3 };
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

export function newSquad(): Squad {
  return {
    formation: "4-4-2",
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

/** Checks a squad being built in the browser, for live feedback while picking. */
export function validateSquad(sq: Squad, byId: Map<number, Player>, budgetOn: boolean): string[] {
  const errs: string[] = [];
  const ids = squadIds(sq);
  if (ids.length < 15) errs.push(`Pick all 15 players (${ids.length}/15 done).`);
  if (budgetOn && spent(sq, byId) > BUDGET) {
    errs.push(`You are ${money(spent(sq, byId) - BUDGET)} over the budget.`);
  }
  const cc = clubCount(sq, byId);
  const over = Object.entries(cc).filter(([, n]) => n > MAXCLUB);
  if (over.length) errs.push("Max 3 players per club — you have too many from one club.");
  const xi = xiIds(sq);
  if (!sq.captain || !xi.includes(sq.captain)) errs.push("Choose a captain from your starting XI.");
  if (!sq.vice || !xi.includes(sq.vice)) errs.push("Choose a vice-captain from your starting XI.");
  if (sq.captain && sq.captain === sq.vice) errs.push("Captain and vice-captain must be different players.");
  return errs;
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
  if (xiCounts[1] !== 1) errs.push("A starting XI needs exactly one goalkeeper.");
  if (xiCounts[2] < 3 || xiCounts[2] > 5) errs.push("A starting XI needs 3 to 5 defenders.");
  if (xiCounts[3] < 2 || xiCounts[3] > 5) errs.push("A starting XI needs 2 to 5 midfielders.");
  if (xiCounts[4] < 1 || xiCounts[4] > 3) errs.push("A starting XI needs 1 to 3 forwards.");

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
export function crowdXI(t: Tally, byId: Map<number, Player>): CrowdXI {
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
  for (const k of [2, 3, 4] as PosId[]) rows[k].sort((a, b) => b.count - a.count);

  const picked = POSITIONS.flatMap((k) => rows[k]);
  const cost = picked.reduce((s, r) => s + r.player.cost, 0);
  const clubs: Record<number, number> = {};
  for (const r of picked) clubs[r.player.team] = (clubs[r.player.team] ?? 0) + 1;

  return {
    rows,
    formation: `${rows[2].length}-${rows[3].length}-${rows[4].length}`,
    captain: ranked(t.captain, t.n, byId)[0] ?? null,
    vice: ranked(t.vice, t.n, byId)[0] ?? null,
    cost,
    clubBreaches: Object.entries(clubs).filter(([, n]) => n > MAXCLUB).map(([team]) => team),
  };
}
