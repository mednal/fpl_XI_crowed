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

## M1 — Close the security holes ✅ done

Nothing else ships until these are fixed. Both are exploitable the moment a link is
public.

- [x] **Entry hijacking.** The `entries are readable` RLS policy exposes the `voter`
      column to the anon key, and `POST /api/pools/[id]/entries` trusts a
      client-supplied `voter` and upserts on `(pool_id, voter)`. Anyone can read a
      voter id off the public table and overwrite that person's squad.
      Fixed in two halves. Identity is now a random id in an httpOnly cookie signed
      with `VOTER_SECRET` (`src/lib/identity.ts`, issued by `src/middleware.ts`); the
      route ignores any `voter` in the body, so an id read off the table cannot be
      replayed. And `voter` is no longer exposed: column privileges cut the anon key
      down to `id, pool_id, updated_at`, which is all the realtime subscription
      needs — a view could not be used because a publication cannot contain one.
- [x] **No rate limiting.** `POST /api/pools` creates a row per request with no limit;
      `POST /entries` is equally open. Add per-IP limiting to both.
      In-memory sliding window (`src/lib/rate-limit.ts`): 8 pools an hour, 30 entry
      submissions per 10 minutes, per IP. Per server instance, so it is a brake on
      scripted abuse rather than an exact quota.
- [x] Confirm the anon key can still read what `LiveBoard` needs after the policy
      change — the realtime subscription must keep working.
      Grants applied to the live project and checked with `npm run verify:anon`:
      realtime events still arrive, and the payload now carries only
      `id, pool_id, updated_at`. Column privileges filter the WAL payload, which is
      the part that had to be proved rather than assumed.

**Done when:** a second browser cannot overwrite the first browser's entry even when
handed its voter id, a scripted loop cannot create unlimited pools, and the live
screen still updates in realtime.

Verified by two scripts, both writing to the real project and cleaning up after
themselves: `npm run verify:identity` (needs `npm run dev`) covers the hijack and the
rate limits — all 15 checks green — and `npm run verify:anon` covers what the anon key
can see and whether realtime events still arrive.

---

## M2 — Get the rules under test ✅ done

`src/lib/squad.ts` holds every rule and all the crowd maths, is shared by browser and
server, and had no tests. Done before changing it.

- [x] Add a test runner (Vitest — no bundler config needed for pure functions) and a
      `npm test` script
      `vitest.config.ts` carries the `@/*` alias and nothing else. Tests are in
      `src/lib/__tests__/`, 94 of them, running in about a second.
- [x] Cover `validateEntry()`: each rejection reason, and a legal squad passing
      Every reachable rejection, plus the boundaries either side of the club cap and
      the budget, plus the early return that stops the later checks dereferencing a
      player who is not in the game. Three of the bounds it checks (more than 5
      defenders, fewer than 2 midfielders, more than 3 forwards) cannot be reached
      from a squad whose 2/5/5/3 counts are right; the defender one is tested from an
      already-illegal 15 and the others are noted as structurally unreachable.
- [x] Cover `crowdXI()`: formation comes out as an output, position caps hold, ties
      break deterministically, and it behaves with 0 and 1 entries
      Vote counts are fed in directly so a test can state exactly how popular each
      player is: 5-2-3 and 3-5-2 both fall out of the votes, the caps hold against
      eight popular defenders, ties resolve by ownership then name, and the result is
      independent of the order entries arrived in. Empty pool gives `0-0-0` and nulls
      rather than throwing.
- [x] Cover `reserve()` — the held-back-money rule is subtle and easy to break
      Including `ignorePos` on a position that is already full, where the count goes
      negative and must contribute nothing.
- [x] CI on push: `npm run build` + `npm test`
      `.github/workflows/ci.yml`, Node 22, `npm ci` then test then build. The build
      gets placeholder Supabase values — it never calls the API, and `isConfigured` is
      all they decide.

Also covered, because they are the same rules seen from the other side:
`validateSquad()` (the browser's copy), and a table asserting the browser and the
server never disagree about whether a squad is legal — invariant 1 has a test now
rather than a promise.

**Done when:** `npm test` is green in CI and deliberately breaking a rule in
`squad.ts` makes it fail.

Checked by mutation rather than assumed: 27 deliberate breakages of `squad.ts` — club
cap moved either way, budget off by a tenth, the crowd XI's base shape hard-coded, the
tiebreak dropped, `reserve` ignoring its `ignorePos` — and every one turned the suite
red. The first pass found a real hole: nothing pinned the club cap at exactly 3, so
raising it to 4 went unnoticed. That is now a boundary test in all three places the
rule appears.

---

## M3 — The leaderboard screen ✅ done

The endpoint existed and nothing rendered it. This was the app's missing third page.

- [x] Build `/p/[id]/scores` on top of `GET /api/pools/[id]/scores`
      The maths moved into `src/lib/scores.ts`, which the page and the route both
      read — a page cannot fetch its own API route without an absolute URL, and two
      copies of the sum would eventually disagree about who won. The page renders on
      the server so the host lands on a finished board, and the client refreshes it
      every minute while the gameweek is still running.
- [x] Show the crowd XI's own score against the field
      "The crowd beat 6 of 11 viewers, which would put it 4th in the table", with the
      crowd's points, formation and captain beside it.
- [x] Handle the `{ pending: true }` response before kickoff, and the 503 when the FPL
      live API is down
      Before kickoff the page says so and offers the live board instead of showing
      everybody on nil. A 503 keeps the banner and explains that nothing is lost.
- [x] **Scoring fidelity:** implemented, rather than documented away.
      `autoSubs()` and `scoreEntry()` are in `squad.ts` with the rest of the rules. A
      starter on nil minutes is replaced by the first bench player who played and
      whose position keeps the XI legal — the shape check is what stops an outfielder
      replacing the keeper or a second keeper coming on, so neither needed a special
      case — and the armband passes to the vice when the captain did not play.
      Both are gated on the gameweek being **settled** (`finished && data_checked` on
      the FPL event). Mid-gameweek, a player on nil minutes has usually just not
      kicked off yet, and subbing them off would put a number on stream that nobody
      can explain. Until then the board says "Provisional" and scores the XI as
      picked. `getLivePoints` became `getLiveStats` to carry minutes, and `Bootstrap`
      now carries every gameweek's `finished` flag rather than only the next one.
- [x] Link it from `/p/[id]/live` once the gameweek is under way
      A Scores button appears in the live topbar once the deadline has passed. It is
      switched on by the browser rather than at render, like the countdown beside it,
      because the server does not know the viewer's clock.

**Done when:** a host can open the scores page after a gameweek and see a correct,
explainable leaderboard.

Checked twice over. 22 new unit tests pin the scoring rules (`squad.score.test.ts`) —
the bench order, the shape constraint refusing an illegal sub, each bench player used
once, the armband moving and staying — and `npm run verify:scores` builds pools
against a real settled gameweek, recomputes every row from the FPL live endpoint
independently of the app, and compares: points, sub counts, who wore the armband, the
ordering, shared ranks on a tie, the crowd's rank and the count it beat, plus the
pending and 404 paths. All 22 checks green against Gameweek 3.

One thing the crowd XI needed spelling out: who it captains and who it picks are two
separate votes, so the most-voted captain is not always in the crowd XI. The armband
goes to the most-voted captain who is actually on the pitch — the same player the live
board draws the C on — because nobody else can be doubled.

Known limitation, not a gap: a viewer cannot order their own bench, so auto-subs come
on in the order the picker fixed (keeper first, then by position). Real FPL lets a
manager rank the three outfield substitutes.

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
- [ ] Deploy to Vercel with the four environment variables set — the three Supabase
      ones plus `VOTER_SECRET`, without which nobody can be identified as themselves
- [ ] Rotate the Supabase `service_role` key on the way out (it has been pasted into a
      template file and a chat transcript during development). Set `VOTER_SECRET`
      explicitly first, or the rotation signs every existing viewer out of their entry.
- [ ] Verify `.env.example` contains placeholders only before the first push

**Done when:** a public URL works end to end for a real audience.

---

## Deliberately not doing yet

- **Real sign-in.** Browser-id identity stops casual double-voting, not someone
  determined to use twenty private windows. Only worth building if the count has to be
  exact.
- **Multiple gameweeks per pool.** A pool is pinned to one gameweek by design.
- **Chips (wildcard, triple captain, bench boost).** Out of scope.
