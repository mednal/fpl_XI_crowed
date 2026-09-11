import { cookies } from "next/headers";
import Link from "next/link";
import { getBootstrap } from "@/lib/fpl";
import { VOTER_COOKIE, readVoter } from "@/lib/identity";
import { getEntries, getPool, getTransfers, isPoolHost } from "@/lib/pools";
import LiveBoard from "@/components/LiveBoard";
import TransferBoard from "@/components/TransferBoard";
import PoolMissing from "@/components/PoolMissing";

export const dynamic = "force-dynamic";

export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = await getPool(id);

  if (!pool) return <PoolMissing />;

  // The host is whoever opened the pool, which is a claim carried by their
  // cookie. A viewer who wanders onto the board gets the board and nothing else.
  let voter: string | null = null;
  try {
    const jar = await cookies();
    voter = await readVoter(jar.get(VOTER_COOKIE)?.value);
  } catch {
    // No signing secret. Nobody is the host, and the board still goes up.
  }

  if (pool.kind === "transfer") {
    const [boot, rows, host] = await Promise.all([
      getBootstrap(),
      getTransfers(id),
      isPoolHost(id, voter),
    ]);

    // A pool whose team is not up yet has nothing to draw. The host is sent to
    // put one there; anybody else is told to come back.
    if (!pool.squad) {
      return (
        <div className="board home">
          <main className="frame">
            <div className="pagepad">
              <h1 className="display">
                {host ? "Put your team up" : "The team is not up yet"}
              </h1>
              <p className="lede">
                {host
                  ? "This pool is waiting on your squad. Import it from FPL or build it here, and the link is ready to share."
                  : "The host has not put their squad up yet. This is where the crowd's transfers appear once they have."}
              </p>
              {host && (
                <p className="rowline">
                  <Link className="btn btn-primary" href={`/p/${id}/setup`}>Set up my team</Link>
                </p>
              )}
            </div>
          </main>
        </div>
      );
    }

    return (
      <TransferBoard
        pool={pool}
        squad={pool.squad}
        boot={boot}
        isHost={host}
        initialTransfers={rows.map((r) => ({
          id: r.id, nick: r.nick, out_ids: r.out_ids, in_ids: r.in_ids,
          captain: r.captain, updated_at: r.updated_at,
        }))}
      />
    );
  }

  const [boot, entries, host] = await Promise.all([
    getBootstrap(),
    getEntries(id),
    isPoolHost(id, voter),
  ]);

  return (
    <LiveBoard
      pool={pool}
      boot={boot}
      isHost={host}
      initialEntries={entries.map((e) => ({
        id: e.id, nick: e.nick, xi: e.xi, bench: e.bench, captain: e.captain, vice: e.vice,
        updated_at: e.updated_at,
      }))}
    />
  );
}
