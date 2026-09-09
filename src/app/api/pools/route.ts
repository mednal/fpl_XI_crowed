import { NextResponse } from "next/server";
import { getBootstrap } from "@/lib/fpl";
import { getServiceClient } from "@/lib/supabase";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";   // no look-alike characters
function poolId(len = 6) {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export async function POST(req: Request) {
  let body: { name?: string; host?: string; budget?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  const name = (body.name ?? "").trim().slice(0, 120);
  const host = (body.host ?? "").trim().slice(0, 80);
  const budget = body.budget !== false;

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
      deadline: boot.deadline,
    });
    if (!error) return NextResponse.json({ id });
    if (error.code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "Could not allocate a pool code. Try again." }, { status: 500 });
}
