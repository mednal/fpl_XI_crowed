import type { EntryInput, Player, PosId } from "@/lib/types";

/** A player with sane defaults; override only what a test actually cares about. */
export function player(id: number, pos: PosId, over: Partial<Player> = {}): Player {
  return {
    id,
    n: `P${id}`,
    pos,
    team: 1,
    cost: 50,
    pts: 0,
    form: 0,
    sel: 0,
    st: "a",
    news: "",
    ...over,
  };
}

export function index(players: Player[]): Map<number, Player> {
  return new Map(players.map((p) => [p.id, p]));
}

export type World = {
  players: Player[];
  byId: Map<number, Player>;
  entry: EntryInput;
  /** Players of each position that are in `byId` but not in `entry`. */
  spare: Record<PosId, Player[]>;
};

/**
 * A legal 15 at £5.0m a head (£75.0m of the £100.0m budget), spread over six
 * clubs so no club rule is anywhere near breached, plus a spare player in every
 * position for swap tests. Ids: 1-2 GKP, 3-7 DEF, 8-12 MID, 13-15 FWD,
 * 16-19 spare.
 */
export function world(): World {
  const layout: PosId[] = [1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4];
  const players = layout.map((pos, i) =>
    player(i + 1, pos, { team: (i % 6) + 1, cost: 50 }),
  );
  const spareList = [player(16, 1), player(17, 2), player(18, 3), player(19, 4)].map(
    (p, i) => ({ ...p, team: (i % 6) + 1 }),
  );
  const all = [...players, ...spareList];

  return {
    players: all,
    byId: index(all),
    entry: {
      nick: "Sam",
      formation: "4-4-2",
      xi: [1, 3, 4, 5, 6, 8, 9, 10, 11, 13, 14],
      bench: [2, 7, 12, 15],
      captain: 8,
      vice: 9,
    },
    spare: { 1: [spareList[0]], 2: [spareList[1]], 3: [spareList[2]], 4: [spareList[3]] },
  };
}
