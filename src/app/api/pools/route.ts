import { NextResponse } from "next/server";
import { getBootstrap } from "@/lib/fpl";
import { FORMS } from "@/lib/squad";
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

  let body: { name?: string; host?: string; budget?: boolean; formation?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  const name = (body.name ?? "").trim().slice(0, 120);
  const host = (body.host ?? "").trim().slice(0, 80);
  const budget = body.budget !== false;

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
      deadline: boot.deadline,
    });
    if (!error) return NextResponse.json({ id });
    if (error.code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "Could not allocate a pool code. Try again." }, { status: 500 });
}
