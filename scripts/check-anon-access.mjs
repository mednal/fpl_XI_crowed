/**
 * M1 check: the anon key must be able to see what the live screen's realtime
 * subscription needs, and nothing more. Run with `npm run verify:anon` after
 * applying supabase/schema.sql.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
const say = (ok, label, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

const poolId = "chk" + Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, "x");
const squad = { xi: [1], bench: [2], captain: 1, vice: 2, formation: "4-4-2" };

await service.from("pools").insert({
  id: poolId, name: "anon access check", gw: 0, budget: true,
  deadline: new Date(Date.now() + 3600e3).toISOString(),
});

try {
  // 1. What LiveBoard's subscription needs.
  const visible = await anon.from("entries").select("id, pool_id, updated_at").limit(1);
  say(!visible.error, "anon can read id, pool_id, updated_at", visible.error?.message);

  // 2. What must stay hidden.
  const hidden = await anon.from("entries").select("voter").limit(1);
  say(!!hidden.error, "anon cannot read voter", hidden.error ? hidden.error.message : "voter WAS returned");

  const squads = await anon.from("entries").select("xi").limit(1);
  say(!!squads.error, "anon cannot read squads directly", squads.error ? squads.error.message : "xi WAS returned");

  // 3. Writes still refused with the anon key.
  const write = await anon.from("entries").insert({
    pool_id: poolId, voter: "anon-write-test", nick: "x", ...squad,
  });
  say(!!write.error, "anon cannot write entries", write.error ? write.error.message : "INSERT SUCCEEDED");

  // 4. Realtime still reaches a subscriber holding only the anon key.
  const got = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("no event within 10s"), 10000);
    const channel = anon
      .channel(`check-${poolId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "entries", filter: `pool_id=eq.${poolId}` },
        (payload) => { clearTimeout(timer); resolve(payload); })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          // SUBSCRIBED can arrive a moment before the server has the filter in
          // place; inserting immediately races it.
          await new Promise((r) => setTimeout(r, 1500));
          await service.from("entries").insert({
            pool_id: poolId, voter: "realtime-check", nick: "check", ...squad,
          });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          resolve(`subscription ${status}`);
        }
      });
    setTimeout(() => void channel.unsubscribe(), 11000);
  });

  say(typeof got === "object", "anon receives realtime entry changes", typeof got === "string" ? got : "");
  if (typeof got === "object") {
    const leaked = Object.keys(got.new ?? {}).includes("voter");
    say(!leaked, "realtime payload does not carry voter", leaked ? "voter present in payload" : "");
    console.log(`        payload columns: ${Object.keys(got.new ?? {}).join(", ") || "(none)"}`);
  }
} finally {
  await service.from("pools").delete().eq("id", poolId);
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
