import { NextResponse } from "next/server";
import { getBootstrap, getLivePoints } from "@/lib/fpl";
import { getServiceClient } from "@/lib/supabase";
import { crowdXI, tally } from "@/lib/squad";
import type { Player } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The leaderboard, once the gameweek is under way: every viewer's XI scored the
 * way FPL scores it — captain doubled, bench not counted. The crowd XI is scored
 * alongside them, which is usually the most interesting number on the screen.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;

  let supabase;
  try {
    supabase = getServiceClient();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const { data: pool } = await supabase
    .from("pools")
    .select("id, gw, deadline")
    .eq("id", id)
    .maybeSingle();
  if (!pool) return NextResponse.json({ error: "That pool does not exist." }, { status: 404 });

  if (pool.deadline && new Date(pool.deadline).getTime() > Date.now()) {
    return NextResponse.json({ pending: true, reason: "The gameweek has not started yet." });
  }

  const { data: entries, error } = await supabase
    .from("entries")
    .select("id, nick, xi, bench, captain, vice")
    .eq("pool_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let points: Record<number, number>;
  let players: Player[];
  try {
    [points, players] = await Promise.all([
      getLivePoints(pool.gw),
      getBootstrap().then((b) => b.players),
    ]);
  } catch {
    return NextResponse.json({ error: "Could not read live points from the FPL API." }, { status: 503 });
  }

  const scoreXI = (xi: number[], captain: number) =>
    xi.reduce((sum, pid) => sum + (points[pid] ?? 0) * (pid === captain ? 2 : 1), 0);

  const board = (entries ?? [])
    .map((e) => ({ nick: e.nick as string, points: scoreXI(e.xi as number[], e.captain as number) }))
    .sort((a, b) => b.points - a.points)
    .map((r, i) => ({ rank: i + 1, ...r }));

  const byId = new Map(players.map((p) => [p.id, p]));
  const cx = crowdXI(tally((entries ?? []) as never), byId);
  const crowdIds = [1, 2, 3, 4].flatMap((k) => cx.rows[k as 1].map((r) => r.id));
  const crowdPoints = cx.captain ? scoreXI(crowdIds, cx.captain.id) : scoreXI(crowdIds, -1);

  const beat = board.filter((r) => r.points > crowdPoints).length;

  return NextResponse.json({
    gw: pool.gw,
    board,
    crowd: {
      points: crowdPoints,
      formation: cx.formation,
      captain: cx.captain?.player.n ?? null,
      beatenBy: beat,
      of: board.length,
    },
  });
}
