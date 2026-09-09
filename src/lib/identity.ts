/**
 * Who a viewer is. A viewer is a random id carried in an httpOnly cookie that is
 * signed with a server secret: a browser can send its own id back, but it cannot
 * read the cookie from script, and it cannot mint one for somebody else. Knowing
 * another viewer's id is therefore not enough to overwrite their team.
 *
 * Web Crypto only, no node: imports — this module runs in middleware (Edge) as
 * well as in route handlers.
 */

export const VOTER_COOKIE = "cxi_voter";

/** Cookie options. A year, because a pool outlives a single sitting. */
export const VOTER_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

const encoder = new TextEncoder();

function secret(): string {
  // VOTER_SECRET is the one to set, so that cookies survive a service-key
  // rotation; the service key is the fallback because it is always present
  // anywhere a write happens.
  const s = process.env.VOTER_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) {
    throw new Error(
      "Viewer cookies cannot be signed. Set VOTER_SECRET in .env.local to any long random string.",
    );
  }
  return s;
}

function toB64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s: string): ArrayBuffer | null {
  try {
    const pad = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
    const buf = new ArrayBuffer(bin.length);
    const out = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return buf;
  } catch {
    return null;
  }
}

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** A fresh `<id>.<signature>` cookie value. */
export async function mintVoter(): Promise<string> {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = toB64Url(bytes);
  const mac = await crypto.subtle.sign("HMAC", await key(), encoder.encode(id));
  return `${id}.${toB64Url(new Uint8Array(mac))}`;
}

/** The id inside a cookie value, or null if it is missing, malformed or unsigned. */
export async function readVoter(cookie: string | undefined | null): Promise<string | null> {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return null;

  const id = cookie.slice(0, dot);
  if (id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) return null;

  const mac = fromB64Url(cookie.slice(dot + 1));
  if (!mac) return null;

  // subtle.verify compares in constant time, so a wrong signature leaks nothing.
  const ok = await crypto.subtle.verify("HMAC", await key(), mac, encoder.encode(id));
  return ok ? id : null;
}
