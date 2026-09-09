import Link from "next/link";
import { getBootstrap } from "@/lib/fpl";
import { getPool } from "@/lib/pools";
import TeamPicker from "@/components/TeamPicker";

export const dynamic = "force-dynamic";

export default async function VotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = await getPool(id);
  if (!pool) return <PoolMissing />;

  const boot = await getBootstrap();
  return <TeamPicker pool={pool} boot={boot} />;
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
          That link does not match any pool. Ask the host for the current link, or start your own.
        </p>
        <Link className="btn btn-primary" href="/">Create a pool</Link>
      </div>
    </>
  );
}
