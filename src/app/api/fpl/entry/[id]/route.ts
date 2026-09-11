import { NextResponse } from "next/server";
import { FplEntryError, getBootstrap, getEntrySquad } from "@/lib/fpl";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { orderSquad, validateHostSquad } from "@/lib/transfers";
import type { HostSquad } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

// Two calls to the FPL API per import, so this one is tighter than the rest: a
// host imports once or twice while setting up, and never in a loop.
const LIMIT = 20;
const WINDOW = 10 * 60 * 1000;

/**
 * A manager's real FPL team, fetched for the setup screen. It goes through the
 * server rather than the browser for two reasons: the FPL API sends no CORS
 * headers, so a browser cannot read it at all, and this is where the squad gets
 * checked before it is offered to the host as something to put up.
 *
 * It returns a team; it does not save one. Saving is the host's PATCH, where
 * the cookie proves who they are.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;

  const limit = rateLimit(`fpl-entry:${clientIp(req)}`, LIMIT, WINDOW);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many imports from this connection. Wait a minute and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const entryId = Number(id);
  if (!Number.isInteger(entryId) || entryId <= 0) {
    return NextResponse.json(
      { error: "An FPL team ID is a number. It is the one in the URL when you open your own team on the FPL site." },
      { status: 400 },
    );
  }
  // Well past the number of teams that have ever played, so it is a wrong ID
  // rather than a real one — and answering it here saves the FPL API the call.
  if (entryId > 100_000_000) {
    return NextResponse.json(
      { error: "No FPL team has that ID. Check the number in the address bar of your own team page." },
      { status: 400 },
    );
  }

  let imported;
  try {
    imported = await getEntrySquad(entryId);
  } catch (e) {
    if (e instanceof FplEntryError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "The FPL API is not responding, so that team could not be read. Try again shortly." },
      { status: 503 },
    );
  }

  let players;
  try {
    players = (await getBootstrap()).players;
  } catch {
    return NextResponse.json(
      { error: "The FPL API is not responding, so player prices could not be read. Try again shortly." },
      { status: 503 },
    );
  }

  const byId = new Map(players.map((p) => [p.id, p]));
  const squad: HostSquad = orderSquad(
    {
      formation: "4-4-2",     // replaced by the shape read off the XI
      xi: imported.xi,
      bench: imported.bench,
      captain: imported.captain,
      vice: imported.vice,
      bank: imported.bank,
      entry: imported.entry,
      entryName: imported.entryName,
      manager: imported.manager,
    },
    byId,
  );

  // A player who has left the league is dropped from the bootstrap, which is
  // the one way an imported team can arrive incomplete. Better to say so than
  // to hand the host fourteen players and let them find out on stream.
  const errs = validateHostSquad(squad, byId);
  if (errs.length) {
    return NextResponse.json(
      {
        error: `That team could not be read as a legal squad — ${errs[0].toLowerCase()} Build it here instead.`,
        errors: errs,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ squad, gw: imported.gw });
}
