import { describe, expect, it } from "vitest";
import {
  applyTransfers, crowdCaptain, crowdTransfers, fundsLeft, movesAllowed, movesLabel,
  orderSquad, readFormation, tallyTransfers, transferChecklist, validateHostSquad,
  validateTransfer,
} from "@/lib/transfers";
import type { HostSquad, Player, TransferRow } from "@/lib/types";
import { index, player, world } from "./fixtures";

/**
 * The shared fifteen, with the spare players moved onto clubs that have room.
 * The fixture spreads its squad over six clubs, which leaves three of them
 * already at the cap — so a plain swap into one of those would fail the club
 * rule and every test about something else would be testing that instead.
 * Teams 4 and 5 hold two apiece, so a signing there is inside the cap and a
 * club test has to say so deliberately.
 */
function squadWorld() {
  const players = world().players.map((p) =>
    p.id === 16 || p.id === 18
      ? { ...p, team: 4 }
      : p.id === 17 || p.id === 19
        ? { ...p, team: 5 }
        : p,
  );
  return { players, byId: index(players) };
}

/** The world's 15, as a host's team: £5.0m a head and £25.0m in the bank. */
function base(over: Partial<HostSquad> = {}): HostSquad {
  const w = world();
  return {
    formation: w.entry.formation,
    xi: [...w.entry.xi],
    bench: [...w.entry.bench],
    captain: w.entry.captain,
    vice: w.entry.vice,
    bank: 250,
    ...over,
  };
}

const OPTS = { moves: 1, budget: true };

function firstError(
  out: number[],
  incoming: number[],
  byId: Map<number, Player>,
  over: Partial<{ squad: HostSquad; moves: number; budget: boolean; captain: number | null }> = {},
): string | undefined {
  const sq = over.squad ?? base();
  return validateTransfer(
    { out, in: incoming, captain: over.captain ?? null },
    sq,
    byId,
    { moves: over.moves ?? OPTS.moves, budget: over.budget ?? OPTS.budget },
  )[0];
}

describe("the transfer allowance", () => {
  it("defaults to one and treats 0 as the whole squad", () => {
    expect(movesAllowed(1)).toBe(1);
    expect(movesAllowed(3)).toBe(3);
    expect(movesAllowed(0)).toBe(15);
    expect(movesAllowed(null)).toBe(1);
    expect(movesAllowed(99)).toBe(15);
  });

  it("says what it allows in words a host can read", () => {
    expect(movesLabel(1)).toMatch(/one/i);
    expect(movesLabel(2)).toMatch(/2/);
    expect(movesLabel(0)).toMatch(/unlimited/i);
  });
});

describe("validateTransfer", () => {
  it("accepts a straight swap in the same position", () => {
    const { byId } = squadWorld();
    expect(validateTransfer({ out: [8], in: [18], captain: 9 }, base(), byId, OPTS)).toEqual([]);
  });

  it("accepts no transfer at all — a vote to keep the team", () => {
    const { byId } = squadWorld();
    expect(validateTransfer({ out: [], in: [], captain: null }, base(), byId, OPTS)).toEqual([]);
  });

  it("refuses an unmatched pair", () => {
    const { byId } = squadWorld();
    expect(firstError([8], [], byId)).toMatch(/one coming in/i);
  });

  it("refuses more transfers than the pool allows", () => {
    const { byId } = squadWorld();
    // Two legal same-position swaps, in a pool that allows one.
    expect(firstError([8, 3], [18, 17], byId)).toMatch(/allows 1/);
    expect(firstError([8, 3], [18, 17], byId, { moves: 2, captain: 9 })).toBeUndefined();
  });

  it("refuses a player who is not in the team", () => {
    const { byId } = squadWorld();
    expect(firstError([18], [8], byId)).toMatch(/in the team/i);
  });

  it("refuses signing a player the team already has", () => {
    const { byId } = squadWorld();
    expect(firstError([8], [9], byId)).toMatch(/already in the team/i);
  });

  it("refuses the same player twice", () => {
    const { byId } = squadWorld();
    expect(firstError([8, 8], [18, 17], byId, { moves: 2 })).toMatch(/twice/i);
  });

  it("refuses a player who is not in the game", () => {
    const { byId } = squadWorld();
    expect(firstError([8], [999], byId)).toMatch(/not in the game/i);
  });

  it("refuses a swap across positions, because the squad would stop being 2/5/5/3", () => {
    const { byId } = squadWorld();
    // 8 is a midfielder, 17 a defender.
    expect(firstError([8], [17], byId)).toMatch(/same position/i);
  });

  it("allows crossing positions when the pairs balance", () => {
    const { byId } = squadWorld();
    // A midfielder for a midfielder and a defender for a defender, in one go.
    expect(firstError([8, 3], [18, 17], byId, { moves: 2, captain: 9 })).toBeUndefined();
  });
});

describe("the money", () => {
  it("counts the bank plus what the sale raises", () => {
    const { byId } = squadWorld();
    // £25.0m in the bank, selling a £5.0m player: £30.0m to spend.
    expect(fundsLeft(base(), [8], [], byId)).toBe(300);
    expect(fundsLeft(base(), [8], [18], byId)).toBe(250);
  });

  it("refuses a signing the bank cannot cover, and allows it a tenth cheaper", () => {
    const { byId } = squadWorld();
    const sq = base({ bank: 0 });

    // Selling a £5.0m midfielder with nothing in the bank buys £5.0m, not more.
    byId.set(18, player(18, 3, { cost: 51, team: 4 }));
    expect(firstError([8], [18], byId, { squad: sq, captain: 9 })).toMatch(/more than there is/i);

    byId.set(18, player(18, 3, { cost: 50, team: 4 }));
    expect(firstError([8], [18], byId, { squad: sq, captain: 9 })).toBeUndefined();
  });

  it("does not look at the money when the pool is run without FPL rules", () => {
    const { byId } = squadWorld();
    byId.set(18, player(18, 3, { cost: 999, team: 4 }));
    expect(firstError([8], [18], byId, { budget: false, captain: 9 })).toBeUndefined();
  });
});

describe("the club cap", () => {
  it("refuses a transfer that would leave four from one club", () => {
    // The fixture's club 3 already holds 3, 9 and 15. A fourth is one too many,
    // even though the player going out frees a place at a different club.
    const { players } = squadWorld();
    const byId = index(players.map((p) => (p.id === 18 ? { ...p, team: 3 } : p)));
    expect(firstError([8], [18], byId, { captain: 9 }))
      .toMatch(/more than 3 players from one club/i);
  });

  it("allows a swap that keeps the count at three", () => {
    const { byId } = squadWorld();
    expect(firstError([8], [18], byId, { captain: 9 })).toBeUndefined();
    // The boundary either side: club 4 goes from two to three, which is legal.
    const after = index(squadWorld().players);
    expect(after.get(18)!.team).toBe(4);
  });
});

describe("the armband", () => {
  it("insists on a new captain when the old one is sold", () => {
    const { byId } = squadWorld();
    // 8 is the captain.
    expect(firstError([8], [18], byId)).toMatch(/sold the captain/i);
    expect(firstError([8], [18], byId, { captain: 9 })).toBeUndefined();
  });

  it("lets the incoming player wear it", () => {
    const { byId } = squadWorld();
    expect(firstError([8], [18], byId, { captain: 18 })).toBeUndefined();
  });

  it("refuses an armband on a player who is not starting", () => {
    const { byId } = squadWorld();
    // 2 is on the bench.
    expect(firstError([3], [17], byId, { captain: 2 })).toMatch(/starting XI/i);
  });

  it("leaves the host's captain alone when nobody touches him", () => {
    const { byId } = squadWorld();
    const checks = transferChecklist({ out: [3], in: [17], captain: null }, base(), byId, OPTS);
    expect(checks.find((c) => c.key === "captain")?.label).toMatch(/stays/i);
  });
});

describe("applyTransfers", () => {
  it("puts the incoming player in the outgoing player's place", () => {
    const sq = base();
    const after = applyTransfers(sq, [8], [18], 9);
    expect(after.xi.indexOf(18)).toBe(sq.xi.indexOf(8));
    expect(after.xi).not.toContain(8);
    expect(after.bench).toEqual(sq.bench);
  });

  it("keeps a bench player on the bench, in the same substitute slot", () => {
    const sq = base();
    const after = applyTransfers(sq, [12], [18]);
    expect(after.bench.indexOf(18)).toBe(sq.bench.indexOf(12));
    expect(after.xi).toEqual(sq.xi);
  });

  it("never hands the armband to a signing on its own", () => {
    const sq = base();
    const after = applyTransfers(sq, [8], [18]);
    expect(after.captain).toBe(0);         // the captain was sold and none was named
    expect(applyTransfers(sq, [8], [18], 18).captain).toBe(18);
  });

  it("drops the vice when he is sold rather than inventing one", () => {
    const sq = base();                     // 9 is the vice
    expect(applyTransfers(sq, [9], [18], 8).vice).toBe(0);
    expect(applyTransfers(sq, [3], [17]).vice).toBe(9);
  });
});

describe("the host's own team", () => {
  it("accepts a legal fifteen", () => {
    const { byId } = squadWorld();
    expect(validateHostSquad(base(), byId)).toEqual([]);
  });

  it("does not apply a budget — an imported team is worth what it is worth", () => {
    const { byId } = squadWorld();
    const rich = index(squadWorld().players.map((p) => ({ ...p, cost: 200 })));
    expect(validateHostSquad(base(), rich)).toEqual([]);
    expect(validateHostSquad(base(), byId)).toEqual([]);
  });

  it("refuses a squad of the wrong shape", () => {
    const { byId } = squadWorld();
    expect(validateHostSquad(base({ xi: base().xi.slice(1) }), byId)[0]).toMatch(/11 players/);
    expect(validateHostSquad(base({ captain: 2 }), byId)[0]).toMatch(/captain must be/i);
    expect(validateHostSquad(base({ bank: -1 }), byId)[0]).toMatch(/bank/i);
  });

  it("reads the formation off the XI rather than trusting the label", () => {
    const { byId } = squadWorld();
    expect(readFormation(base().xi, byId)).toBe("4-4-2");
    const ordered = orderSquad(base({ formation: "5-3-2" }), byId);
    expect(ordered.formation).toBe("4-4-2");
    // Keeper first, so the pitch draws itself in the right order.
    expect(byId.get(ordered.xi[0])!.pos).toBe(1);
  });
});

/* ================= the crowd ================= */

function vote(out: number[], incoming: number[], captain: number | null = null): TransferRow {
  return {
    id: `${Math.random()}`,
    pool_id: "p",
    nick: "v",
    out_ids: out,
    in_ids: incoming,
    captain,
    updated_at: "",
  };
}

describe("the armband after a transfer", () => {
  const rank = (id: number, count: number) => ({
    id, player: player(id, 3), count, pct: count * 10,
  });

  it("gives it to the crowd's pick when they have one", () => {
    expect(crowdCaptain(base({ captain: 8 }), [], [rank(9, 5), rank(10, 2)])).toBe(9);
  });

  it("skips a vote for somebody the transfers have just sold", () => {
    expect(crowdCaptain(base({ captain: 8 }), [9], [rank(9, 5), rank(10, 2)])).toBe(10);
  });

  it("leaves it with the host when nobody voted", () => {
    expect(crowdCaptain(base({ captain: 8 }), [3], [])).toBe(8);
  });

  it("leaves the board without one rather than inventing one", () => {
    // The captain is sold and no vote survives: a C on an empty shirt would be
    // the board making a decision the crowd did not.
    expect(crowdCaptain(base({ captain: 8 }), [8], [])).toBeNull();
  });
});

describe("the crowd's transfers", () => {
  it("counts a swap as a share of the voters, not of the transfers", () => {
    const { byId } = squadWorld();
    const rows = [vote([8], [18], 9), vote([8], [18], 9), vote([3], [17]), vote([], [])];
    const cx = crowdTransfers(rows, base(), byId, 1);

    expect(cx.n).toBe(4);
    expect(cx.hold).toBe(1);
    expect(cx.holdPct).toBe(25);
    expect(cx.swaps[0].key).toBe("8>18");
    expect(cx.swaps[0].count).toBe(2);
    expect(cx.swaps[0].pct).toBe(50);
  });

  it("ranks who the crowd wants out and in, separately from the pairing", () => {
    const { byId } = squadWorld();
    // Everyone agrees 8 goes; they disagree about who replaces him.
    const rows = [vote([8], [18], 9), vote([8], [18], 9), vote([8], [18], 9)];
    const cx = crowdTransfers(rows, base(), byId, 1);
    expect(cx.out[0].id).toBe(8);
    expect(cx.out[0].pct).toBe(100);
    expect(cx.in[0].id).toBe(18);
  });

  it("applies only as many transfers as the pool allows", () => {
    const { byId } = squadWorld();
    const rows = [vote([8, 3], [18, 17], 9), vote([8, 3], [18, 17], 9)];

    const one = crowdTransfers(rows, base(), byId, 1);
    expect(one.applied).toHaveLength(1);
    expect(one.squad.xi).toContain(one.applied[0].in.id);

    const two = crowdTransfers(rows, base(), byId, 2);
    expect(two.applied).toHaveLength(2);
    expect(two.squad.xi).toContain(18);
    expect(two.squad.xi).toContain(17);
  });

  it("never sells or signs the same player twice", () => {
    const { byId } = squadWorld();
    // 8 is wanted out by everyone, for two different midfielders.
    const rows = [vote([8], [18]), vote([8], [18]), vote([8], [12])];
    const cx = crowdTransfers(rows, base({ captain: 9, vice: 10 }), byId, 2);
    expect(cx.applied).toHaveLength(1);
    expect(cx.applied[0].in.id).toBe(18);
  });

  it("reports a shortfall rather than dropping the winner", () => {
    const players = squadWorld().players.map((p) => (p.id === 18 ? { ...p, cost: 900 } : p));
    const byId = index(players);
    const rows = [vote([8], [18], 9)];
    const cx = crowdTransfers(rows, base({ bank: 0 }), byId, 1);

    expect(cx.applied[0].in.id).toBe(18);      // the vote still won
    expect(cx.squad.xi).toContain(18);
    expect(cx.bank).toBeLessThan(0);           // and the board is told the truth
  });

  it("reports a club stack rather than filtering it out", () => {
    const players = squadWorld().players.map((p) =>
      [1, 3, 8, 18].includes(p.id) ? { ...p, team: 1 } : p,
    );
    const byId = index(players);
    const cx = crowdTransfers([vote([9], [18], 10)], base(), byId, 1);
    expect(cx.squad.xi).toContain(18);
    expect(cx.stacked[0][0]).toBe(1);
    expect(cx.stacked[0][1]).toBeGreaterThan(3);
  });

  it("moves the armband to the most-voted captain who is still there", () => {
    const { byId } = squadWorld();
    const rows = [vote([], [], 10), vote([], [], 10), vote([], [], 11)];
    const cx = crowdTransfers(rows, base(), byId, 1);
    expect(cx.captain[0].id).toBe(10);
    expect(cx.squad.captain).toBe(10);
  });

  it("leaves the armband with the host when nobody votes on it", () => {
    const { byId } = squadWorld();
    const cx = crowdTransfers([vote([3], [17])], base(), byId, 1);
    expect(cx.squad.captain).toBe(base().captain);
  });

  it("does not draw a captain on a player the crowd has just sold", () => {
    const { byId } = squadWorld();
    // Everyone sells the captain and nominates nobody the tally can agree on.
    const cx = crowdTransfers([vote([8], [18])], base(), byId, 1);
    expect(cx.squad.captain).toBe(0);
  });

  it("holds up with no votes at all", () => {
    const { byId } = squadWorld();
    const cx = crowdTransfers([], base(), byId, 1);
    expect(cx.n).toBe(0);
    expect(cx.holdPct).toBe(0);
    expect(cx.applied).toEqual([]);
    expect(cx.squad.xi).toEqual(base().xi);
    expect(cx.bank).toBe(250);
  });

  it("is independent of the order the votes arrived in", () => {
    const { byId } = squadWorld();
    const rows = [vote([8], [18], 9), vote([3], [17]), vote([8], [18], 9)];
    const a = crowdTransfers(rows, base(), byId, 1);
    const b = crowdTransfers([...rows].reverse(), base(), byId, 1);
    expect(b.applied.map((s) => s.key)).toEqual(a.applied.map((s) => s.key));
    expect(b.squad.xi).toEqual(a.squad.xi);
  });
});

describe("tallyTransfers", () => {
  it("counts a viewer once per player, not once per vote cast", () => {
    const t = tallyTransfers([
      { out_ids: [8, 3], in_ids: [18, 17], captain: 9 },
      { out_ids: [8], in_ids: [18], captain: 9 },
    ]);
    expect(t.n).toBe(2);
    expect(t.out[8]).toBe(2);
    expect(t.out[3]).toBe(1);
    expect(t.swaps["8>18"]).toBe(2);
    expect(t.captain[9]).toBe(2);
  });

  it("counts an empty vote as a hold", () => {
    const t = tallyTransfers([{ out_ids: [], in_ids: [], captain: null }]);
    expect(t.hold).toBe(1);
  });
});

describe("the browser and the server agree", () => {
  it("the checklist's failures are exactly the errors the route reports", () => {
    const { byId } = squadWorld();
    const cases: [number[], number[], number | null][] = [
      [[], [], null],
      [[8], [18], 9],
      [[8], [18], null],
      [[8], [17], 9],
      [[18], [8], null],
      [[8, 3], [18, 17], 9],
    ];
    for (const [out, incoming, captain] of cases) {
      const input = { out, in: incoming, captain };
      const failed = transferChecklist(input, base(), byId, OPTS)
        .filter((c) => !c.ok)
        .map((c) => c.label);
      expect(validateTransfer(input, base(), byId, OPTS)).toEqual(failed);
    }
  });
});
