import Link from "next/link";
import { getBootstrap } from "@/lib/fpl";
import { getEntries, getPool } from "@/lib/pools";
import LiveBoard from "@/components/LiveBoard";

export const dynamic = "force-dynamic";

export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = await getPool(id);

  if (!pool) {
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

  const [boot, entries] = await Promise.all([getBootstrap(), getEntries(id)]);

  return (
    <LiveBoard
      pool={pool}
      boot={boot}
      initialEntries={entries.map((e) => ({
        id: e.id, nick: e.nick, xi: e.xi, bench: e.bench, captain: e.captain, vice: e.vice,
      }))}
    />
  );
}
