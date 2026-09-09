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

export type Bootstrap = {
  gw: number;
  gwName: string;
  deadline: string;   // ISO
  teams: Team[];
  players: Player[];
  fetchedAt: string;
};

export type Pool = {
  id: string;
  name: string;
  host: string | null;
  gw: number;
  budget: boolean;
  deadline: string | null;
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
  formation: string;
  captain: Ranked | null;
  vice: Ranked | null;
  cost: number;
  clubBreaches: string[];
};
