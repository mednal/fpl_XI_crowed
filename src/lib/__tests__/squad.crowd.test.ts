import { describe, expect, it } from "vitest";
import type { Tally } from "@/lib/squad";
import { crowdXI, ranked, tally } from "@/lib/squad";
import type { Player, PosId } from "@/lib/types";
import { index, player, world } from "./fixtures";

type Spec = { pos: PosId; votes: number; sel?: number; n?: string; team?: number };

/** Builds a byId map and a tally straight from vote counts, so a test can say
 *  exactly how popular each player is without inventing entries to get there. */
function votes(specs: Spec[]): { byId: Map<number, Player>; t: Tally } {
  const players = specs.map((s, i) =>
    player(i + 1, s.pos, {
      sel: s.sel ?? 0,
      n: s.n ?? `P${i + 1}`,
      team: s.team ?? (i % 8) + 1,
    }),
  );
  const xi: Record<number, number> = {};
  specs.forEach((s, i) => {
    if (s.votes) xi[i + 1] = s.votes;
  });
  const n = Math.max(0, ...specs.map((s) => s.votes));
  return { byId: index(players), t: { xi, squad: xi, captain: {}, vice: {}, n } };
}

const gkps: Spec[] = [{ pos: 1, votes: 90 }, { pos: 1, votes: 10 }];
const many = (pos: PosId, counts: number[]): Spec[] => counts.map((v) => ({ pos, votes: v }));
const all = (cx: ReturnType<typeof crowdXI>) =>
  ([1, 2, 3, 4] as PosId[]).flatMap((k) => cx.rows[k]);

describe("crowdXI — the formation is an output", () => {
  it("comes out 5-2-3 when the defenders and forwards are the popular ones", () => {
    const { byId, t } = votes([
      ...gkps,
      ...many(2, [100, 99, 98, 97, 96]),
      ...many(3, [90, 89, 88, 87, 86]),
      ...many(4, [95, 94, 93]),
    ]);
    expect(crowdXI(t, byId).formation).toBe("5-2-3");
  });

  it("comes out 3-5-2 when the midfielders are", () => {
    const { byId, t } = votes([
      ...gkps,
      ...many(2, [50, 49, 48, 10, 9]),
      ...many(3, [90, 89, 88, 87, 86]),
      ...many(4, [60, 59, 58]),
    ]);
    expect(crowdXI(t, byId).formation).toBe("3-5-2");
  });

  it("always names a shape the game allows, and always picks eleven", () => {
    for (const def of [[100, 99, 98, 97, 96], [10, 9, 8, 7, 6]]) {
      const { byId, t } = votes([
        ...gkps,
        ...many(2, def),
        ...many(3, [50, 49, 48, 47, 46]),
        ...many(4, [55, 54, 53]),
      ]);
      const cx = crowdXI(t, byId);
      expect(all(cx).length).toBe(11);
      expect(cx.rows[1].length).toBe(1);
      const [d, m, f] = cx.formation.split("-").map(Number);
      expect(d + m + f).toBe(10);
      expect(d).toBeGreaterThanOrEqual(3);
      expect(m).toBeGreaterThanOrEqual(2);
      expect(f).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("crowdXI — position caps", () => {
  it("stops at 5 defenders however popular the defenders are", () => {
    const { byId, t } = votes([
      ...gkps,
      ...many(2, [100, 99, 98, 97, 96, 95, 94, 93]),
      ...many(3, [10, 9, 8, 7, 6]),
      ...many(4, [5, 4, 3]),
    ]);
    const cx = crowdXI(t, byId);
    expect(cx.rows[2].length).toBe(5);
    expect(cx.formation).toBe("5-4-1");
  });

  it("stops at 5 midfielders", () => {
    const { byId, t } = votes([
      ...gkps,
      ...many(2, [1, 1, 1, 1, 1]),
      ...many(3, [99, 98, 97, 96, 95, 94, 93]),
      ...many(4, [1, 1, 1]),
    ]);
    expect(crowdXI(t, byId).rows[3].length).toBe(5);
  });

  it("stops at 3 forwards", () => {
    const { byId, t } = votes([
      ...gkps,
      ...many(2, [1, 1, 1, 1, 1]),
      ...many(3, [1, 1, 1, 1, 1]),
      ...many(4, [99, 98, 97, 96, 95]),
    ]);
    expect(crowdXI(t, byId).rows[4].length).toBe(3);
  });

  it("never starts two goalkeepers", () => {
    const { byId, t } = votes([
      { pos: 1, votes: 99 },
      { pos: 1, votes: 98 },
      { pos: 1, votes: 97 },
      ...many(2, [50, 49, 48, 47, 46]),
      ...many(3, [50, 49, 48, 47, 46]),
      ...many(4, [50, 49, 48]),
    ]);
    expect(crowdXI(t, byId).rows[1].length).toBe(1);
  });

  it("picks nobody twice", () => {
    const { byId, t } = votes([
      ...gkps,
      ...many(2, [9, 8, 7, 6, 5]),
      ...many(3, [9, 8, 7, 6, 5]),
      ...many(4, [9, 8, 7]),
    ]);
    const ids = all(crowdXI(t, byId)).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("crowdXI — ties break the same way every time", () => {
  it("prefers the more-selected player when the votes are level", () => {
    const { byId, t } = votes([
      ...gkps,
      { pos: 2, votes: 5, sel: 1, n: "Aaron" },
      { pos: 2, votes: 5, sel: 40, n: "Zed" },
      { pos: 2, votes: 5, sel: 20, n: "Mo" },
      ...many(3, [4, 4]),
      ...many(4, [3]),
    ]);
    expect(crowdXI(t, byId).rows[2].map((r) => r.player.n)).toEqual(["Zed", "Mo", "Aaron"]);
  });

  it("falls back to the name when votes and ownership are level", () => {
    const players = [
      player(1, 2, { n: "Carter", sel: 10 }),
      player(2, 2, { n: "Adams", sel: 10 }),
      player(3, 2, { n: "Baker", sel: 10 }),
    ];
    const r = ranked({ 1: 5, 2: 5, 3: 5 }, 5, index(players), 2);
    expect(r.map((x) => x.player.n)).toEqual(["Adams", "Baker", "Carter"]);
  });

  it("fills the last four slots defenders first when the counts are level", () => {
    const { byId, t } = votes([
      ...gkps,
      ...many(2, [1, 1, 1, 1, 1]),
      ...many(3, [1, 1, 1, 1, 1]),
      ...many(4, [1, 1, 1]),
    ]);
    expect(crowdXI(t, byId).formation).toBe("5-4-1");
  });

  it("gives identical output on repeated calls", () => {
    const { byId, t } = votes([
      ...gkps,
      ...many(2, [7, 7, 7, 7, 7]),
      ...many(3, [7, 7, 7, 7, 7]),
      ...many(4, [7, 7, 7]),
    ]);
    expect(JSON.stringify(crowdXI(t, byId))).toBe(JSON.stringify(crowdXI(t, byId)));
  });

  it("does not depend on the order the votes arrived in", () => {
    const entries = [
      { xi: [1, 3, 4, 5, 6, 8, 9, 10, 11, 13, 14], bench: [2, 7, 12, 15], captain: 8, vice: 9 },
      { xi: [1, 3, 4, 5, 7, 8, 9, 10, 12, 13, 15], bench: [2, 6, 11, 14], captain: 9, vice: 8 },
      { xi: [2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15], bench: [1, 5, 9, 13], captain: 8, vice: 10 },
    ];
    const w = world();
    const a = crowdXI(tally(entries), w.byId);
    const b = crowdXI(tally([...entries].reverse()), w.byId);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe("crowdXI — the empty and the near-empty pool", () => {
  it("survives no entries at all", () => {
    const w = world();
    const cx = crowdXI(tally([]), w.byId);
    expect(cx.formation).toBe("0-0-0");
    expect(cx.captain).toBeNull();
    expect(cx.vice).toBeNull();
    expect(cx.cost).toBe(0);
    expect(cx.clubBreaches).toEqual([]);
    expect(all(cx)).toEqual([]);
  });

  it("mirrors the single entry when only one person has voted", () => {
    const w = world();
    const cx = crowdXI(tally([w.entry]), w.byId);
    expect(all(cx).map((r) => r.id).sort((a, b) => a - b)).toEqual(
      [...w.entry.xi].sort((a, b) => a - b),
    );
    expect(cx.formation).toBe("4-4-2");
    expect(cx.captain?.id).toBe(8);
    expect(cx.vice?.id).toBe(9);
    expect(cx.rows[2][0].pct).toBe(100);
  });

  it("takes the percentage against the number of entries, not the number of votes", () => {
    const w = world();
    const cx = crowdXI(
      tally([
        w.entry,
        { ...w.entry, xi: [1, 3, 4, 5, 6, 8, 9, 10, 11, 13, 15], bench: [2, 7, 12, 14] },
      ]),
      w.byId,
    );
    expect(all(cx).find((r) => r.id === 3)?.pct).toBe(100);
    expect(all(cx).find((r) => r.id === 13)?.pct).toBe(100);
    const split = all(cx).find((r) => r.id === 14 || r.id === 15);
    expect(split?.pct).toBe(50);
  });
});

describe("crowdXI — what it reports about the winning XI", () => {
  it("sums the cost of the eleven it picked", () => {
    const { byId, t } = votes([
      ...gkps,
      ...many(2, [9, 8, 7, 6, 5]),
      ...many(3, [9, 8, 7, 6, 5]),
      ...many(4, [9, 8, 7]),
    ]);
    expect(crowdXI(t, byId).cost).toBe(11 * 50);
  });

  it("flags a club the crowd over-picked — the XI is a vote, not a legal team", () => {
    const { byId, t } = votes([
      ...gkps.map((g) => ({ ...g, team: 1 })),
      ...many(2, [100, 99, 98, 97, 96]).map((s) => ({ ...s, team: 1 })),
      ...many(3, [90, 89, 88, 87, 86]).map((s) => ({ ...s, team: 2 })),
      ...many(4, [80, 79, 78]).map((s) => ({ ...s, team: 2 })),
    ]);
    expect(crowdXI(t, byId).clubBreaches).toContain("1");
  });

  it("draws the club line at the fourth player in the XI, not the third", () => {
    // A known 5-2-3: keeper 1, defenders 3-7, midfielders 8-9, forwards 13-15.
    const shape = (thirdDefenderTeam: number): Spec[] => [
      { pos: 1, votes: 99, team: 1 }, { pos: 1, votes: 1, team: 10 },
      { pos: 2, votes: 100, team: 1 }, { pos: 2, votes: 99, team: 1 },
      { pos: 2, votes: 98, team: thirdDefenderTeam },
      { pos: 2, votes: 97, team: 3 }, { pos: 2, votes: 96, team: 4 },
      { pos: 3, votes: 90, team: 5 }, { pos: 3, votes: 89, team: 6 },
      { pos: 3, votes: 88, team: 5 }, { pos: 3, votes: 87, team: 6 }, { pos: 3, votes: 86, team: 5 },
      { pos: 4, votes: 95, team: 7 }, { pos: 4, votes: 94, team: 8 }, { pos: 4, votes: 93, team: 9 },
    ];
    const three = votes(shape(2));
    expect(crowdXI(three.t, three.byId).clubBreaches).toEqual([]);

    const four = votes(shape(1));
    expect(crowdXI(four.t, four.byId).clubBreaches).toEqual(["1"]);
  });

  it("leaves clubBreaches empty when nothing is over-picked", () => {
    const { byId, t } = votes([
      ...gkps,
      ...many(2, [9, 8, 7, 6, 5]),
      ...many(3, [9, 8, 7, 6, 5]),
      ...many(4, [9, 8, 7]),
    ]);
    expect(crowdXI(t, byId).clubBreaches).toEqual([]);
  });

  it("names the most-captained player, and the vice separately", () => {
    const w = world();
    const cx = crowdXI(
      tally([
        { ...w.entry, captain: 8, vice: 9 },
        { ...w.entry, captain: 8, vice: 10 },
        { ...w.entry, captain: 9, vice: 10 },
      ]),
      w.byId,
    );
    expect(cx.captain?.id).toBe(8);
    expect(cx.captain?.count).toBe(2);
    expect(cx.vice?.id).toBe(10);
  });
});

describe("tally", () => {
  it("counts XI picks, squad picks, captains and vices apart", () => {
    const w = world();
    const t = tally([w.entry, { ...w.entry, captain: 9, vice: 8 }]);
    expect(t.n).toBe(2);
    expect(t.xi[3]).toBe(2);
    expect(t.xi[7]).toBeUndefined(); // benched, so not an XI vote
    expect(t.squad[7]).toBe(2);
    expect(t.captain[8]).toBe(1);
    expect(t.vice[8]).toBe(1);
  });

  it("copes with an entry missing its xi or bench", () => {
    const t = tally([
      { xi: null as never, bench: null as never, captain: 0 as never, vice: 0 as never },
    ]);
    expect(t.n).toBe(1);
    expect(t.xi).toEqual({});
  });
});

describe("ranked", () => {
  it("drops ids that are no longer in the game", () => {
    const w = world();
    expect(ranked({ 3: 5, 999: 99 }, 5, w.byId).map((r) => r.id)).toEqual([3]);
  });

  it("returns 0% rather than dividing by no entries", () => {
    const w = world();
    expect(ranked({ 3: 0 }, 0, w.byId)[0].pct).toBe(0);
  });
});
