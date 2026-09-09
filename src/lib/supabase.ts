import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

/**
 * Read-only client for the browser. It can see pools and entries (so the
 * results screen can subscribe to live changes) but every write goes through
 * an API route instead, where the squad is validated against real prices.
 */
let browserClient: SupabaseClient | null = null;
export function getBrowserClient(): SupabaseClient | null {
  if (!isConfigured) return null;
  if (!browserClient) browserClient = createClient(url!, anonKey!, {
    auth: { persistSession: false },
  });
  return browserClient;
}

/** Full-access client for server routes only. Never import this from a component. */
export function getServiceClient(): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and fill in your project's keys.",
    );
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}
