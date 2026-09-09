import { describe, expect, it } from "vitest";
import { BUDGET, validateEntry } from "@/lib/squad";
import type { EntryInput } from "@/lib/types";
import { index, player, world } from "./fixtures";

/** The server's verdict on `entry`, with `over` applied on top of the legal one. */
function check(over: Partial<EntryInput> = {}, budgetOn = true): string[] {
  const w = world();
  return validateEntry({ ...w.entry, ...over }, w.byId, budgetOn);
}

describe("validateEntry — a legal squad", () => {
  it("passes with no errors", () => {
    expect(check()).toEqual([]);
  });

  it("passes in every formation, given an XI that fits it", () => {
    const w = world();
    // 3-5-2: three defenders and two forwards start, the rest sit.
    const errs = validateEntry(
      { ...w.entry, formation: "3-5-2", xi: [1, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14], bench: [2, 6, 7, 15] },
      w.byId,
      true,
    );
    expect(errs).toEqual([]);
  });
});

describe("validateEntry — shape of the submission", () => {
  it("rejects an XI that is not 11", () => {
    expect(check({ xi: [1, 3, 4, 5, 6, 8, 9, 10, 11, 13] })).toContain(
      "A starting XI must have 11 players.",
    );
  });

  it("rejects a bench that is not 4", () => {
    expect(check({ bench: [2, 7, 12] })).toContain("A bench must have 4 players.");
  });

  it("rejects the same player twice", () => {
    expect(check({ bench: [2, 7, 12, 13] })).toContain("The same player appears twice.");
  });

  it("rejects a player who is not in the game", () => {
    expect(check({ bench: [2, 7, 12, 999] })).toContain(
      "That squad contains a player who is not in the game.",
    );
  });

  it("stops at the shape errors rather than reading missing players", () => {
    // Every later check dereferences byId.get(id)!, so this must return early.
    const errs = check({ xi: [999], bench: [] });
    expect(errs).toEqual([
      "A starting XI must have 11 players.",
      "A bench must have 4 players.",
      "That squad contains a player who is not in the game.",
    ]);
  });
});

describe("validateEntry — squad composition", () => {
  it("rejects a squad without exactly 2/5/5/3", () => {
    // Bench keeper swapped for a sixth defender.
    const errs = check({ bench: [17, 7, 12, 15] });
    expect(errs).toContain("A squad needs exactly 2 goalkeepers.");
    expect(errs).toContain("A squad needs exactly 5 defenders.");
  });

  it("rejects more than 3 players from one club", () => {
    const w = world();
    const oneClub = index(w.players.map((p) => ({ ...p, team: 1 })));
    expect(validateEntry(w.entry, oneClub, true)).toContain(
      "Max 3 players from any one club.",
    );
  });

  it("allows exactly 3 from a club, and rejects the fourth", () => {
    const w = world();
    // ids 1, 7, 13 sit on team 1 already; teams elsewhere stay under the cap.
    expect(validateEntry(w.entry, w.byId, true)).toEqual([]);

    const fourth = index(w.players.map((p) => (p.id === 4 ? { ...p, team: 1 } : p)));
    expect(validateEntry(w.entry, fourth, true)).toEqual([
      "Max 3 players from any one club.",
    ]);
  });

  it("counts a bench player towards their club's three", () => {
    const w = world();
    // id 12 is on the bench; putting it on team 1 still makes four.
    const fourth = index(w.players.map((p) => (p.id === 12 ? { ...p, team: 1 } : p)));
    expect(validateEntry(w.entry, fourth, true)).toContain(
      "Max 3 players from any one club.",
    );
  });
});

describe("validateEntry — the starting XI", () => {
  it("rejects an XI with no goalkeeper", () => {
    expect(
      check({ xi: [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14], bench: [1, 2, 12, 15] }),
    ).toContain("A starting XI needs exactly one goalkeeper.");
  });

  it("rejects an XI with two goalkeepers", () => {
    expect(
      check({ xi: [1, 2, 3, 4, 5, 8, 9, 10, 11, 13, 14], bench: [6, 7, 12, 15] }),
    ).toContain("A starting XI needs exactly one goalkeeper.");
  });

  it("rejects fewer than 3 defenders", () => {
    expect(
      check({ xi: [1, 3, 4, 8, 9, 10, 11, 12, 13, 14, 15], bench: [2, 5, 6, 7] }),
    ).toContain("A starting XI needs 3 to 5 defenders.");
  });

  it("rejects more than 5 defenders", () => {
    // Only reachable from an already-illegal 15, since a legal squad holds five.
    const errs = check({
      xi: [1, 3, 4, 5, 6, 7, 17, 8, 9, 13, 14],
      bench: [10, 11, 12, 15],
    });
    expect(errs).toContain("A starting XI needs 3 to 5 defenders.");
  });

  it("rejects no forward", () => {
    expect(
      check({ xi: [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], bench: [2, 13, 14, 15] }),
    ).toContain("A starting XI needs 1 to 3 forwards.");
  });

  it("accepts the extremes of a legal shape (5 at the back, 1 up top)", () => {
    expect(
      check({
        formation: "5-4-1",
        xi: [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13],
        bench: [2, 12, 14, 15],
      }),
    ).toEqual([]);
  });
});

describe("validateEntry — budget", () => {
  it("rejects a squad over the budget when the pool has one", () => {
    const w = world();
    const dear = index(w.players.map((p) => ({ ...p, cost: 100 })));
    expect(validateEntry(w.entry, dear, true)).toContain(
      "That squad costs £150.0m, over the £100.0m budget.",
    );
  });

  it("allows the same squad when the pool has no budget", () => {
    const w = world();
    const dear = index(w.players.map((p) => ({ ...p, cost: 100 })));
    expect(validateEntry(w.entry, dear, false)).toEqual([]);
  });

  it("allows a squad landing exactly on the budget", () => {
    const w = world();
    const exact = index(
      w.players.map((p) => ({ ...p, cost: p.id === 1 ? BUDGET - 14 * 50 : 50 })),
    );
    expect(validateEntry(w.entry, exact, true)).toEqual([]);
  });
});

describe("validateEntry — armband and formation", () => {
  it("rejects a captain on the bench", () => {
    expect(check({ captain: 2 })).toContain("The captain must be in the starting XI.");
  });

  it("rejects a vice-captain on the bench", () => {
    expect(check({ vice: 7 })).toContain("The vice-captain must be in the starting XI.");
  });

  it("rejects the same player as captain and vice", () => {
    expect(check({ vice: 8 })).toContain(
      "Captain and vice-captain must be different players.",
    );
  });

  it("rejects a formation that is not a real one", () => {
    expect(check({ formation: "6-3-1" })).toContain("That is not a valid formation.");
  });
});

describe("validateEntry — trusts nothing about the client", () => {
  it("prices the squad from the server's map, not from anything sent", () => {
    const w = world();
    // A client claiming these are cheap changes nothing: only byId is consulted.
    const dear = index(w.players.map((p) => ({ ...p, cost: 200 })));
    expect(validateEntry(w.entry, dear, true).length).toBe(1);
  });

  it("reports every broken rule at once, not just the first", () => {
    const w = world();
    const oneClub = index(w.players.map((p) => ({ ...p, team: 1, cost: 100 })));
    const errs = validateEntry({ ...w.entry, formation: "6-3-1", vice: 8 }, oneClub, true);
    expect(errs.length).toBeGreaterThanOrEqual(4);
  });
});

describe("validateEntry — tolerates a missing xi/bench", () => {
  it("does not throw when the arrays are absent", () => {
    const w = world();
    const errs = validateEntry(
      { ...w.entry, xi: undefined as never, bench: undefined as never },
      w.byId,
      true,
    );
    expect(errs).toContain("A starting XI must have 11 players.");
  });
});

describe("fixtures", () => {
  it("builds a squad no rule complains about", () => {
    const w = world();
    expect(w.players.filter((p) => p.id <= 15).length).toBe(15);
    expect(player(1, 2).cost).toBe(50);
  });
});
