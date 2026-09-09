import { describe, expect, it } from "vitest";
import { autoSubs, rankBy, scoreEntry } from "@/lib/squad";
import type { Entry, LiveStat } from "@/lib/types";
import { world } from "./fixtures";

const w = world();

/** Live stats from a shorthand: `{ 8: [12, 90] }` is 12 points in 90 minutes.
 *  Anyone left out is a player the FPL API has said nothing about yet. */
function live(spec: Record<number, [number, number]>): Record<number, LiveStat> {
  const out: Record<number, LiveStat> = {};
  for (const [id, [pts, min]] of Object.entries(spec)) out[Number(id)] = { pts, min };
  return out;
}

const OUT: LiveStat = { pts: 0, min: 0 };      // named on the teamsheet, never came on
const ON = (pts: number): LiveStat => ({ pts, min: 90 });

/** Everyone in the 15 played 90 minutes for the given points. */
function played(pts: Record<number, number>): Record<number, LiveStat> {
  const out: Record<number, LiveStat> = {};
  for (const id of [...w.entry.xi, ...w.entry.bench]) out[id] = { pts: pts[id] ?? 0, min: 90 };
  return out;
}

const entry = (over: Partial<Entry> = {}) => ({
  xi: w.entry.xi,
  bench: w.entry.bench,
  captain: w.entry.captain,   // 8, a midfielder
  vice: w.entry.vice,         // 9, a midfielder
  ...over,
});

/* The world's 4-4-2: GK 1 · DEF 3,4,5,6 · MID 8,9,10,11 · FWD 13,14,
   bench 2 (GK), 7 (DEF), 12 (MID), 15 (FWD). */

describe("scoreEntry — the sum", () => {
  it("adds up the XI and doubles the captain", () => {
    const s = scoreEntry(entry(), played({ 8: 10, 9: 4, 3: 2 }), w.byId, true);
    expect(s.points).toBe(10 * 2 + 4 + 2);
    expect(s.captain).toBe(8);
    expect(s.armbandMoved).toBe(false);
  });

  it("leaves the bench out of it", () => {
    const s = scoreEntry(entry(), played({ 8: 5, 12: 99, 15: 99 }), w.byId, true);
    expect(s.points).toBe(10);
  });

  it("treats a player the live feed has not mentioned as nil", () => {
    const s = scoreEntry(entry(), live({ 8: [6, 90] }), w.byId, false);
    expect(s.points).toBe(12);
  });

  it("scores nothing, rather than throwing, on an empty gameweek", () => {
    expect(scoreEntry(entry(), {}, w.byId, true).points).toBe(0);
  });
});

describe("scoreEntry — before the gameweek is settled", () => {
  // Nil minutes usually means "has not kicked off yet", so nothing moves.
  const stats = live({ 12: [9, 90], 9: [5, 90], 3: [3, 90] });   // 8 and the rest on nil

  it("brings nobody on for a starter on nil", () => {
    const s = scoreEntry(entry(), stats, w.byId, false);
    expect(s.subs).toEqual([]);
    expect(s.xi).toEqual(w.entry.xi);
  });

  it("leaves the armband on a captain who has not played", () => {
    const s = scoreEntry(entry(), stats, w.byId, false);
    expect(s.captain).toBe(8);
    expect(s.armbandMoved).toBe(false);
    expect(s.points).toBe(5 + 3);      // the vice is not doubled
  });
});

describe("autoSubs — once the gameweek is settled", () => {
  it("replaces a starter on nil with the first bench player who played", () => {
    const stats = { ...allPlayed(), 10: OUT, 7: ON(1), 12: ON(4) };
    const { xi, subs } = autoSubs(w.entry.xi, w.entry.bench, stats, w.byId);
    // 7 is a defender: swapping a midfielder for him leaves 5 DEF / 3 MID, legal.
    expect(subs).toEqual([{ off: 10, on: 7 }]);
    expect(xi).toContain(7);
    expect(xi).not.toContain(10);
  });

  it("does not bring on a bench player who played no minutes either", () => {
    const stats = { ...allPlayed(), 10: OUT, 7: OUT, 12: OUT, 15: OUT };
    expect(autoSubs(w.entry.xi, w.entry.bench, stats, w.byId).subs).toEqual([]);
  });

  it("uses each bench player once, in bench order", () => {
    const stats = { ...allPlayed(), 10: OUT, 11: OUT };
    const { subs } = autoSubs(w.entry.xi, w.entry.bench, stats, w.byId);
    expect(subs).toEqual([{ off: 10, on: 7 }, { off: 11, on: 12 }]);
  });

  it("replaces the keeper only with the keeper on the bench", () => {
    const stats = { ...allPlayed(), 1: OUT };
    const { subs } = autoSubs(w.entry.xi, w.entry.bench, stats, w.byId);
    expect(subs).toEqual([{ off: 1, on: 2 }]);
  });

  it("leaves the keeper on the pitch when the bench keeper did not play", () => {
    const stats = { ...allPlayed(), 1: OUT, 2: OUT };
    expect(autoSubs(w.entry.xi, w.entry.bench, stats, w.byId).subs).toEqual([]);
  });

  it("never brings the bench keeper on for an outfielder", () => {
    // Only the keeper is left on the bench, and a second keeper is not a legal XI.
    const stats = { ...allPlayed(), 10: OUT, 7: OUT, 12: OUT, 15: OUT };
    const { subs } = autoSubs(w.entry.xi, w.entry.bench, stats, w.byId);
    expect(subs).toEqual([]);
  });

  it("refuses a substitution that would break the formation", () => {
    // Three at the back: losing a defender for a midfielder would leave two.
    const xi = [1, 3, 4, 5, 8, 9, 10, 11, 13, 14, 15];
    const bench = [2, 6, 7, 12];
    const stats: Record<number, LiveStat> = {};
    for (const id of [...xi, ...bench]) stats[id] = { pts: 1, min: 90 };
    stats[3] = OUT;
    stats[6] = OUT;                    // both bench defenders sat out
    stats[7] = OUT;
    expect(autoSubs(xi, bench, stats, w.byId).subs).toEqual([]);

    stats[7] = ON(2);                  // a defender is available again
    expect(autoSubs(xi, bench, stats, w.byId).subs).toEqual([{ off: 3, on: 7 }]);
  });

  // The other end of the shape — six defenders, or a fourth forward — cannot be
  // reached: a 1-for-1 swap can only push a position over its cap if the squad
  // holds more of that position than an XI may start, and it never does.

  it("has nothing to do when there is no bench, as the crowd XI has none", () => {
    const stats = { ...allPlayed(), 10: OUT };
    expect(autoSubs(w.entry.xi, [], stats, w.byId)).toEqual({ xi: w.entry.xi, subs: [] });
  });
});

describe("scoreEntry — the armband once the gameweek is settled", () => {
  it("passes it to the vice when the captain did not play", () => {
    const stats = { ...played({ 9: 7, 3: 1 }), 8: OUT };
    const s = scoreEntry(entry(), stats, w.byId, true);
    expect(s.captain).toBe(9);
    expect(s.armbandMoved).toBe(true);
    expect(s.points).toBe(7 * 2 + 1);
  });

  it("keeps it on a captain who played, however badly", () => {
    const s = scoreEntry(entry(), played({ 8: -1, 9: 7 }), w.byId, true);
    expect(s.captain).toBe(8);
    expect(s.armbandMoved).toBe(false);
    expect(s.points).toBe(-2 + 7);
  });

  it("doubles nothing worth having when the vice sat out too", () => {
    const stats = { ...played({ 3: 4 }), 8: OUT, 9: OUT };
    const s = scoreEntry(entry(), stats, w.byId, true);
    expect(s.armbandMoved).toBe(true);
    expect(s.points).toBe(4);
  });

  it("does not hand the double to whoever came on for the captain", () => {
    const stats = { ...played({ 7: 8, 9: 3 }), 8: OUT };
    const s = scoreEntry(entry(), stats, w.byId, true);
    expect(s.subs).toEqual([{ off: 8, on: 7 }]);   // the first bench player who played
    expect(s.captain).toBe(9);
    expect(s.points).toBe(3 * 2 + 8);              // the vice doubled, the sub counted once
  });
});

describe("rankBy", () => {
  it("orders by points, highest first", () => {
    const rows = rankBy([{ p: 3 }, { p: 9 }, { p: 5 }], (r) => r.p);
    expect(rows.map((r) => r.p)).toEqual([9, 5, 3]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("shares a rank on a tie and skips the ones used up", () => {
    const rows = rankBy([{ p: 9 }, { p: 9 }, { p: 4 }, { p: 4 }, { p: 1 }], (r) => r.p);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3, 3, 5]);
  });

  it("leaves the caller's array alone", () => {
    const rows = [{ p: 1 }, { p: 2 }];
    rankBy(rows, (r) => r.p);
    expect(rows.map((r) => r.p)).toEqual([1, 2]);
  });

  it("copes with nobody at all", () => {
    expect(rankBy([], (r: { p: number }) => r.p)).toEqual([]);
  });
});

/** Every player in the 15 on the pitch for 90 minutes and no points. */
function allPlayed(): Record<number, LiveStat> {
  const out: Record<number, LiveStat> = {};
  for (const id of [...w.entry.xi, ...w.entry.bench]) out[id] = { pts: 0, min: 90 };
  return out;
}
