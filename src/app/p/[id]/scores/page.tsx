import { getPool } from "@/lib/pools";
import { buildScoreboard } from "@/lib/scores";
import Scoreboard from "@/components/Scoreboard";
import PoolMissing from "@/components/PoolMissing";

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
