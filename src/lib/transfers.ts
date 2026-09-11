/**
 * Transfer pools: the host's own team goes up, and the crowd votes on what to
 * change. Pure, like `squad.ts` beside it, and imported by both the browser
 * (instant feedback while a viewer picks) and the server (the decision that
 * counts). No I/O.
 *
 * **A transfer is a pair.** `out[i]` is sold to sign `in[i]`, and the two are
 * always the same position. That is not a house rule invented to make the
 * board tidy: a squad must stay 2 keepers, 5 defenders, 5 midfielders and 3
 * forwards, so the positions going out and the positions coming in have to
 * match as multisets, and any legal set of transfers can therefore be written
 * as position-matched pairs. Writing them that way is what makes
 * "Haaland → João Pedro, 10%" a thing that can be counted, rather than a guess
 * at which sale paid for which signing.
 *
 * **Prices are today's prices.** FPL only reveals a player's selling price to
 * the manager who owns him, through an endpoint that needs his login. So a
 * player is valued at his current price on both sides of the trade. That is
 * right to within a tenth or two of the host's real bank, and it is said on
 * screen rather than assumed silently.
 */

import { FORMS, MAXCLUB, POS, POSITIONS, SQUAD, money, startCount } from "./squad";
import type { HostSquad, Player, PosId, Ranked, TransferInput, TransferRow } from "./types";

/** How many transfers a viewer may make when the host has not said. */
export const DEFAULT_MOVES = 1;
/** What a host may choose. 0 is unlimited, which in practice is the 15 they own. */
export const MOVE_CHOICES = [1, 2, 3, 4, 5, 0];
/** Unlimited still cannot exceed the squad. */
export const MAX_MOVES = 15;

export function movesAllowed(moves: number | null | undefined): number {
  const n = moves ?? DEFAULT_MOVES;
  return n > 0 && n <= MAX_MOVES ? n : MAX_MOVES;
}

export function movesLabel(moves: number | null | undefined): string {
  const n = moves ?? DEFAULT_MOVES;
  if (n <= 0 || n > MAX_MOVES) return "Unlimited transfers";
  return n === 1 ? "One transfer each" : `${n} transfers each`;
}

/** Everyone in the host's team, XI first. */
export function hostIds(sq: HostSquad): number[] {
  return [...(sq.xi ?? []), ...(sq.bench ?? [])];
}

/**
 * What a player is worth, going either way. One function so a change of mind
 * about selling prices lands in one place rather than four.
 */
export function value(id: number, byId: Map<number, Player>): number {
  return byId.get(id)?.cost ?? 0;
}

/** What the host's team is worth, and what is left over. */
export function squadValue(sq: HostSquad, byId: Map<number, Player>): number {
  return hostIds(sq).reduce((s, id) => s + value(id, byId), 0);
}

/**
 * The money left after a set of transfers. Negative means the viewer has
 * spent more than they have, which is the one thing about a transfer that is
 * not a matter of opinion.
 */
export function fundsLeft(
  sq: HostSquad,
  out: number[],
  incoming: number[],
  byId: Map<number, Player>,
): number {
  const raised = out.reduce((s, id) => s + value(id, byId), 0);
  const spent = incoming.reduce((s, id) => s + value(id, byId), 0);
  return (sq.bank ?? 0) + raised - spent;
}

/* ================= applying a transfer ================= */

/**
 * The team a set of transfers leaves behind. The incoming player takes the
 * outgoing player's slot — his place in the XI or on the bench, and his place
 * in the substitute order — so the shape never moves and the host recognises
 * their own team on the board.
 *
 * An armband is not inherited. Buying a player is not a decision to captain
 * him, so selling the captain is a transfer that has to name a new one; that
 * is checked in `validateTransfer`, and honoured here by leaving the captain
 * off the result rather than guessing.
 */
export function applyTransfers(
  sq: HostSquad,
  out: number[],
  incoming: number[],
  captain?: number | null,
): HostSquad {
  const swap = new Map<number, number>();
  for (let i = 0; i < out.length && i < incoming.length; i++) swap.set(out[i], incoming[i]);

  const xi = (sq.xi ?? []).map((id) => swap.get(id) ?? id);
  const bench = (sq.bench ?? []).map((id) => swap.get(id) ?? id);
  const still = (id: number) => !swap.has(id);

  return {
    ...sq,
    xi,
    bench,
    captain: captain ?? (still(sq.captain) ? sq.captain : 0),
    // The vice is not voted on, so he stays where he is until he is sold, and
    // then there simply is not one. The board says so rather than inventing one.
    vice: still(sq.vice) ? sq.vice : 0,
  };
}

/** Position counts of a squad, so the club cap and the shape can be checked. */
export function clubCounts(ids: number[], byId: Map<number, Player>): Record<number, number> {
  const c: Record<number, number> = {};
  for (const id of ids) {
    const t = byId.get(id)?.team;
    if (t) c[t] = (c[t] ?? 0) + 1;
  }
  return c;
}

/* ================= the host's own team ================= */

/**
 * Whether a team is fit to be the base of a pool. The budget is deliberately
 * not checked: an imported team is whatever the host actually owns, and after
 * a season of price rises that is routinely worth more than £100.0m.
 */
export function validateHostSquad(sq: HostSquad | null, byId: Map<number, Player>): string[] {
  const errs: string[] = [];
  if (!sq) return ["That team is empty."];

  const xi = sq.xi ?? [], bench = sq.bench ?? [];
  const all = [...xi, ...bench];
  if (xi.length !== 11) errs.push("A starting XI must have 11 players.");
  if (bench.length !== 4) errs.push("A bench must have 4 players.");
  if (new Set(all).size !== all.length) errs.push("The same player appears twice in that team.");
  for (const id of all) if (!byId.has(id)) errs.push("That team contains a player who is not in the game.");
  if (errs.length) return errs;

  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<PosId, number>;
  for (const id of all) counts[byId.get(id)!.pos]++;
  for (const k of POSITIONS) {
    if (counts[k] !== SQUAD[k]) errs.push(`A squad needs exactly ${SQUAD[k]} ${POS[k]}.`);
  }

  if (!xi.includes(sq.captain)) errs.push("The captain must be in the starting XI.");
  if (!xi.includes(sq.vice)) errs.push("The vice-captain must be in the starting XI.");
  if (sq.captain === sq.vice) errs.push("Captain and vice-captain must be different players.");
  if (!FORMS[sq.formation]) errs.push("That is not a valid formation.");
  if (!Number.isFinite(sq.bank) || sq.bank < 0) errs.push("The bank cannot be negative.");

  return errs;
}

/** The formation an XI is in, read off the players rather than trusted. */
export function readFormation(xi: number[], byId: Map<number, Player>): string {
  const c = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<PosId, number>;
  for (const id of xi) {
    const pos = byId.get(id)?.pos;
    if (pos) c[pos]++;
  }
  return `${c[2]}-${c[3]}-${c[4]}`;
}

/** Sorts an XI keeper-first and a bench into the order subs come on in. */
export function orderSquad(sq: HostSquad, byId: Map<number, Player>): HostSquad {
  const byPos = (a: number, b: number) => (byId.get(a)?.pos ?? 9) - (byId.get(b)?.pos ?? 9);
  const xi = [...(sq.xi ?? [])].sort(byPos);
  const bench = [...(sq.bench ?? [])].sort(byPos);
  return { ...sq, xi, bench, formation: readFormation(xi, byId) };
}

/* ================= checking a viewer's transfers ================= */

export type TransferOpts = {
  /** How many transfers the host allows. 0 is unlimited. */
  moves: number;
  /** Whether the money has to add up. Off for a pool run without FPL rules. */
  budget: boolean;
};

/** One requirement, met or not, with the sentence to show for it. */
export type TransferCheck = { key: string; ok: boolean; label: string };

/**
 * The picker's readiness list. `validateTransfer` is this list with the met
 * ones dropped, so what the viewer is told while choosing and what the server
 * says when they send can never drift apart — the same arrangement
 * `squadChecklist` and `validateSquad` have.
 */
export function transferChecklist(
  input: Pick<TransferInput, "out" | "in" | "captain">,
  sq: HostSquad,
  byId: Map<number, Player>,
  opts: TransferOpts,
): TransferCheck[] {
  const out = input.out ?? [], incoming = input.in ?? [];
  const owned = new Set(hostIds(sq));
  const cap = movesAllowed(opts.moves);
  const checks: TransferCheck[] = [];

  // Every complaint below dereferences the players, so a malformed pairing is
  // reported on its own and nothing further is claimed about it.
  const paired = out.length === incoming.length;
  const sound =
    paired &&
    out.length <= cap &&
    new Set(out).size === out.length &&
    new Set(incoming).size === incoming.length &&
    out.every((id) => owned.has(id) && byId.has(id)) &&
    incoming.every((id) => !owned.has(id) && byId.has(id)) &&
    out.every((id, i) => byId.get(id)!.pos === byId.get(incoming[i])!.pos);

  checks.push({
    key: "pairs",
    ok: sound,
    label: !paired
      ? "Every player you take out needs one coming in."
      : out.length > cap
        ? `That is ${out.length} transfers and this pool allows ${cap}.`
        : new Set(out).size !== out.length || new Set(incoming).size !== incoming.length
          ? "The same player appears twice in your transfers."
          : !out.every((id) => owned.has(id))
            ? "You can only transfer out a player who is in the team."
            : !incoming.every((id) => !owned.has(id))
              ? "That player is already in the team."
              : !out.every((id) => byId.has(id)) || !incoming.every((id) => byId.has(id))
                ? "One of those players is not in the game."
                : sound
                  ? out.length === 0
                    ? "No transfer — you would keep the team as it is."
                    : out.length === 1
                      ? "One transfer."
                      : `${out.length} transfers.`
                  : "A player can only be swapped for one in the same position.",
  });

  if (!sound) return checks;

  const after = applyTransfers(sq, out, incoming, input.captain);
  const all = hostIds(after);

  if (opts.budget) {
    const left = fundsLeft(sq, out, incoming, byId);
    checks.push({
      key: "funds",
      ok: left >= 0,
      label: left >= 0
        ? `Affordable, with ${money(left)} left in the bank.`
        : `That is ${money(-left)} more than there is to spend.`,
    });
  }

  const clubs = clubCounts(all, byId);
  const overClub = Object.values(clubs).some((n) => n > MAXCLUB);
  checks.push({
    key: "clubs",
    ok: !overClub,
    label: overClub
      ? `That would leave more than ${MAXCLUB} players from one club.`
      : `No more than ${MAXCLUB} players from any one club.`,
  });

  // Only a transfer that sells the captain forces the question. Otherwise the
  // armband is an opinion the viewer may or may not have.
  const soldCaptain = out.includes(sq.captain);
  const capOk = !soldCaptain || (!!input.captain && after.xi.includes(input.captain));
  checks.push({
    key: "captain",
    ok: capOk,
    label: capOk
      ? input.captain
        ? `Captain: ${byId.get(input.captain)?.n ?? "chosen"}.`
        : `Captain stays ${byId.get(sq.captain)?.n ?? "as it is"}.`
      : "You have sold the captain, so pick a new one from the starting XI.",
  });

  if (input.captain && !soldCaptain) {
    const inXI = after.xi.includes(input.captain);
    checks.push({
      key: "capxi",
      ok: inXI,
      label: inXI ? "The armband is on a player who starts." : "The captain must be in the starting XI.",
    });
  }

  return checks;
}

/**
 * Checks a submitted set of transfers from scratch, on the server, against real
 * prices. The browser is never trusted: this is what decides whether a vote
 * counts.
 */
export function validateTransfer(
  input: Pick<TransferInput, "out" | "in" | "captain">,
  sq: HostSquad,
  byId: Map<number, Player>,
  opts: TransferOpts,
): string[] {
  return transferChecklist(input, sq, byId, opts).filter((c) => !c.ok).map((c) => c.label);
}

/* ================= crowd maths ================= */

/** One swap the crowd voted for, and how many wanted it. */
export type SwapRank = {
  key: string;
  out: Player;
  in: Player;
  count: number;
  pct: number;
};

export type TransferTally = {
  /** Votes cast. */
  n: number;
  /** Votes that proposed no transfer at all — the crowd saying hold. */
  hold: number;
  out: Record<number, number>;
  in: Record<number, number>;
  swaps: Record<string, number>;
  captain: Record<number, number>;
};

export function tallyTransfers(
  rows: Pick<TransferRow, "out_ids" | "in_ids" | "captain">[],
): TransferTally {
  const t: TransferTally = { n: rows.length, hold: 0, out: {}, in: {}, swaps: {}, captain: {} };
  for (const r of rows) {
    const out = r.out_ids ?? [], incoming = r.in_ids ?? [];
    if (!out.length) t.hold++;
    for (let i = 0; i < out.length; i++) {
      t.out[out[i]] = (t.out[out[i]] ?? 0) + 1;
      const to = incoming[i];
      if (to == null) continue;
      t.in[to] = (t.in[to] ?? 0) + 1;
      const key = `${out[i]}>${to}`;
      t.swaps[key] = (t.swaps[key] ?? 0) + 1;
    }
    if (r.captain) t.captain[r.captain] = (t.captain[r.captain] ?? 0) + 1;
  }
  return t;
}

/**
 * A percentage of the voters, not of the transfers. "10% want Haaland out" is
 * the sentence a host says on stream, and it only means anything if the
 * denominator is people.
 */
function rankIds(
  counts: Record<number, number>,
  n: number,
  byId: Map<number, Player>,
): Ranked[] {
  const out: Ranked[] = [];
  for (const key of Object.keys(counts)) {
    const id = Number(key);
    const player = byId.get(id);
    if (!player) continue;
    out.push({ id, player, count: counts[id], pct: n ? (counts[id] * 100) / n : 0 });
  }
  out.sort((a, b) => b.count - a.count || b.player.sel - a.player.sel || a.player.n.localeCompare(b.player.n));
  return out;
}

function rankSwaps(
  counts: Record<string, number>,
  n: number,
  byId: Map<number, Player>,
): SwapRank[] {
  const out: SwapRank[] = [];
  for (const key of Object.keys(counts)) {
    const [a, b] = key.split(">").map(Number);
    const from = byId.get(a), to = byId.get(b);
    if (!from || !to) continue;
    out.push({ key, out: from, in: to, count: counts[key], pct: n ? (counts[key] * 100) / n : 0 });
  }
  out.sort((a, b) =>
    b.count - a.count || b.in.sel - a.in.sel || a.in.n.localeCompare(b.in.n));
  return out;
}

export type CrowdTransfers = {
  n: number;
  hold: number;
  /** Share of voters who would make no transfer at all. */
  holdPct: number;
  out: Ranked[];
  in: Ranked[];
  swaps: SwapRank[];
  captain: Ranked[];
  /** The swaps the crowd actually wins, in vote order, up to the pool's
   *  allowance and skipping any that clash with one already taken. */
  applied: SwapRank[];
  /** The team those swaps leave behind — what goes on the pitch. */
  squad: HostSquad;
  /** What is left in the bank after them. Negative is reported, not fixed. */
  bank: number;
  /** Clubs the result would have four or more from. A fact, not a verdict. */
  stacked: [number, number][];
};

/**
 * What the crowd decided. The winning swaps go on the pitch in vote order —
 * as many as the pool allows — and each one after the first is skipped if it
 * needs a player an earlier swap already used, because nobody can be sold or
 * signed twice.
 *
 * What is deliberately *not* done here is dropping a swap because it costs too
 * much or breaks the club cap. That is the same call `crowdXI` makes: the
 * aggregate answers "what does the crowd want", and quietly replacing the
 * winner with the runner-up would put a transfer on stream that nobody voted
 * for. The bank and the club counts come back alongside instead, for the board
 * to point at.
 */
/**
 * Who wears the armband once a set of transfers has gone through. The vote
 * wins when there is one, skipping anyone those transfers have just sold, and
 * otherwise the armband stays with the host — unless the transfers sold him,
 * which is the one case where the board would draw a C on an empty shirt. Null
 * means there is no captain and the board says so rather than inventing one.
 *
 * Shared by the crowd's own result and by the host trying a set of transfers on
 * the board, so the two can never disagree about where the armband ends up.
 */
export function crowdCaptain(
  sq: HostSquad,
  outIds: number[],
  ranked: Ranked[],
): number | null {
  const voted = ranked.find((r) => !outIds.includes(r.id));
  if (voted) return voted.id;
  return outIds.includes(sq.captain) ? null : sq.captain;
}

export function crowdTransfers(
  rows: Pick<TransferRow, "out_ids" | "in_ids" | "captain">[],
  sq: HostSquad,
  byId: Map<number, Player>,
  moves: number,
): CrowdTransfers {
  const t = tallyTransfers(rows);
  const swaps = rankSwaps(t.swaps, t.n, byId);
  const cap = movesAllowed(moves);

  const applied: SwapRank[] = [];
  const used = new Set<number>();
  for (const s of swaps) {
    if (applied.length >= cap) break;
    if (used.has(s.out.id) || used.has(s.in.id)) continue;
    used.add(s.out.id);
    used.add(s.in.id);
    applied.push(s);
  }

  const captain = rankIds(t.captain, t.n, byId);
  const outIds = applied.map((s) => s.out.id);
  const inIds = applied.map((s) => s.in.id);

  const squad = applyTransfers(sq, outIds, inIds, crowdCaptain(sq, outIds, captain));
  const bank = fundsLeft(sq, outIds, inIds, byId);
  const stacked = Object.entries(clubCounts(hostIds(squad), byId))
    .map(([team, n]) => [Number(team), n] as [number, number])
    .filter(([, n]) => n > MAXCLUB)
    .sort((a, b) => b[1] - a[1]);

  return {
    n: t.n,
    hold: t.hold,
    holdPct: t.n ? (t.hold * 100) / t.n : 0,
    out: rankIds(t.out, t.n, byId),
    in: rankIds(t.in, t.n, byId),
    swaps,
    captain,
    applied,
    squad,
    bank,
    stacked,
  };
}

/** Which row of the pitch a player sits in, for drawing the host's team. */
export function pitchRowsOf(
  sq: HostSquad,
  byId: Map<number, Player>,
): Record<PosId, number[]> {
  const rows: Record<PosId, number[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const id of sq.xi ?? []) {
    const pos = byId.get(id)?.pos;
    if (pos) rows[pos].push(id);
  }
  // A shape read off the players can disagree with a stored formation after an
  // import; the players are what is actually on the pitch, so they win.
  const sc = startCount(sq.formation);
  for (const k of POSITIONS) {
    while (rows[k].length < sc[k]) rows[k].push(0);
  }
  return rows;
}
