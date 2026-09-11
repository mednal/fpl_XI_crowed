export type PosId = 1 | 2 | 3 | 4;

export type Team = { id: number; sh: string; name: string };

export type Player = {
  id: number;
  n: string;        // display name
  pos: PosId;       // 1 GKP, 2 DEF, 3 MID, 4 FWD
  team: number;
  cost: number;     // FPL tenths: 60 = £6.0m
  pts: number;      // total points
  form: number;
  sel: number;      // selected-by percent
  st: string;       // a = available, d = doubt, i = injured, s = suspended
  news: string;
};

export type Gameweek = {
  id: number;
  name: string;
  deadline: string;   // ISO
  finished: boolean;  // scores settled, so auto-subs have been applied
};

/** Points and minutes a player recorded in one gameweek. */
export type LiveStat = { pts: number; min: number };

export type Bootstrap = {
  gw: number;
  gwName: string;
  deadline: string;   // ISO
  teams: Team[];
  players: Player[];
  events: Gameweek[];
  fetchedAt: string;
};

/** Which question a pool asks. `crowd` is the original poll — everyone builds
 *  an XI. `transfer` puts the host's own team up and asks what to change. */
export type PoolKind = "crowd" | "transfer";

/**
 * The host's team in a transfer pool: the fifteen the crowd is voting on
 * changes to, and the money sitting beside it.
 *
 * Sale prices are not in it, because the FPL API will not give them without the
 * manager's own login. A player is valued at today's price throughout, which is
 * right to within a tenth or two and is said plainly on screen rather than
 * quietly assumed.
 */
export type HostSquad = {
  formation: string;
  xi: number[];         // 11, keeper first then by position
  bench: number[];      // 4, in the order they would come on
  captain: number;
  vice: number;
  /** Money not in the team, in FPL tenths. */
  bank: number;
  /** Where it came from, when the host imported it rather than building it. */
  entry?: number | null;
  entryName?: string | null;
  manager?: string | null;
};

export type Pool = {
  id: string;
  name: string;
  host: string | null;
  gw: number;
  budget: boolean;
  /** What the crowd is being asked. Older rows predate the column and are
   *  'crowd', which is what the default on it says. */
  kind: PoolKind;
  /** A transfer pool's base team. Null until the host has set one — the pool
   *  exists but has nothing to transfer from yet. */
  squad: HostSquad | null;
  /** How many transfers each viewer may propose. 0 is unlimited. */
  moves: number;
  /** The shape the crowd XI is drawn in, if the host fixed one. Null lets the
   *  most-picked players decide it, which is the default. */
  formation: string | null;
  /** When voting closes on its own: the official FPL deadline unless the host
   *  chose an earlier one. */
  deadline: string | null;
  /** Set the moment the host closed the pool by hand, ahead of that deadline.
   *  Null means they have not — or have reopened it. */
  closed_at: string | null;
  created_at: string;
};

export type Entry = {
  id: string;
  pool_id: string;
  nick: string;
  formation: string;
  xi: number[];
  bench: number[];
  captain: number;
  vice: number;
  updated_at: string;
};

/** What a viewer sends when submitting. Identity is not in here: it comes from
 *  the signed cookie the server issued, so it cannot be spoofed. */
export type EntryInput = {
  nick: string;
  formation: string;
  xi: number[];
  bench: number[];
  captain: number;
  vice: number;
};

export type Ranked = {
  id: number;
  player: Player;
  count: number;
  pct: number;
};

export type CrowdXI = {
  rows: Record<PosId, Ranked[]>;
  /** Slots per position the board should draw. Same as the row lengths when the
   *  crowd decides the shape; the host's shape when they fixed one, which can be
   *  wider than the rows while the votes are still thin. */
  shape: Record<PosId, number>;
  formation: string;
  captain: Ranked | null;
  vice: Ranked | null;
  cost: number;
  /** How many of the XI each club supplied, by team id. A fact about the vote,
   *  not a rule: the crowd XI is a hall-of-fame XI, so no club cap applies to
   *  it. The board decides what counts as worth pointing out. */
  clubs: Record<number, number>;
};

/** One viewer's proposed transfers. `out[i]` is sold to sign `in[i]`, and the
 *  two are always the same position — see the note in `transfers.ts`. */
export type TransferInput = {
  nick: string;
  out: number[];
  in: number[];
  /** A new captain, or null to leave the host's armband where it is. */
  captain: number | null;
};

export type TransferRow = {
  id: string;
  pool_id: string;
  nick: string;
  out_ids: number[];
  in_ids: number[];
  captain: number | null;
  updated_at: string;
};
