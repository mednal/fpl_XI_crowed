import Link from "next/link";
import { getPool } from "@/lib/pools";
import { buildScoreboard } from "@/lib/scores";
import Scoreboard from "@/components/Scoreboard";

export const dynamic = "force-dynamic";

export default async function ScoresPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = await getPool(id);
  if (!pool) return <PoolMissing />;

  // Rendered on the server so the host lands on a finished board rather than a
  // spinner; the client takes over refreshing it while the gameweek is running.
  const initial = await buildScoreboard(id);
  return <Scoreboard pool={pool} initial={initial} />;
}

function PoolMissing() {
  return (
    <>
      <div className="topbar">
        <Link className="brand" href="/">
          <span className="dot" />
          Crowd XI
        </Link>
      </div>
      <div className="pagepad center">
        <h1 className="display" style={{ fontSize: 40 }}>Pool not found</h1>
        <p className="lede" style={{ margin: "14px auto" }}>
          That link does not match any pool.
        </p>
        <Link className="btn btn-primary" href="/">Create a pool</Link>
      </div>
    </>
  );
}
