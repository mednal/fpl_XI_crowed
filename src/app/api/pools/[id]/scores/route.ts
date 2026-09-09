import { NextResponse } from "next/server";
import { buildScoreboard } from "@/lib/scores";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The leaderboard, once the gameweek is under way: every viewer's XI scored the
 * way FPL scores it — captain doubled, bench not counted unless it comes on —
 * with the crowd XI scored alongside them. The maths lives in `lib/scores.ts`,
 * which the scores page reads directly.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const result = await buildScoreboard(id);

  if (result.kind === "pending") {
    return NextResponse.json({ pending: true, reason: result.reason });
  }
  if (result.kind === "error") {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data);
}
