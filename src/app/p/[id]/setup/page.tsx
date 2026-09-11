import { cookies } from "next/headers";
import Link from "next/link";
import { getBootstrap } from "@/lib/fpl";
import { VOTER_COOKIE, readVoter } from "@/lib/identity";
import { getPool, isPoolHost } from "@/lib/pools";
import HostSetup from "@/components/HostSetup";
import PoolMissing from "@/components/PoolMissing";

export const dynamic = "force-dynamic";

export const metadata = { title: "Set up your team — Crowd XI" };

/**
 * Where a transfer pool's host puts their own team up. Host-only, and the same
 * claim the rest of the host's controls rest on: the signed cookie the pool was
 * created with. A viewer who finds this URL gets sent to the board.
 */
export default async function SetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = await getPool(id);
  if (!pool) return <PoolMissing />;

  if (pool.kind !== "transfer") {
    return (
      <PoolMissing note="This pool asks its viewers to build an XI, so there is no team of your own to set up." />
    );
  }

  let voter: string | null = null;
  try {
    const jar = await cookies();
    voter = await readVoter(jar.get(VOTER_COOKIE)?.value);
  } catch {
    // No signing secret: nobody is the host, and nobody gets this screen.
  }

  const [boot, isHost] = await Promise.all([getBootstrap(), isPoolHost(id, voter)]);

  if (!isHost) {
    return (
      <div className="board home">
        <main className="frame">
          <div className="pagepad">
            <h1 className="display">Only the host sets the team</h1>
            <p className="lede">
              This is the screen the person who opened the pool uses to put their squad up.
              Open it from the browser that created the pool, or go and vote on the transfers.
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

  return <HostSetup pool={pool} boot={boot} />;
}
