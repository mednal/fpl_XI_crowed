import "server-only";
import { getBootstrap, getLiveStats } from "./fpl";
import { getServiceClient } from "./supabase";
import { crowdXI, ranked, rankBy, scoreEntry, tally } from "./squad";
import type { Entry, LiveStat, Player } from "./types";

export type ScoreRow = {
  rank: number;
  nick: string;
  points: number;
  /** Whoever the armband ended up on, by name — it moves if the captain sat out. */
  captain: string | null;
  armbandMoved: boolean;
  subs: number;
};

export type Scoreboard = {
  gw: number;
  gwName: string;
  /** True once the gameweek is settled, which is when auto-subs and the armband
   *  switch have been applied. Until then every score is provisional. */
  settled: boolean;
  board: ScoreRow[];
  crowd: {
    points: number;
    formation: string;
    captain: string | null;
    rank: number;      // where the crowd XI would sit in the table
    beat: number;      // viewers it outscored
    of: number;        // viewers in the pool
  };
  updatedAt: string;
};

export type ScoresResult =
  | { kind: "ok"; data: Scoreboard }
  | { kind: "pending"; reason: string }
  | { kind: "error"; status: number; error: string };

type ScorableEntry = Pick<Entry, "nick" | "xi" | "bench" | "captain" | "vice">;

/**
 * The leaderboard for one pool. Shared by the API route and the scores page, so
 * the two can never drift into disagreeing about who won.
 */
export async function buildScoreboard(poolId: string): Promise<ScoresResult> {
  let supabase;
  try {
    supabase = getServiceClient();
  } catch (e) {
    return { kind: "error", status: 500, error: (e as Error).message };
  }

  const { data: pool, error: poolErr } = await supabase
    .from("pools")
    .select("id, gw, formation, deadline")
    .eq("id", poolId)
    .maybeSingle();
  if (poolErr) return { kind: "error", status: 500, error: poolErr.message };
  if (!pool) return { kind: "error", status: 404, error: "That pool does not exist." };

  // A pool never closes later than its gameweek does, so a closing time still
  // ahead of us settles it without an FPL call. The real test comes below: a
  // host who closed early — or set their own deadline — has a shut pool hours
  // before there is anything to score.
  if (pool.deadline && new Date(pool.deadline).getTime() > Date.now()) {
    return { kind: "pending", reason: "The gameweek has not started yet." };
  }

  const { data: entries, error } = await supabase
    .from("entries")
    .select("nick, xi, bench, captain, vice")
    .eq("pool_id", poolId);
  if (error) return { kind: "error", status: 500, error: error.message };

  let stats: Record<number, LiveStat>;
  let players: Player[];
  let gwName: string;
  let settled: boolean;
  let kickoff: string | null;
  try {
    const [live, boot] = await Promise.all([getLiveStats(pool.gw), getBootstrap()]);
    stats = live;
    players = boot.players;
    const event = boot.events.find((e) => e.id === pool.gw);
    gwName = event?.name ?? `Gameweek ${pool.gw}`;
    settled = event?.finished ?? false;
    kickoff = event?.deadline ?? null;
  } catch {
    return {
      kind: "error",
      status: 503,
      error: "The FPL API is not responding, so scores could not be read. Try again shortly.",
    };
  }

  // Whether there is a score to show is the *gameweek's* business, not the
  // pool's: a host who closes their pool at half seven has not made the fixtures
  // kick off any earlier.
  if (kickoff && new Date(kickoff).getTime() > Date.now()) {
    return { kind: "pending", reason: "The gameweek has not started yet." };
  }

  const byId = new Map(players.map((p) => [p.id, p]));
  const rows = (entries ?? []) as ScorableEntry[];

  const scored = rows.map((e) => {
    const s = scoreEntry(e, stats, byId, settled);
    return {
      nick: e.nick || "Anonymous",
      points: s.points,
      captain: s.captain ? byId.get(s.captain)?.n ?? null : null,
      armbandMoved: s.armbandMoved,
      subs: s.subs.length,
    };
  });
  const board = rankBy(scored, (r) => r.points);

  // The crowd XI has no bench, so nothing can come on for it — but the armband
  // still passes to the crowd's vice if its captain never played.
  const t = tally(rows);
  const cx = crowdXI(t, byId, pool.formation as string | null);
  const crowdXIIds = [1, 2, 3, 4].flatMap((k) => cx.rows[k as 1].map((r) => r.id));
  const onThePitch = new Set(crowdXIIds);

  // Who the crowd captained and who it picked are two separate votes, so the
  // most-voted captain is not always in the crowd XI. Only a player actually on
  // the pitch can be doubled, so the armband goes to the most-voted captain who
  // is — the same player the live board draws the C on.
  const armband = ranked(t.captain, t.n, byId).find((r) => onThePitch.has(r.id))?.id ?? 0;
  const second = ranked(t.vice, t.n, byId).find((r) => onThePitch.has(r.id) && r.id !== armband)?.id ?? 0;

  const crowd = scoreEntry(
    { xi: crowdXIIds, bench: [], captain: armband, vice: second },
    stats,
    byId,
    settled,
  );

  return {
    kind: "ok",
    data: {
      gw: pool.gw,
      gwName,
      settled,
      board,
      crowd: {
        points: crowd.points,
        formation: board.length ? cx.formation : "—",
        captain: crowd.captain ? byId.get(crowd.captain)?.n ?? null : null,
        rank: board.filter((r) => r.points > crowd.points).length + 1,
        beat: board.filter((r) => r.points < crowd.points).length,
        of: board.length,
      },
      updatedAt: new Date().toISOString(),
    },
  };
}
