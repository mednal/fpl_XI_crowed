import "server-only";
import { getServiceClient, isConfigured } from "./supabase";
import { DEFAULT_MOVES } from "./transfers";
import type { HostSquad, Pool, Entry, TransferRow } from "./types";

export async function getPool(id: string): Promise<Pool | null> {
  if (!isConfigured) return null;
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("pools")
    .select("id, name, host, gw, budget, kind, squad, moves, formation, deadline, closed_at, created_at")
    .eq("id", id)
    .maybeSingle();
  return data ? normalise(data) : null;
}

/**
 * A row as the app expects it. `kind` and `moves` were added after pools
 * existed, so a pool created before them comes back with nulls where the type
 * promises a value — the defaults are applied here rather than at every reader.
 */
function normalise(row: Record<string, unknown>): Pool {
  return {
    ...(row as unknown as Pool),
    kind: row.kind === "transfer" ? "transfer" : "crowd",
    squad: (row.squad as HostSquad | null) ?? null,
    moves: typeof row.moves === "number" ? row.moves : DEFAULT_MOVES,
  };
}

/**
 * Whether this browser opened the pool. There are no accounts, so the host is
 * the viewer id that created it — asked for separately from `getPool` so the
 * id itself never rides along into a client component, the way `entries.voter`
 * never reaches the anon key.
 */
export async function isPoolHost(id: string, voter: string | null): Promise<boolean> {
  if (!isConfigured || !voter) return false;
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("pools")
    .select("host_voter")
    .eq("id", id)
    .maybeSingle();
  return Boolean(data?.host_voter) && data!.host_voter === voter;
}

export async function getEntries(poolId: string): Promise<Entry[]> {
  if (!isConfigured) return [];
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("entries")
    .select("id, pool_id, nick, formation, xi, bench, captain, vice, updated_at")
    .eq("pool_id", poolId);
  return (data as Entry[]) ?? [];
}

/** The transfers proposed in a transfer pool. `voter` stays behind, exactly as
 *  it does for entries: the board needs the votes, not who cast them. */
export async function getTransfers(poolId: string): Promise<TransferRow[]> {
  if (!isConfigured) return [];
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("transfers")
    .select("id, pool_id, nick, out_ids, in_ids, captain, updated_at")
    .eq("pool_id", poolId);
  return (data as TransferRow[]) ?? [];
}
