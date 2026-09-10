import { getBootstrap } from "@/lib/fpl";
import { getEntries, getPool } from "@/lib/pools";
import LiveBoard from "@/components/LiveBoard";
import PoolMissing from "@/components/PoolMissing";

export const dynamic = "force-dynamic";

export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = await getPool(id);

  if (!pool) return <PoolMissing />;

  const [boot, entries] = await Promise.all([getBootstrap(), getEntries(id)]);

  return (
    <LiveBoard
      pool={pool}
      boot={boot}
      initialEntries={entries.map((e) => ({
        id: e.id, nick: e.nick, xi: e.xi, bench: e.bench, captain: e.captain, vice: e.vice,
        updated_at: e.updated_at,
      }))}
    />
  );
}
