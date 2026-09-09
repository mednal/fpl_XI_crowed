# Milestones

Goal: **finish the product properly, then deploy.** Milestones are ordered by
dependency — each one is safe to start once the one above it is done. Tick items as
they land.

Status key: `[ ]` not started · `[~]` in progress · `[x]` done

---

## M0 — Foundations ✅ done

- [x] Next.js 15 + React 19 + TypeScript strict scaffold
- [x] Supabase schema applied (`pools`, `entries`, RLS, realtime publication)
- [x] `.env.local` wired and both keys verified against the REST API
- [x] FPL API client with the 2.3MB→100KB trim and hourly cache
- [x] Pool creation, team picker, server-side validation, live crowd XI
- [x] `GET /api/pools/[id]/scores` returning a scored leaderboard

---

## M1 — Close the security holes

Nothing else ships until these are fixed. Both are exploitable the moment a link is
public.

- [ ] **Entry hijacking.** The `entries are readable` RLS policy exposes the `voter`
      column to the anon key, and `POST /api/pools/[id]/entries` trusts a
      client-supplied `voter` and upserts on `(pool_id, voter)`. Anyone can read a
      voter id off the public table and overwrite that person's squad.
      Fix: stop exposing `voter` publicly — expose a view without it and point the
      realtime subscription at that — and bind the id to something the client cannot
      forge (a signed httpOnly cookie issued on first visit, checked server-side).
- [ ] **No rate limiting.** `POST /api/pools` creates a row per request with no limit;
      `POST /entries` is equally open. Add per-IP limiting to both.
- [ ] Confirm the anon key can still read what `LiveBoard` needs after the policy
      change — the realtime subscription must keep working.

**Done when:** a second browser cannot overwrite the first browser's entry even when
handed its voter id, a scripted loop cannot create unlimited pools, and the live
screen still updates in realtime.

---

## M2 — Get the rules under test

`src/lib/squad.ts` holds every rule and all the crowd maths, is shared by browser and
server, and has no tests. Do this before changing it.

- [ ] Add a test runner (Vitest — no bundler config needed for pure functions) and a
      `npm test` script
- [ ] Cover `validateEntry()`: each rejection reason, and a legal squad passing
- [ ] Cover `crowdXI()`: formation comes out as an output, position caps hold, ties
      break deterministically, and it behaves with 0 and 1 entries
- [ ] Cover `reserve()` — the held-back-money rule is subtle and easy to break
- [ ] CI on push: `npm run build` + `npm test`

**Done when:** `npm test` is green in CI and deliberately breaking a rule in
`squad.ts` makes it fail.

---

## M3 — The leaderboard screen

The endpoint exists and nothing renders it. This is the app's missing third page.

- [ ] Build `/p/[id]/scores` on top of `GET /api/pools/[id]/scores`
- [ ] Show the crowd XI's own score against the field — "the crowd beat 62 of 89
      viewers" is the number worth putting on screen
- [ ] Handle the `{ pending: true }` response before kickoff, and the 503 when the FPL
      live API is down
- [ ] **Scoring fidelity:** the endpoint currently doubles the captain and ignores the
      bench, but does not apply auto-subs or pass the armband to the vice when the
      captain plays no minutes. Decide explicitly whether to implement real FPL
      behaviour or document the simplification on the page. Implementing it needs
      minutes played, which the live endpoint already returns.
- [ ] Link it from `/p/[id]/live` once the gameweek is under way

**Done when:** a host can open the scores page after a gameweek and see a correct,
explainable leaderboard.

---

## M4 — Artwork

Everything is drawn in code today: `KIT_ASSETS` and `BADGE_ASSETS` are empty and
`CHANNEL_LOGO` is null. A part-finished set is fine — clubs left out keep the drawn
shirt.

- [ ] Add kit PNGs to `public/kits/` (transparent, ~256×248) and register the codes
- [ ] Add badges to `public/badges/` (square, ~64×64) and register the codes
- [ ] Set `CHANNEL_LOGO`
- [ ] Check the live screen at stream resolution — it is the one that goes on camera,
      so it has to read at a distance and in both light and dark

**Done when:** all 20 current Premier League clubs have a kit and a badge, and the
live board looks right full-screen.

---

## M5 — Ship it

- [ ] Delete `demo/` — the superseded prototype
- [ ] Full pass on a real gameweek: create a pool, submit from several browsers, watch
      the live screen update, check the leaderboard after the deadline
- [ ] Deploy to Vercel with the three environment variables set
- [ ] Rotate the Supabase `service_role` key on the way out (it has been pasted into a
      template file and a chat transcript during development)
- [ ] Verify `.env.example` contains placeholders only before the first push

**Done when:** a public URL works end to end for a real audience.

---

## Deliberately not doing yet

- **Real sign-in.** Browser-id identity stops casual double-voting, not someone
  determined to use twenty private windows. Only worth building if the count has to be
  exact.
- **Multiple gameweeks per pool.** A pool is pinned to one gameweek by design.
- **Chips (wildcard, triple captain, bench boost).** Out of scope.
