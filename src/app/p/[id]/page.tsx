import { getBootstrap } from "@/lib/fpl";
import { getPool } from "@/lib/pools";
import TeamPicker from "@/components/TeamPicker";
import PoolMissing from "@/components/PoolMissing";

export const dynamic = "force-dynamic";

export default async function VotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = await getPool(id);
  if (!pool) {
    return (
      <PoolMissing note="That link does not match any pool. Ask the host for the current link, or start your own." />
    );
  }

  const boot = await getBootstrap();
  return <TeamPicker pool={pool} boot={boot} />;
}
