import { describe, expect, it } from "vitest";
import type { Squad } from "@/lib/squad";
import { benchIds, newSquad, validateEntry, validateSquad, xiIds } from "@/lib/squad";
import type { EntryInput, Player } from "@/lib/types";
import { index, world } from "./fixtures";

function legal(): Squad {
  return {
    formation: "4-4-2",
    p: { 1: [1, 2], 2: [3, 4, 5, 6, 7], 3: [8, 9, 10, 11, 12], 4: [13, 14, 15] },
    captain: 8,
    vice: 9,
  };
}

/** What the browser would post for a squad it has finished building. */
function asEntry(sq: Squad): EntryInput {
  return {
    nick: "Sam",
    formation: sq.formation,
    xi: xiIds(sq),
    bench: benchIds(sq),
    captain: sq.captain!,
    vice: sq.vice!,
  };
}

const repriced = (byId: Map<number, Player>, cost: number) =>
  index([...byId.values()].map((p) => ({ ...p, cost })));
const oneClub = (byId: Map<number, Player>) =>
  index([...byId.values()].map((p) => ({ ...p, team: 1 })));

describe("validateSquad — live feedback while picking", () => {
  it("says nothing about a finished, legal squad", () => {
    expect(validateSquad(legal(), world().byId, true)).toEqual([]);
  });

  it("counts the slots still empty", () => {
    const w = world();
    expect(validateSquad(newSquad(), w.byId, true)).toContain("Pick all 15 players (0/15 done).");
    const sq = legal();
    sq.p[4][2] = null;
    expect(validateSquad(sq, w.byId, true)).toContain("Pick all 15 players (14/15 done).");
  });

  it("says by how much the squad is over budget", () => {
    const w = world();
    expect(validateSquad(legal(), repriced(w.byId, 100), true)).toContain(
      "You are £50.0m over the budget.",
    );
  });

  it("says nothing about money in a pool with no budget", () => {
    const w = world();
    expect(validateSquad(legal(), repriced(w.byId, 100), false)).toEqual([]);
  });

  it("catches too many from one club", () => {
    const w = world();
    expect(validateSquad(legal(), oneClub(w.byId), true)).toContain(
      "Max 3 players per club — you have too many from one club.",
    );
  });

  it("draws the club line at the fourth player, not the third", () => {
    const w = world();
    // ids 1, 7 and 13 already share team 1; id 4 makes four.
    const fourth = index(
      [...w.byId.values()].map((p) => (p.id === 4 ? { ...p, team: 1 } : p)),
    );
    expect(validateSquad(legal(), w.byId, true)).toEqual([]);
    expect(validateSquad(legal(), fourth, true)).toEqual([
      "Max 3 players per club — you have too many from one club.",
    ]);
  });

  it("insists on a captain and a vice from the starting XI", () => {
    const w = world();
    const noArmband = { ...legal(), captain: null, vice: null };
    const errs = validateSquad(noArmband, w.byId, true);
    expect(errs).toContain("Choose a captain from your starting XI.");
    expect(errs).toContain("Choose a vice-captain from your starting XI.");

    const benched = { ...legal(), captain: 12 }; // fifth midfielder sits in 4-4-2
    expect(validateSquad(benched, w.byId, true)).toContain(
      "Choose a captain from your starting XI.",
    );
  });

  it("rejects the same player wearing both armbands", () => {
    const w = world();
    expect(validateSquad({ ...legal(), vice: 8 }, w.byId, true)).toContain(
      "Captain and vice-captain must be different players.",
    );
  });

  it("follows the armband when the formation change benches the captain", () => {
    const w = world();
    const sq = { ...legal(), captain: 6, vice: 9 }; // fourth defender starts in 4-4-2
    expect(validateSquad(sq, w.byId, true)).toEqual([]);
    sq.formation = "3-5-2";
    expect(validateSquad(sq, w.byId, true)).toContain(
      "Choose a captain from your starting XI.",
    );
  });
});

/**
 * Invariant 1: `validateSquad` is the browser's convenience copy of the rules and
 * `validateEntry` is the decision that counts. They are allowed to word things
 * differently, but never to disagree about whether a squad is legal — a change to
 * one that is not made to the other shows up here.
 */
describe("the browser copy and the server agree on legality", () => {
  const cases: { name: string; sq: Squad; byId: (w: Map<number, Player>) => Map<number, Player>; budgetOn: boolean; legal: boolean }[] = [
    { name: "a finished legal squad", sq: legal(), byId: (b) => b, budgetOn: true, legal: true },
    { name: "the same squad in 3-5-2", sq: { ...legal(), formation: "3-5-2" }, byId: (b) => b, budgetOn: true, legal: true },
    { name: "the same squad in 5-3-2", sq: { ...legal(), formation: "5-3-2" }, byId: (b) => b, budgetOn: true, legal: true },
    { name: "over the budget", sq: legal(), byId: (b) => repriced(b, 100), budgetOn: true, legal: false },
    { name: "over the budget in a pool without one", sq: legal(), byId: (b) => repriced(b, 100), budgetOn: false, legal: true },
    { name: "every player from one club", sq: legal(), byId: oneClub, budgetOn: true, legal: false },
    { name: "exactly four from one club", sq: legal(), byId: (b) => index([...b.values()].map((p) => (p.id === 4 ? { ...p, team: 1 } : p))), budgetOn: true, legal: false },
    { name: "captain on the bench", sq: { ...legal(), captain: 12 }, byId: (b) => b, budgetOn: true, legal: false },
    { name: "vice on the bench", sq: { ...legal(), vice: 12 }, byId: (b) => b, budgetOn: true, legal: false },
    { name: "captain is also the vice", sq: { ...legal(), vice: 8 }, byId: (b) => b, budgetOn: true, legal: false },
  ];

  for (const c of cases) {
    it(`both accept or both reject: ${c.name}`, () => {
      const byId = c.byId(world().byId);
      const browser = validateSquad(c.sq, byId, c.budgetOn);
      const server = validateEntry(asEntry(c.sq), byId, c.budgetOn);
      expect(browser.length === 0).toBe(c.legal);
      expect(server.length === 0).toBe(c.legal);
    });
  }

  it("the server rejects a half-built squad the browser is still nagging about", () => {
    const w = world();
    const sq = legal();
    sq.p[4][2] = null;
    expect(validateSquad(sq, w.byId, true).length).toBeGreaterThan(0);
    expect(validateEntry(asEntry(sq), w.byId, true).length).toBeGreaterThan(0);
  });
});
