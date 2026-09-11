import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBootstrap } from "@/lib/fpl";
import { VOTER_COOKIE, VOTER_COOKIE_OPTIONS, mintVoter, readVoter } from "@/lib/identity";
import { parseDeadline } from "@/lib/lock";
import { FORMS } from "@/lib/squad";
import { DEFAULT_MOVES, MAX_MOVES } from "@/lib/transfers";
import { getServiceClient } from "@/lib/supabase";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// A host needs a handful of pools an evening, not hundreds; every request that
// gets past here writes a row.
const LIMIT = 8;
const WINDOW = 60 * 60 * 1000;

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";   // no look-alike characters
function poolId(len = 6) {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export async function POST(req: Request) {
  const limit = rateLimit(`pools:${clientIp(req)}`, LIMIT, WINDOW);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many pools created from this connection. Wait a while before starting another." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let body: {
    name?: string; host?: string; budget?: boolean;
    formation?: string | null; deadline?: string | null;
    kind?: string; moves?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  const name = (body.name ?? "").trim().slice(0, 120);
  const host = (body.host ?? "").trim().slice(0, 80);
  const budget = body.budget !== false;

  // Which question the pool asks. A transfer pool is created empty and gets its
  // team from the setup screen, because the host has to be the one to put it
  // there and they are not the browser that is asking for a pool id yet.
  const kind = body.kind === "transfer" ? "transfer" : "crowd";

  const moves = body.moves ?? DEFAULT_MOVES;
  if (!Number.isInteger(moves) || moves < 0 || moves > MAX_MOVES) {
    return NextResponse.json(
      { error: `Transfers each viewer may make must be a whole number up to ${MAX_MOVES}, or 0 for unlimited.` },
      { status: 400 },
    );
  }

  // Empty means the crowd decides the shape, which is the default. Anything else
  // has to be a real FPL formation — it is written to a column the board reads.
  const formation = (body.formation ?? "").trim();
  if (formation && !FORMS[formation]) {
    return NextResponse.json(
      { error: `${formation} is not an FPL formation. Leave it empty to let the crowd decide the shape.` },
      { status: 400 },
    );
  }

  let boot;
  try {
    boot = await getBootstrap();
  } catch {
    return NextResponse.json(
      { error: "The FPL API is not responding, so the gameweek could not be read. Try again shortly." },
      { status: 503 },
    );
  }

  // A host may close their pool before the game does — the segment ends when the
  // stream does, not when FPL says so — but never after it.
  const when = parseDeadline(body.deadline, boot.deadline);
  if (!when.ok) return NextResponse.json({ error: when.error }, { status: 400 });

  // The pool belongs to the browser that opened it: that is the only claim there
  // is to being the host, so it is minted here if this browser has no cookie yet
  // and, like a viewer's, it is signed and never read from the body.
  let hostVoter: string | null;
  let mintedCookie: string | null = null;
  try {
    const jar = await cookies();
    hostVoter = await readVoter(jar.get(VOTER_COOKIE)?.value);
    if (!hostVoter) {
      mintedCookie = await mintVoter();
      hostVoter = await readVoter(mintedCookie);
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  let supabase;
  try {
    supabase = getServiceClient();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // Six characters is 500 million combinations; a couple of retries covers a clash.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = poolId();
    const { error } = await supabase.from("pools").insert({
      id,
      name: name || `${boot.gwName} pool`,
      host: host || null,
      gw: boot.gw,
      budget,
      formation: formation || null,
      deadline: when.iso,
      host_voter: hostVoter,
      kind,
      moves: kind === "transfer" ? moves : null,
    });
    if (!error) {
      const res = NextResponse.json({ id, kind });
      if (mintedCookie) res.cookies.set(VOTER_COOKIE, mintedCookie, VOTER_COOKIE_OPTIONS);
      return res;
    }
    if (error.code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "Could not allocate a pool code. Try again." }, { status: 500 });
}
