import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getBootstrap } from "@/lib/fpl";
import { VOTER_COOKIE, readVoter } from "@/lib/identity";
import { getPool, getTransfers, isPoolHost } from "@/lib/pools";
import HostTeam from "@/components/HostTeam";
import PoolMissing from "@/components/PoolMissing";

export const dynamic = "force-dynamic";

export const metadata = { title: "Manage your team — Crowd XI" };

/**
 * Where the host acts on the vote. The board is the crowd's answer; this is the
 * host's, and it is the only screen where the team on the board changes hands.
 * Host-only on the same claim every other host control rests on: the signed
 * cookie the pool was created with.
 */
export default async function ManagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = await getPool(id);
  if (!pool) return <PoolMissing />;

  if (pool.kind !== "transfer") {
    return (
      <PoolMissing note="This pool asks its viewers to build an XI, so there is no team of your own to manage." />
    );
  }

  let voter: string | null = null;
  try {
    const jar = await cookies();
    voter = await readVoter(jar.get(VOTER_COOKIE)?.value);
  } catch {
    // No signing secret: nobody is the host, and nobody gets this screen.
  }

  const [boot, host, rows] = await Promise.all([
    getBootstrap(),
    isPoolHost(id, voter),
    getTransfers(id),
  ]);

  if (!host) {
    return (
      <div className="board home">
        <main className="frame">
          <div className="pagepad">
            <h1 className="display">Only the host changes the team</h1>
            <p className="lede">
              This is the screen the person who opened the pool uses to make the transfers the
              crowd voted for. Open it from the browser that created the pool, or go and vote.
            </p>
            <p className="rowline">
              <Link className="btn btn-primary" href={`/p/${id}`}>Vote on the transfers</Link>
              <Link className="btn" href={`/p/${id}/live`}>See the board</Link>
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Nothing to manage until there is a team. Setup is the screen for that.
  if (!pool.squad) redirect(`/p/${id}/setup`);

  return (
    <HostTeam
      pool={pool}
      squad={pool.squad}
      boot={boot}
      votes={rows.map((r) => ({ out_ids: r.out_ids, in_ids: r.in_ids, captain: r.captain }))}
    />
  );
}
