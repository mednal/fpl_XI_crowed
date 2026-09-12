import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBootstrap } from "@/lib/fpl";
import { VOTER_COOKIE, readVoter } from "@/lib/identity";
import { parseDeadline, poolLock } from "@/lib/lock";
import { getServiceClient } from "@/lib/supabase";
import {
  MAX_MOVES, hostIds, movesAllowed, movesLabel, orderSquad, validateHostSquad,
} from "@/lib/transfers";
import type { HostSquad, Player } from "@/lib/types";
import { clientIp, rateLimit } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

// A host nudges the deadline and closes the pool once or twice a night. This is
// only here so a script cannot sit on the route.
const LIMIT = 40;
const WINDOW = 10 * 60 * 1000;

/** One message for both "not the host" and "no host on the row", because the
 *  difference is only interesting to somebody probing for it. */
const NOT_HOST =
  "Only the browser that opened this pool can change it. Open it from that browser, or start a new pool.";

/**
 * The host's controls: move the closing time, or shut the pool by hand. Being
 * the host is not an account — it is holding the signed cookie the pool was
 * created with — so the claim is read from that cookie and never from the body.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;

  const limit = rateLimit(`pool-edit:${clientIp(req)}`, LIMIT, WINDOW);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many changes from this connection. Wait a minute and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let body: { deadline?: string | null; closed?: boolean; squad?: HostSquad; moves?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  let voter: string | null;
  try {
    const jar = await cookies();
    voter = await readVoter(jar.get(VOTER_COOKIE)?.value);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  if (!voter) return NextResponse.json({ error: NOT_HOST }, { status: 403 });

  let supabase;
  try {
    supabase = getServiceClient();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const { data: pool, error: poolErr } = await supabase
    .from("pools")
    .select("id, gw, kind, moves, deadline, closed_at, host_voter, squad")
    .eq("id", id)
    .maybeSingle();

  if (poolErr) return NextResponse.json({ error: poolErr.message }, { status: 500 });
  if (!pool) return NextResponse.json({ error: "That pool does not exist." }, { status: 404 });
  if (!pool.host_voter || pool.host_voter !== voter) {
    return NextResponse.json({ error: NOT_HOST }, { status: 403 });
  }

  const patch: {
    deadline?: string | null;
    closed_at?: string | null;
    squad?: HostSquad;
    moves?: number;
  } = {};

  // How many transfers the crowd gets. The host picks it when they open the
  // pool and may still change it once the pool is up — a stream decides
  // mid-segment that chat has earned a second one. It may only ever rise once
  // votes are in: a vote cast under a larger allowance keeps its extra swaps,
  // and `tallyTransfers` would go on counting them, so lowering the number
  // would leave those viewers weighing more than everyone who voted after.
  if ("moves" in body) {
    if (pool.kind !== "transfer") {
      return NextResponse.json(
        { error: "Only a transfer pool has an allowance. Start one to set how many transfers the crowd gets." },
        { status: 400 },
      );
    }
    const moves = Number(body.moves);
    if (!Number.isInteger(moves) || moves < 0 || moves > MAX_MOVES) {
      return NextResponse.json(
        { error: `Choose between 1 and ${MAX_MOVES} transfers, or 0 for unlimited.` },
        { status: 400 },
      );
    }
    if (movesAllowed(moves) < movesAllowed(pool.moves)) {
      const { count } = await supabase
        .from("transfers")
        .select("id", { count: "exact", head: true })
        .eq("pool_id", id);
      if (count) {
        return NextResponse.json(
          {
            error: `${count === 1 ? "Someone has" : `${count} viewers have`} already voted under ${movesLabel(pool.moves).toLowerCase()}, so the allowance can only go up from here. Start a new pool to run it tighter.`,
          },
          { status: 409 },
        );
      }
    }
    patch.moves = moves;
  }

  // The host's own team, from the setup screen or the manage screen. It is
  // checked here from scratch against real prices, exactly like a viewer's
  // entry: the browser that sends it is the host's, which makes it trusted with
  // the pool and not with the fifteen players in the body.
  if ("squad" in body) {
    if (pool.kind !== "transfer") {
      return NextResponse.json(
        { error: "Only a transfer pool has a team of its own. Start one to put your squad up." },
        { status: 400 },
      );
    }

    let players: Player[];
    try {
      players = (await getBootstrap()).players;
    } catch {
      return NextResponse.json(
        { error: "The FPL API is not responding, so that team could not be checked. Try again shortly." },
        { status: 503 },
      );
    }
    const byId = new Map(players.map((p) => [p.id, p]));
    const raw = body.squad;
    const squad: HostSquad = {
      formation: String(raw?.formation ?? ""),
      xi: (raw?.xi ?? []).map(Number),
      bench: (raw?.bench ?? []).map(Number),
      captain: Number(raw?.captain ?? 0),
      vice: Number(raw?.vice ?? 0),
      bank: Math.max(0, Math.round(Number(raw?.bank ?? 0))),
      entry: raw?.entry ? Number(raw.entry) : null,
      entryName: raw?.entryName ? String(raw.entryName).slice(0, 60) : null,
      manager: raw?.manager ? String(raw.manager).slice(0, 60) : null,
    };
    const ordered = orderSquad(squad, byId);
    const errs = validateHostSquad(ordered, byId);
    if (errs.length) {
      return NextResponse.json({ error: errs[0], errors: errs }, { status: 400 });
    }

    // Changing *who is in* the team under votes already cast would leave every
    // one of them pointing at a player who is no longer there, so that waits
    // until voting is shut — which is exactly when a host makes the transfer
    // the crowd asked for. Rearranging the same fifteen — a substitution, the
    // armband, the shape — is safe at any time: every vote still names a player
    // who is in the squad.
    const before = (pool.squad as HostSquad | null) ?? null;
    const sameFifteen = before
      ? (() => {
          const was = new Set(hostIds(before));
          const now = hostIds(ordered);
          return was.size === now.length && now.every((pid) => was.has(pid));
        })()
      : false;
    if (before && !sameFifteen) {
      const shut = poolLock({ deadline: pool.deadline, closed_at: pool.closed_at }).locked;
      const { count } = await supabase
        .from("transfers")
        .select("id", { count: "exact", head: true })
        .eq("pool_id", id);
      if (count && !shut) {
        return NextResponse.json(
          {
            error: `${count === 1 ? "Someone has" : `${count} viewers have`} voted on this team, so close the voting on your board before you change who is in it. Substitutions and the armband can be saved while voting is open.`,
          },
          { status: 409 },
        );
      }
    }

    patch.squad = ordered;
  }

  if ("deadline" in body) {
    // Only this branch needs FPL: the official deadline is the ceiling. Closing
    // a pool must keep working when their API does not, so it is left out of it.
    let fpl: string | null;
    try {
      const boot = await getBootstrap();
      fpl = boot.events.find((e) => e.id === pool.gw)?.deadline ?? null;
    } catch {
      return NextResponse.json(
        { error: "The FPL API is not responding, so the gameweek deadline could not be checked. Try again shortly." },
        { status: 503 },
      );
    }
    const when = parseDeadline(body.deadline, fpl);
    if (!when.ok) return NextResponse.json({ error: when.error }, { status: 400 });
    patch.deadline = when.iso;
  }

  if ("closed" in body) {
    if (body.closed) {
      patch.closed_at = new Date().toISOString();
    } else {
      // Reopening a pool the gameweek has already locked would put a Send button
      // in front of viewers that the entries route is bound to refuse.
      const ends = patch.deadline ?? pool.deadline;
      if (ends && new Date(ends).getTime() <= Date.now()) {
        return NextResponse.json(
          { error: "The deadline has passed, so this pool cannot be reopened. Start a new pool for the next gameweek." },
          { status: 409 },
        );
      }
      patch.closed_at = null;
    }
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("pools")
    .update(patch)
    .eq("id", id)
    .select("deadline, closed_at, squad, moves")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    deadline: data?.deadline ?? null,
    closed_at: data?.closed_at ?? null,
    squad: data?.squad ?? null,
    moves: data?.moves ?? null,
  });
}
