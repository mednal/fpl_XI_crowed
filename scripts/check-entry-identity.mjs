/**
 * M1 check: nobody can submit over somebody else's team, and neither write route
 * is unlimited. Needs a dev server running — `npm run dev`, then
 * `npm run verify:identity` (BASE=http://localhost:3001 if it picked another port).
 *
 * It writes to the real Supabase project and deletes the pools it creates. The
 * rate-limit checks are last because they leave that IP's buckets full: restart
 * the dev server before running it a second time.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
for (const line of readFileSync("./.env.local","utf8").split(/\r?\n/)) {
  const m=/^([A-Z_]+)=(.*)$/.exec(line.trim()); if(m) process.env[m[1]]=m[2];
}
const BASE = process.env.BASE ?? "http://localhost:3000";
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false}});
const made = [];
let fails = 0;
const say=(ok,l,d="")=>{ if(!ok) fails++; console.log(`${ok?"  ok  ":" FAIL "} ${l}${d?`  — ${d}`:""}`); };

// --- a legal 15 built from live FPL data
const boot = await (await fetch("https://fantasy.premierleague.com/api/bootstrap-static/")).json();
const players = boot.elements.filter(e=>e.status !== "u").map(e=>({id:e.id,pos:e.element_type,team:e.team,cost:e.now_cost}));
const need = {1:2,2:5,3:5,4:3};
const club={}; const picked={1:[],2:[],3:[],4:[]};
for (const p of [...players].sort((a,b)=>a.cost-b.cost)) {
  if (picked[p.pos].length >= need[p.pos]) continue;
  if ((club[p.team]??0) >= 3) continue;
  picked[p.pos].push(p); club[p.team]=(club[p.team]??0)+1;
}
const xi = [picked[1][0], ...picked[2].slice(0,4), ...picked[3].slice(0,4), ...picked[4].slice(0,2)].map(p=>p.id);
const bench = [picked[1][1], picked[2][4], picked[3][4], picked[4][2]].map(p=>p.id);
const squad = { formation:"4-4-2", xi, bench, captain: xi[5], vice: xi[6] };

// --- 1. create a pool
const create = await fetch(`${BASE}/api/pools`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:"smoke",budget:true})});
const pool = await create.json();
say(create.ok && pool.id, "pool created", pool.error ?? "");
if (!pool.id) process.exit(1);
made.push(pool.id);

// --- 2. victim submits, with no cookie of their own yet
const v1 = await fetch(`${BASE}/api/pools/${pool.id}/entries`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nick:"Victim",...squad})});
const v1body = await v1.json();
say(v1.ok, "victim submitted a team", v1body.error ?? "");
const victimCookie = (v1.headers.get("set-cookie")??"").split(";")[0];
say(victimCookie.startsWith("cxi_voter="), "server issued a signed cookie", victimCookie ? "" : "no set-cookie header");

const { data: rows1 } = await service.from("entries").select("voter, nick").eq("pool_id", pool.id);
const victimVoter = rows1?.[0]?.voter;
say(rows1?.length === 1, "one entry stored", `${rows1?.length} rows`);

// --- 3. the old attack: a second browser sends the victim's voter id
const attack = await fetch(`${BASE}/api/pools/${pool.id}/entries`, {
  method:"POST", headers:{"Content-Type":"application/json"},
  body: JSON.stringify({ voter: victimVoter, nick:"Attacker", ...squad }),
});
say(attack.ok, "attacker's own submission accepted (it becomes their own entry)", (await attack.clone().json()).error ?? "");
const { data: rows2 } = await service.from("entries").select("voter, nick").eq("pool_id", pool.id);
const victimRow = rows2?.find(r=>r.voter===victimVoter);
say(victimRow?.nick === "Victim", "victim's entry NOT overwritten", `victim row is now "${victimRow?.nick}"`);
say(rows2?.length === 2, "attacker got a separate entry", `${rows2?.length} rows`);

// --- 4. a forged cookie is refused, and falls back to a fresh identity
const forged = await fetch(`${BASE}/api/pools/${pool.id}/entries`, {
  method:"POST", headers:{"Content-Type":"application/json", cookie:`cxi_voter=${victimVoter}.notarealsignature`},
  body: JSON.stringify({ nick:"Forger", ...squad }),
});
say(forged.ok, "forged cookie request handled", (await forged.clone().json()).error ?? "");
const { data: rows3 } = await service.from("entries").select("voter, nick").eq("pool_id", pool.id);
say(rows3?.find(r=>r.voter===victimVoter)?.nick === "Victim", "forged cookie did NOT overwrite the victim");

// --- 5. the victim's real cookie still edits their own entry
const edit = await fetch(`${BASE}/api/pools/${pool.id}/entries`, {
  method:"POST", headers:{"Content-Type":"application/json", cookie: victimCookie},
  body: JSON.stringify({ nick:"Victim edited", ...squad }),
});
say(edit.ok, "victim can still edit with their cookie", (await edit.clone().json()).error ?? "");
const { data: rows4 } = await service.from("entries").select("voter, nick").eq("pool_id", pool.id);
say(rows4?.find(r=>r.voter===victimVoter)?.nick === "Victim edited", "edit landed on the victim's own entry");
say(rows4?.length === 3, "no extra entry created by the edit", `${rows4?.length} rows`);

// --- 6. GET must not leak voter
const listed = await (await fetch(`${BASE}/api/pools/${pool.id}/entries`)).json();
say(!JSON.stringify(listed).includes(victimVoter), "GET /entries does not leak voter ids");

// --- 7. rate limits
let poolStatus = 0, madeCount = 0;
for (let i=0;i<12;i++) {
  const r = await fetch(`${BASE}/api/pools`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:"flood"})});
  poolStatus = r.status;
  if (r.ok) { made.push((await r.json()).id); madeCount++; }
  if (r.status === 429) break;
}
say(poolStatus === 429, "pool creation rate limited", `stopped after ${madeCount} extra pools, status ${poolStatus}`);

let entryStatus = 0;
for (let i=0;i<40;i++) {
  const r = await fetch(`${BASE}/api/pools/${pool.id}/entries`, {method:"POST",headers:{"Content-Type":"application/json",cookie:victimCookie},body:JSON.stringify({nick:"flood",...squad})});
  entryStatus = r.status;
  if (r.status === 429) break;
}
say(entryStatus === 429, "entry submission rate limited", `status ${entryStatus}`);

for (const id of made) await service.from("pools").delete().eq("id", id);
console.log(fails ? `\n${fails} check(s) failed.` : "\nAll checks passed.");
process.exit(fails?1:0);
