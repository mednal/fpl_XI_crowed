import { describe, expect, it } from "vitest";
import type { SlotRef, Squad } from "@/lib/squad";
import {
  POSITIONS, SQUAD,
  applySwap, benchIds, removeFromSquad, squadIds, startCount, swapFormation,
  validateEntry, xiIds,
} from "@/lib/squad";
import { world } from "./fixtures";

/** The same finished squad the picker tests use: 1-2 GKP, 3-7 DEF, 8-12 MID, 13-15 FWD. */
function legal(formation = "4-4-2"): Squad {
  return {
    formation,
    p: { 1: [1, 2], 2: [3, 4, 5, 6, 7], 3: [8, 9, 10, 11, 12], 4: [13, 14, 15] },
    captain: 8,
    vice: 9,
  };
}

const at = (pos: 1 | 2 | 3 | 4, index: number): SlotRef => ({ pos, index });

describe("swapFormation — which substitutions the pitch offers", () => {
  it("keeps the shape when both players play the same position", () => {
    expect(swapFormation(legal(), at(3, 0), at(3, 4))).toBe("4-4-2");
    expect(swapFormation(legal(), at(1, 0), at(1, 1))).toBe("4-4-2");
  });

  it("changes the shape when a substitute of another position comes on", () => {
    // A midfielder on for a defender turns 4-4-2 into 3-5-2.
    expect(swapFormation(legal(), at(2, 0), at(3, 4))).toBe("3-5-2");
    expect(swapFormation(legal(), at(3, 4), at(2, 0))).toBe("3-5-2");
  });

  it("refuses a swap that leaves a shape the game does not have", () => {
    // 3-4-3 has the minimum three at the back already.
    expect(swapFormation(legal("3-4-3"), at(2, 0), at(3, 4))).toBeNull();
  });

  it("refuses to swap two players who are both already in the XI", () => {
    expect(swapFormation(legal(), at(2, 0), at(3, 0))).toBeNull();
    expect(swapFormation(legal(), at(2, 0), at(2, 1))).toBeNull();
  });

  it("refuses to trade two substitutes of different positions", () => {
    expect(swapFormation(legal("3-4-3"), at(2, 4), at(3, 4))).toBeNull();
  });

  it("keeps exactly one goalkeeper on the pitch", () => {
    expect(swapFormation(legal(), at(1, 0), at(2, 4))).toBeNull();
    expect(swapFormation(legal(), at(1, 1), at(2, 0))).toBeNull();
  });

  it("offers nothing for two empty slots, or for a player with themselves", () => {
    const half = legal();
    half.p[3][4] = null;
    half.p[2][4] = null;
    expect(swapFormation(half, at(2, 4), at(3, 4))).toBeNull();
    expect(swapFormation(legal(), at(3, 0), at(3, 0))).toBeNull();
  });

  it("offers a substitute the hole a removed starter left behind", () => {
    const gap = removeFromSquad(legal(), at(2, 0));      // a defender taken out
    expect(swapFormation(gap, at(2, 4), at(2, 0))).toBe("4-4-2");   // the fifth defender moves up
    expect(swapFormation(gap, at(3, 4), at(2, 0))).toBe("3-5-2");   // or a midfielder does
  });
});

describe("applySwap — what the substitution does to the squad", () => {
  it("swaps two players of the same position and leaves everyone else alone", () => {
    const next = applySwap(legal(), at(3, 0), at(3, 4));
    expect(next.p[3]).toEqual([12, 9, 10, 11, 8]);
    expect(next.formation).toBe("4-4-2");
    expect(squadIds(next).sort((a, b) => a - b)).toEqual(squadIds(legal()).sort((a, b) => a - b));
  });

  it("reorders the bench, which is the order auto-subs come on in", () => {
    const next = applySwap(legal("3-4-3"), at(2, 3), at(2, 4));
    expect(benchIds(legal("3-4-3"))).toEqual([2, 6, 7, 12]);
    expect(benchIds(next)).toEqual([2, 7, 6, 12]);
  });

  it("brings a substitute into the XI and sends the starter to the bench", () => {
    const next = applySwap(legal(), at(2, 0), at(3, 4));
    expect(next.formation).toBe("3-5-2");
    expect(xiIds(next)).toEqual([1, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14]);
    // The player who came off is the first defender back on, not the last.
    expect(benchIds(next)).toEqual([2, 3, 7, 15]);
  });

  it("takes the armband off a player who is substituted out", () => {
    const next = applySwap(legal(), at(3, 0), at(3, 4));   // id 8 is the captain
    expect(next.captain).toBeNull();
    expect(next.vice).toBe(9);
  });

  it("moves a substitute into the hole a removed starter left", () => {
    const gap = removeFromSquad(legal(), at(2, 0));
    const next = applySwap(gap, at(2, 4), at(2, 0));
    expect(next.p[2]).toEqual([7, 4, 5, 6, null]);
    expect(xiIds(next)).toHaveLength(11);
    expect(next.formation).toBe("4-4-2");
  });

  it("changes the shape when the substitute filling the hole plays elsewhere", () => {
    const gap = removeFromSquad(legal(), at(2, 0));
    const next = applySwap(gap, at(3, 4), at(2, 0));
    expect(next.formation).toBe("3-5-2");
    expect(xiIds(next)).toEqual([1, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14]);
    expect(benchIds(next)).toEqual([2, 7, 15]);         // one short, and no hole in the XI
  });

  it("returns the squad untouched when the swap is not allowed", () => {
    const sq = legal();
    expect(applySwap(sq, at(2, 0), at(3, 0))).toBe(sq);
  });

  /** Invariant 3: the formation is an output. Whatever the pitch lets a viewer
   *  do, what they are left with is a squad the server will accept. */
  it("leaves a squad the server accepts, whichever swap is taken", () => {
    const { byId } = world();
    for (const formation of ["4-4-2", "3-4-3", "5-3-2"]) {
      const start = legal(formation);
      const slots = POSITIONS.flatMap((k) =>
        Array.from({ length: SQUAD[k] }, (_, i) => at(k, i)),
      );
      for (const a of slots) for (const b of slots) {
        if (!swapFormation(start, a, b)) continue;
        const next = applySwap(start, a, b);
        const xi = xiIds(next);
        const errs = validateEntry(
          {
            nick: "Sam", formation: next.formation, xi, bench: benchIds(next),
            captain: xi[0], vice: xi[1],
          },
          byId, true,
        );
        expect({ formation, a, b, errs }).toEqual({ formation, a, b, errs: [] });
        // Every position still holds its full complement, in starters then subs.
        const sc = startCount(next.formation);
        for (const k of POSITIONS) {
          expect(next.p[k].filter(Boolean)).toHaveLength(SQUAD[k]);
          expect(next.p[k].slice(0, sc[k]).filter(Boolean)).toHaveLength(sc[k]);
        }
      }
    }
  });
});

describe("removeFromSquad — the cross on a shirt", () => {
  it("empties the slot and leaves everyone else where they were", () => {
    const next = removeFromSquad(legal(), at(3, 1));
    expect(next.p[3]).toEqual([8, null, 10, 11, 12]);
    expect(next.formation).toBe("4-4-2");
  });

  it("leaves the hole in the XI rather than promoting a substitute into it", () => {
    const next = removeFromSquad(legal(), at(2, 0));
    expect(benchIds(next)).toContain(7);         // the fifth defender stays a sub
    expect(xiIds(next)).toHaveLength(10);        // the slot waits for a new pick
    expect(squadIds(next)).toHaveLength(14);     // one short, as the panel will say
  });

  it("takes the armband off the player it removes", () => {
    expect(removeFromSquad(legal(), at(3, 0)).captain).toBeNull();
    expect(removeFromSquad(legal(), at(3, 1)).vice).toBeNull();
  });

  it("leaves the rest of the squad alone", () => {
    const next = removeFromSquad(legal(), at(4, 2));
    expect(next.p[1]).toEqual([1, 2]);
    expect(next.p[2]).toEqual([3, 4, 5, 6, 7]);
    expect(next.p[4]).toEqual([13, 14, null]);
  });
});
