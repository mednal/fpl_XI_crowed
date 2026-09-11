import { getPool } from "@/lib/pools";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og";

export const alt = "Pick your XI";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/**
 * The pool link is the one that gets pasted into a chat, so its card names the
 * pool. A pool that has been deleted, or a database that is not answering,
 * still gets a card — the generic one — rather than a broken preview.
 */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let name: string | null = null;
  let gw: number | null = null;
  try {
    const pool = await getPool(id);
    if (pool) {
      name = pool.name;
      gw = pool.gw;
    }
  } catch {
    // Falls through to the generic card.
  }

  // The default pool name is "Gameweek 4 — ...", so naming the gameweek above
  // it as well would say it twice on the card.
  const saysGw = !!name && /gameweek|\bgw\s*\d/i.test(name);

  return ogCard({
    eyebrow: gw && !saysGw ? `Gameweek ${gw}` : "Crowd XI",
    title: name ?? "Pick your XI",
    accent: name ? "Pick your XI" : undefined,
    note: "Fifteen players, £100.0m, three to a club. What the crowd picks most becomes the team on the host's screen.",
  });
}
