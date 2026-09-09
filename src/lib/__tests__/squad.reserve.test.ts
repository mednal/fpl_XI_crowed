import { describe, expect, it } from "vitest";
import type { Squad } from "@/lib/squad";
import {
  BUDGET,
  benchIds,
  cheapestPerPos,
  clubCount,
  money,
  newSquad,
  pctText,
  reserve,
  spent,
  squadIds,
  startCount,
  xiIds,
} from "@/lib/squad";
import type { PosId } from "@/lib/types";
import { index, player, world } from "./fixtures";

/** Cheapest available: 40 GKP, 45 DEF, 50 MID, 55 FWD, with dearer options above. */
const market = [
  player(101, 1, { cost: 40 }), player(102, 1, { cost: 60 }),
  player(103, 2, { cost: 45 }), player(104, 2, { cost: 90 }),
  player(105, 3, { cost: 50 }), player(106, 3, { cost: 130 }),
  player(107, 4, { cost: 55 }), player(108, 4, { cost: 140 }),
];
const min = cheapestPerPos(market);

/** A full squad from the fixture world, then emptied slot by slot as tests need. */
function filled(): Squad {
  return {
    formation: "4-4-2",
    p: { 1: [1, 2], 2: [3, 4, 5, 6, 7], 3: [8, 9, 10, 11, 12], 4: [13, 14, 15] },
    captain: 8,
    vice: 9,
  };
}

describe("cheapestPerPos", () => {
  it("finds the floor price in each position", () => {
    expect(min).toEqual({ 1: 40, 2: 45, 3: 50, 4: 55 });
  });

  it("returns its sentinel for a position nobody plays", () => {
    expect(cheapestPerPos([player(1, 3, { cost: 50 })])[4]).toBe(999);
  });
});

describe("reserve — money that must be held back", () => {
  it("prices a whole empty squad at the cheapest of everything", () => {
    expect(reserve(newSquad(), min)).toBe(2 * 40 + 5 * 45 + 5 * 50 + 3 * 55);
  });

  it("falls as slots are filled, one position at a time", () => {
    const sq = newSquad();
    const empty = reserve(sq, min);
    sq.p[3][0] = 105;
    expect(reserve(sq, min)).toBe(empty - 50);
    sq.p[4][0] = 107;
    expect(reserve(sq, min)).toBe(empty - 50 - 55);
  });

  it("is zero once every slot is taken", () => {
    expect(reserve(filled(), min)).toBe(0);
  });

  it("ignores a slot the viewer is about to fill, via ignorePos", () => {
    const sq = newSquad();
    expect(reserve(sq, min, 4)).toBe(reserve(sq, min) - 55);
    expect(reserve(sq, min, 1)).toBe(reserve(sq, min) - 40);
  });

  it("does not go negative when ignorePos names a position already full", () => {
    const sq = newSquad();
    sq.p[1] = [1, 2];
    expect(reserve(sq, min, 1)).toBe(5 * 45 + 5 * 50 + 3 * 55);
  });

  it("holds back nothing for a full squad even with ignorePos set", () => {
    expect(reserve(filled(), min, 2)).toBe(0);
  });

  it("leaves enough to finish the squad: bank minus reserve is what is really spendable", () => {
    const w = world();
    const sq = newSquad();
    sq.p[3][0] = 8; // one £5.0m midfielder in
    const bank = BUDGET - spent(sq, w.byId);
    const spendable = bank - reserve(sq, min, 3);
    // The next pick is a midfielder, so the ceiling on it is the bank less the
    // floor price of the other three midfielders and every other empty slot.
    expect(bank).toBe(950);
    expect(spendable).toBe(950 - (2 * 40 + 5 * 45 + 3 * 50 + 3 * 55));
    expect(spendable).toBeGreaterThan(0);
  });

  it("goes over the budget for a squad that cannot be finished", () => {
    // A viewer who blew the lot on one player: the reserve alone exceeds the bank.
    const dear = index([...market, player(200, 3, { cost: 940 })]);
    const sq = newSquad();
    sq.p[3][0] = 200;
    expect(BUDGET - spent(sq, dear)).toBeLessThan(reserve(sq, min, 3));
  });
});

describe("spent and clubCount", () => {
  it("adds up only the slots that are filled", () => {
    const w = world();
    const sq = newSquad();
    expect(spent(sq, w.byId)).toBe(0);
    sq.p[2][0] = 3;
    expect(spent(sq, w.byId)).toBe(50);
    expect(spent(filled(), w.byId)).toBe(15 * 50);
  });

  it("skips a player who has left the game rather than counting NaN", () => {
    const w = world();
    const sq = newSquad();
    sq.p[2][0] = 999;
    expect(spent(sq, w.byId)).toBe(0);
  });

  it("counts a club across the whole squad, bench included", () => {
    const w = world();
    const c = clubCount(filled(), w.byId);
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(15);
    expect(Math.max(...Object.values(c))).toBe(3);
  });
});

describe("slot helpers", () => {
  it("startCount follows the formation, with one keeper always", () => {
    expect(startCount("3-5-2")).toEqual({ 1: 1, 2: 3, 3: 5, 4: 2 });
    expect(startCount("5-4-1")).toEqual({ 1: 1, 2: 5, 3: 4, 4: 1 });
  });

  it("startCount falls back to 4-4-2 for a formation it does not know", () => {
    expect(startCount("9-1-0")).toEqual({ 1: 1, 2: 4, 3: 4, 4: 2 });
  });

  it("splits a squad into an XI of 11 and a bench of 4", () => {
    const sq = filled();
    expect(xiIds(sq).length).toBe(11);
    expect(benchIds(sq).length).toBe(4);
    expect(squadIds(sq).length).toBe(15);
    expect([...xiIds(sq), ...benchIds(sq)].sort((a, b) => a - b)).toEqual(
      squadIds(sq).sort((a, b) => a - b),
    );
  });

  it("moves players between XI and bench when the formation changes", () => {
    const sq = filled();
    expect(xiIds(sq)).toContain(6); // fourth defender starts in 4-4-2
    sq.formation = "3-5-2";
    expect(benchIds(sq)).toContain(6);
    expect(xiIds(sq)).toContain(12); // fifth midfielder starts instead
    expect(xiIds(sq).length).toBe(11);
  });

  it("skips empty slots rather than returning nulls", () => {
    const sq = newSquad();
    sq.p[2][0] = 3;
    expect(squadIds(sq)).toEqual([3]);
    expect(xiIds(sq)).toEqual([3]);
    expect(benchIds(sq)).toEqual([]);
  });
});

describe("display helpers", () => {
  it("money reads FPL tenths as pounds", () => {
    expect(money(1000)).toBe("£100.0m");
    expect(money(45)).toBe("£4.5m");
    expect(money(0)).toBe("£0.0m");
    expect(money(-5)).toBe("£-0.5m");
  });

  it("pctText keeps one decimal, but not on a clean 100%", () => {
    expect(pctText(12.34)).toBe("12.3%");
    expect(pctText(100)).toBe("100%");
    expect(pctText(0)).toBe("0.0%");
  });

  it("newSquad starts with the right number of empty slots", () => {
    const sq = newSquad();
    const counts = ([1, 2, 3, 4] as PosId[]).map((k) => sq.p[k].length);
    expect(counts).toEqual([2, 5, 5, 3]);
    expect(squadIds(sq)).toEqual([]);
  });
});
