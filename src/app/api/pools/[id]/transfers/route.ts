import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBootstrap } from "@/lib/fpl";
import { getServiceClient } from "@/lib/supabase";
import { VOTER_COOKIE, VOTER_COOKIE_OPTIONS, mintVoter, readVoter } from "@/lib/identity";
import { lockNote, poolLock } from "@/lib/lock";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { DEFAULT_MOVES, validateTransfer } from "@/lib/transfers";
import type { HostSquad, Player, TransferInput } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

// The same brake the entries route carries: a viewer changes their mind freely,
// a script does not get to sit on the route.
const LIMIT = 30;
const WINDOW = 10 * 60 * 1000;

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  let supabase;
  try {
    supabase = getServiceClient();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  const { data, error } = await supabase
    .from("transfers")
    .select("id, nick, out_ids, in_ids, captain, updated_at")
    .eq("pool_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Every board watching one pool asks this identical question, so a couple of
  // seconds at the edge turns a room full of them into a single read. The same
  // trade the entries route makes, for the same reason.
  return NextResponse.json(
    { transfers: data ?? [] },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=2, stale-while-revalidate=10" } },
  );
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;

  const limit = rateLimit(`transfers:${clientIp(req)}`, LIMIT, WINDOW);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many submissions from this connection. Wait a minute and send your transfers again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let body: TransferInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  // Identity comes from the signed cookie and never from the body, so an id
  // read off the table cannot be used to vote over somebody else.
  let voter: string | null;
  let mintedCookie: string | null = null;
  try {
    const jar = await cookies();
    voter = await readVoter(jar.get(VOTER_COOKIE)?.value);
    if (!voter) {
      mintedCookie = await mintVoter();
      voter = await readVoter(mintedCookie);
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  if (!voter) {
    return NextResponse.json(
      { error: "Your browser could not be identified. Enable cookies for this site and try again." },
      { status: 400 },
    );
  }

  let supabase;
  try {
    supabase = getServiceClient();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const { data: pool, error: poolErr } = await supabase
    .from("pools")
    .select("id, kind, budget, moves, squad, deadline, closed_at")
    .eq("id", id)
    .maybeSingle();

  if (poolErr) return NextResponse.json({ error: poolErr.message }, { status: 500 });
  if (!pool) return NextResponse.json({ error: "That pool does not exist." }, { status: 404 });
  if (pool.kind !== "transfer") {
    return NextResponse.json(
      { error: "This pool asks for a whole team, not transfers. Pick your XI instead." },
      { status: 400 },
    );
  }

  const squad = pool.squad as HostSquad | null;
  if (!squad) {
    return NextResponse.json(
      { error: "The host has not put their team up yet. Try again once they have." },
      { status: 409 },
    );
  }

  const lock = poolLock(pool);
  if (lock.locked) {
    return NextResponse.json({ error: lockNote(lock.why) }, { status: 409 });
  }

  let players: Player[];
  try {
    players = (await getBootstrap()).players;
  } catch {
    return NextResponse.json(
      { error: "The FPL API is not responding, so those transfers could not be checked. Try again shortly." },
      { status: 503 },
    );
  }

  const byId = new Map(players.map((p) => [p.id, p]));
  const out = Array.isArray(body.out) ? body.out.map(Number) : [];
  const incoming = Array.isArray(body.in) ? body.in.map(Number) : [];
  const captain = body.captain ? Number(body.captain) : null;

  const errs = validateTransfer(
    { out, in: incoming, captain },
    squad,
    byId,
    { moves: pool.moves ?? DEFAULT_MOVES, budget: pool.budget !== false },
  );
  if (errs.length) return NextResponse.json({ error: errs[0], errors: errs }, { status: 400 });

  const row = {
    pool_id: id,
    voter,
    nick: (body.nick ?? "").trim().slice(0, 40) || "Anonymous",
    out_ids: out,
    in_ids: incoming,
    captain,
    updated_at: new Date().toISOString(),
  };

  // One vote per browser, editable until the pool shuts.
  const { error } = await supabase.from("transfers").upsert(row, { onConflict: "pool_id,voter" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const res = NextResponse.json({ ok: true });
  if (mintedCookie) res.cookies.set(VOTER_COOKIE, mintedCookie, VOTER_COOKIE_OPTIONS);
  return res;
}
