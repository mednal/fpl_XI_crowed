import "server-only";
import { getServiceClient, isConfigured } from "./supabase";
import type { Entry, Pool } from "./types";

export async function getPool(id: string): Promise<Pool | null> {
  if (!isConfigured) return null;
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("pools")
    .select("id, name, host, gw, budget, deadline, created_at")
    .eq("id", id)
    .maybeSingle();
  return (data as Pool) ?? null;
}

export async function getEntries(poolId: string): Promise<Entry[]> {
  if (!isConfigured) return [];
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("entries")
    .select("id, pool_id, voter, nick, formation, xi, bench, captain, vice, updated_at")
    .eq("pool_id", poolId);
  return (data as Entry[]) ?? [];
}
