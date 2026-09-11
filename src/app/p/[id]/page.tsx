import Link from "next/link";
import { getBootstrap } from "@/lib/fpl";
import { getPool } from "@/lib/pools";
import TeamPicker from "@/components/TeamPicker";
import TransferPicker from "@/components/TransferPicker";
import PoolMissing from "@/components/PoolMissing";

export const dynamic = "force-dynamic";

/** The pool link is the one that gets shared, so its preview names the pool. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = await getPool(id).catch(() => null);
  if (!pool) return { title: "Pool not found — Crowd XI" };
  // The name is the host's and often carries its own dash, so lead with the verb.
  const transfer = pool.kind === "transfer";
  const title = `${transfer ? "Pick the transfers" : "Pick your XI"} · ${pool.name}`;
  const description = transfer
    ? `${pool.host ? `${pool.host}'s` : "The host's"} real FPL team is up for gameweek ${pool.gw}. Vote on who they sell and who they sign.`
    : `Build a real FPL squad for gameweek ${pool.gw}. The eleven the crowd picks most goes on the host's screen.`;
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image" as const } };
}

export default async function VotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = await getPool(id);
  if (!pool) {
    return (
      <PoolMissing note="That link does not match any pool. Ask the host for the current link, or start your own." />
    );
  }

  const boot = await getBootstrap();

  if (pool.kind === "transfer") {
    // The link can be shared before the host has put a team up, and a viewer
    // arriving then needs to be told to come back rather than shown an empty
    // pitch they cannot do anything with.
    if (!pool.squad) {
      return (
        <div className="board home">
          <main className="frame">
            <div className="pagepad">
              <h1 className="display">The team is not up yet</h1>
              <p className="lede">
                {pool.host ? `${pool.host} has` : "The host has"} opened this pool but has not put
                their squad up. Once they do, this page is where you vote on the transfers they
                should make.
              </p>
              <p className="rowline">
                <Link className="btn" href={`/p/${id}/live`}>See the board</Link>
              </p>
            </div>
          </main>
        </div>
      );
    }
    return <TransferPicker pool={pool} squad={pool.squad} boot={boot} />;
  }

  return <TeamPicker pool={pool} boot={boot} />;
}
