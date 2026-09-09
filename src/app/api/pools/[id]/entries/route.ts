import { NextResponse } from "next/server";
import { getBootstrap } from "@/lib/fpl";
import { getServiceClient } from "@/lib/supabase";
import { validateEntry } from "@/lib/squad";
import type { EntryInput, Player } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  let supabase;
  try {
    supabase = getServiceClient();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  const { data, error } = await supabase
    .from("entries")
    .select("id, nick, formation, xi, bench, captain, vice, updated_at")
    .eq("pool_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;

  let body: EntryInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  const voter = (body.voter ?? "").trim();
  if (!voter || voter.length > 64) {
    return NextResponse.json({ error: "Missing voter id." }, { status: 400 });
  }

  let supabase;
  try {
    supabase = getServiceClient();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const { data: pool, error: poolErr } = await supabase
    .from("pools")
    .select("id, budget, deadline")
    .eq("id", id)
    .maybeSingle();

  if (poolErr) return NextResponse.json({ error: poolErr.message }, { status: 500 });
  if (!pool) return NextResponse.json({ error: "That pool does not exist." }, { status: 404 });

  // Voting closes at the real FPL deadline, the same moment the game locks.
  if (pool.deadline && new Date(pool.deadline).getTime() < Date.now()) {
    return NextResponse.json(
      { error: "The deadline for this gameweek has passed, so teams are locked." },
      { status: 409 },
    );
  }

  let players: Player[];
  try {
    players = (await getBootstrap()).players;
  } catch {
    return NextResponse.json(
      { error: "The FPL API is not responding, so the squad could not be checked. Try again shortly." },
      { status: 503 },
    );
  }

  const byId = new Map(players.map((p) => [p.id, p]));
  const errs = validateEntry(body, byId, pool.budget);
  if (errs.length) return NextResponse.json({ error: errs[0], errors: errs }, { status: 400 });

  const row = {
    pool_id: id,
    voter,
    nick: (body.nick ?? "").trim().slice(0, 40) || "Anonymous",
    formation: body.formation,
    xi: body.xi,
    bench: body.bench,
    captain: body.captain,
    vice: body.vice,
    updated_at: new Date().toISOString(),
  };

  // One entry per browser, which they may keep editing until the deadline.
  const { error } = await supabase.from("entries").upsert(row, { onConflict: "pool_id,voter" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
