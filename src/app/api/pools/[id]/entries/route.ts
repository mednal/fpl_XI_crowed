import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBootstrap } from "@/lib/fpl";
import { getServiceClient } from "@/lib/supabase";
import { VOTER_COOKIE, VOTER_COOKIE_OPTIONS, mintVoter, readVoter } from "@/lib/identity";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { validateEntry } from "@/lib/squad";
import type { EntryInput, Player } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

// A viewer edits their team freely; this only stops a script hammering the route.
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
    .from("entries")
    .select("id, nick, formation, xi, bench, captain, vice, updated_at")
    .eq("pool_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Every board watching a pool asks this same question and gets the same
  // answer, so on a big stream the interesting number is not how often one
  // viewer asks but how many ask at once. A couple of seconds at the edge
  // turns a thousand simultaneous boards into one read, which is the half of
  // the load the client cannot coalesce for itself. `max-age=0` keeps the
  // browser revalidating, so nobody is served a stale pool from their own disk.
  return NextResponse.json(
    { entries: data ?? [] },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=2, stale-while-revalidate=10" } },
  );
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;

  const limit = rateLimit(`entries:${clientIp(req)}`, LIMIT, WINDOW);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many submissions from this connection. Wait a minute and send your team again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let body: EntryInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  // Identity comes from the signed cookie, never from the body: an id read off
  // the entries table is useless without the signature, so nobody can submit
  // over somebody else's team.
  let voter: string | null;
  let mintedCookie: string | null = null;
  try {
    const jar = await cookies();
    voter = await readVoter(jar.get(VOTER_COOKIE)?.value);
    if (!voter) {
      // First visit, or a cookie we did not sign. Issue a fresh one and use it.
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

  const res = NextResponse.json({ ok: true });
  if (mintedCookie) res.cookies.set(VOTER_COOKIE, mintedCookie, VOTER_COOKIE_OPTIONS);
  return res;
}
