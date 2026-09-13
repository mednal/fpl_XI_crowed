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

Known limitation, not a gap: the bench is still grouped by position — keeper first,
then defenders, midfielders, forwards — which is the order auto-subs come on in. The
picker now lets a viewer substitute freely and reorder substitutes *within* a position,
but not rank the three outfield substitutes against each other the way real FPL does.

## M3b — Transfer pools ✅ done

The second question the product can ask. The host's own team goes up and the crowd
votes on the transfers, which is the format a channel with an FPL team of its own
actually wants: their squad on screen, and the audience arguing about one swap.

- [x] `pools.kind`, `pools.squad`, `pools.moves` and a `transfers` table, all
      guarded alters and drop-if-exists in the existing style, with the same
      column-privilege treatment `entries` gets — the anon key sees
      `id, pool_id, updated_at` and nothing else — and the same realtime publication.
- [x] `src/lib/transfers.ts`: the sibling of `squad.ts` for the other pool kind.
      Pure, no I/O, imported by browser and server. A transfer is a position-matched
      pair, which is forced by the squad staying 2/5/5/3 rather than chosen for
      convenience, and is what makes the headline stat countable.
- [x] Import a real FPL team. Both endpoints (`entry/{id}/` and
      `entry/{id}/event/{gw}/picks/`) are unauthenticated and were checked live.
      Selling prices are not among them — those need the manager's own login — so a
      player is valued at today's price and the screens say so. The bank is real.
- [x] Build the team by hand instead, reusing `TeamPicker` rather than a second
      copy of the squad rules.
- [x] The viewer's screen: tap a shirt to sell, the rail becomes the players who
      could replace him, the money and the club cap are live. Voting to make *no*
      transfer is a first-class answer, and the board reports it as a share.
- [x] The board: the resulting team on the pitch, the ranked swaps, who the crowd
      wants out, who they want in, and the armband vote. Realtime, coalesced the
      same way the XI board's is.
- [x] 43 tests over the new rules and crowd maths, including that the browser's
      checklist and the server's validation report exactly the same failures.
- [x] **Run the new SQL in Supabase.** Applied. Confirmed by creating a live
      `crowd` pool and a live `transfer` pool through `POST /api/pools` against
      the real project — both succeed now that `kind`/`squad`/`moves` exist.
- [x] A real run: imported a real FPL team (entry 7837341) through
      `GET /api/fpl/entry/[id]`, set it as a pool's squad via `PATCH`, then voted
      a transfer from the browser (`Calvert-Lewin → Wissa`) and two more from
      separate voter identities via the API (`Verbruggen → Steele`,
      `Verbruggen → Forster`). `/p/[id]/live` picked up each vote in realtime —
      coalesced, so a change can take a few seconds to appear, not instant — with
      correct percentages, an "OUT" tally spanning both proposals against
      Verbruggen, and the verdict staying on the first-in transfer on a three-way
      tie, matching invariant 9. Server-side validation also rejected an
      over-budget swap (`Verbruggen → Raya`, £0.1m over the bank) before it could
      reach the vote, matching invariant 1. Test pools deleted afterwards.

**Done when:** a host can put their real FPL team up and watch the crowd's transfers
rank themselves live. ✅

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

- [x] Delete `demo/` — the superseded prototype
      Gone, along with the tooling scratch that had been committed by accident
      (`.impeccable/`, a stackdump, two temp scripts), now gitignored.
- [x] The link has a face. This product is one link pasted into a chat, so the
      preview card is the first thing most viewers see of it. `src/app/icon.svg`
      is the tab mark, and `src/lib/og.tsx` renders the 1200×630 card in the
      board's own palette and typefaces — Anton and Barlow, fetched at render
      time and degrading to a default face if Google does not answer, like every
      other outside call here. `/p/[id]` gets its own card naming the pool, and
      its own title, because that is the URL that actually gets shared.
      `metadataBase` comes from `NEXT_PUBLIC_SITE_URL` or Vercel's own variable —
      a preview card needs absolute URLs, and the deployment has to know its
      address to write them.
- [x] `error.tsx` and `not-found.tsx`, in the board's clothes. Next's defaults are
      a stack trace and a bare 404, and the page they would replace is the one
      pointed at a camera.
- [x] A lint that runs. `npm run lint` was a script with no linter behind it;
      eslint 9 with `next/core-web-vitals` now backs it and CI runs it between the
      tests and the build. Its first pass found dead state in `LiveBoard`, a dead
      helper beside it, an unused memo in `TeamPicker`, and six `any`s in
      `fpl.ts` — the last are now named types for the slice of the FPL payload we
      read, so a field disappearing upstream is a type error rather than an
      undefined on the board.
- [x] Full pass on a real gameweek. Created a `crowd` pool for GW5 (open), picked a
      real squad through the browser's `TeamPicker` and submitted two more entries
      from separate voter identities; `/p/[id]/live` aggregated all three correctly —
      formation as output, per-position tallies, and the captain/vice armband vote.
      `/p/[id]/scores` showed the right "gameweek has not started" state for the open
      pool, and `npm run verify:scores` (22 checks against real, settled Gameweek 3)
      passed in full, covering the leaderboard after a deadline. Test pool deleted
      afterwards.
- [ ] Deploy to Vercel with the four environment variables set — the three Supabase
      ones plus `VOTER_SECRET`, without which nobody can be identified as themselves
- [ ] Rotate the Supabase `service_role` key on the way out (it has been pasted into a
      template file and a chat transcript during development). Set `VOTER_SECRET`
      explicitly first, or the rotation signs every existing viewer out of their entry.
- [ ] Verify `.env.example` contains placeholders only before the first push

**Done when:** a public URL works end to end for a real audience.

---

## M6 — The paid tier, decided

Decisions only. No code in this milestone, and none of it starts before M5 is done —
what is written here is what stops M7 being built in the wrong order.

**Start from what the product is: a poll.** The crowd votes, the most-picked XI goes on
stream. The leaderboard at `/p/[id]/scores` is a bonus a host can put up after the
gameweek; it is not what the app is for. That settles more than it appears to. It rules
out building the paid tier around viewers competing for a title, because viewers are not
competing — they are voting. Anything that turns the crowd into two hundred individual
scoreboards is pulling against the product.

**The auth question.** A subscription needs a customer who persists across devices and
months, and a cookie cannot be billed — so charging means real host accounts. But
nothing in the code forces that now. `supabase/schema.sql` is written as guarded alters
throughout, so an owner column lands later without a backfill, and host accounts bolt
onto the host side without touching the viewer path: the anon key is already read-only
and column-restricted, and every write already goes through a service-role route. The
risk was never a missed migration. It is building tiers before knowing what a host would
pay for.

**The line.** Viewers stay anonymous forever. Hosts get accounts, because hosts are who
pays. Every question below resolves against that line.

**Auth model: claim-after-creation, never sign-in-first.** A pool is still created
anonymously by anyone, as today. Creation mints a signed host key — the same HMAC
pattern already proven in `src/lib/identity.ts`, Web Crypto only, no new dependency —
hashed onto the pool, set as an httpOnly cookie, and shown once as a recovery link.
Signing in later converts that key into an owner. The host key is not a competing idea
to accounts; it is the bridge that keeps the first run frictionless, and it pays for
itself before billing exists by making "the pool was created on the laptop, the board is
on the OBS machine" survivable.

**What a host would actually pay for**, for a poll, in order of confidence:

1. **The broadcast.** Their logo and colours on the board, no product watermark, and a
   transparent overlay URL that drops into OBS as a browser source. The host's need is
   that their stream looks like theirs. `CHANNEL_LOGO` is a global constant today (M4),
   so this is already half-shaped.
2. **Scale.** A free cap of around a hundred votes per poll, lifted when paid. It
   self-selects — a hobbyist with thirty viewers never pays and is the marketing, a
   channel with five thousand concurrent hits the cap inside a minute and has budget.
   And it is cost control, not only pricing: every vote is rows, realtime fan-out and
   payload, so an uncapped free tier makes the largest channels the most expensive to
   serve.
3. **A channel page.** The host's past polls in one place, and the crowd's own running
   record beside them — what the crowd XI scored each week against the average viewer,
   and how often it won. "Can the chat beat the average?" is a story a host can tell
   every week, and it is the poll-shaped version of a reason to come back: one team's
   record, the channel's team, rather than a table of individuals.

|                  | Free                          | Paid                              |
|------------------|-------------------------------|-----------------------------------|
| Polls            | unlimited                     | unlimited                         |
| Votes per poll   | ~100                          | unlimited                         |
| Board            | drawn kits, product watermark | channel logo and colours, no mark |
| OBS              | the normal page               | transparent overlay URL           |
| History          | the poll, until it is gone    | channel page and crowd record     |

Price is deliberately left open. It needs a real host to react to, not a number guessed
into a repo.

**The crowd record needs no viewer identity at all** — not accounts, not even the
existing cookie. Every figure in it is per-poll and already computable: what the crowd
XI scored, what the average viewer scored, which won. Grouping those by host is the only
new thing. This is worth writing down because the obvious design — following individual
viewers across gameweeks — would have quietly put the app in the business of tracking
people, for a feature the product does not need.

**What the schema will need**, all guarded alters in the existing style: an owner on
`pools`, the host key hash beside it, and a table mapping an account to its billing
customer and plan. A host's polls group by owner, so nothing else is required to make
the channel page work. Columns and names are M7's problem. What M6 settles is that none
of it needs backfilling.

**Done when:** the tiers above have been put in front of at least one real host and have
either survived or been rewritten here. This milestone is finished by a conversation,
not a commit.

---

## M7 — Build the business

Ordered so each step stands on its own and the things worth paying for exist before
there is anything to pay. Gated on M5 shipping and real hosts having used the free
product on a real gameweek — what they complain about is allowed to reorder this list.

- [ ] **Host key and pool ownership.** No accounts yet. Unlocks the recovery link and
      the first host-only surface. Half-landed already: `pools.host_voter` makes the
      browser that opened a pool its host, which is what the closing time and the
      close-now button on the board are checked against. What is still missing is a
      key the host can carry to another browser, and the recovery link built on it.
- [ ] **Host accounts, by claim.** Magic link and Google. Host-key pools become
      claimable; the owner column starts being populated.
- [ ] **Branding and the OBS overlay.** Per-host `CHANNEL_LOGO`, plus the transparent
      board URL. The clearest paid value for a poll, so it is built early and given away
      until there is billing to put behind it.
- [ ] **The channel page.** A host's past polls, and the crowd's running record against
      the average viewer.
- [ ] **Billing and entitlements.** Subscription lifecycle by webhook; entitlement
      checked at poll creation and at the vote cap.

The first four are worth doing whether or not billing ever ships. The last is the only
purely commercial one, and it is last on purpose.

**Done when:** a host can sign in, put their own branding on the board, see their
channel's record, and pay to lift the vote cap.

---

## Deliberately not doing yet

- **Viewer sign-in — not ever.** Browser-id identity stops casual double-voting, not
  someone determined to use twenty private windows — and twenty throwaway emails defeat
  sign-in just as easily, so it buys an accuracy it cannot actually deliver, at the cost
  of the one thing the product sells: a vote cast sixty seconds after clicking a link.
  The crowd is the reach, not the customer. Host sign-in is a separate question, answered
  in M6.
- **Following a viewer across gameweeks.** The cookie would allow it and the app will
  not use it. A poll does not need to know that this browser also voted last week, and
  the one feature that looked like it needed it — the crowd's season record — turns out
  not to (M6).
- **Multiple gameweeks per pool.** A pool is pinned to one gameweek by design. The
  channel page in M7 spans gameweeks by grouping polls, not by unpinning one.
- **Chips (wildcard, triple captain, bench boost).** Out of scope.
