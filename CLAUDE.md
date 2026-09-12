# CLAUDE.md

Context for Claude Code working in this repo. Keep it short — it loads every session.

## What this is

**Crowd XI.** A host shares one link and the audience votes on a team. Next.js 15
(App Router) + React 19 + Supabase. No auth — identity is a random id in the
viewer's browser.

There are two kinds of pool, and `pools.kind` says which:

- **`crowd`** — the original. Every viewer builds a real FPL squad; the most-picked
  XI and captain appear live on a results screen the host puts on stream.
- **`transfer`** — the host's *own* team goes up, imported from FPL or built here,
  and the crowd votes on the transfers they should make. The board ranks who the
  crowd wants out, who they want in, and the most-backed swap: "Haaland → João
  Pedro, 10%".

The two share the pool, the lock, the identity cookie, the pitch and the rail. What
differs is the question, so they have separate rule modules, tables and screens.

Player data, prices and deadlines come from the official FPL API, which is
unauthenticated and can go down. Every path that touches it must degrade, not crash.

## Commands

```bash
npm run dev      # dev server, reads .env.local
npm run build    # production build — run before claiming a change works
npm run lint
npm test         # Vitest, the rules in src/lib/squad.ts
npm run test:watch
npm run verify:scores   # leaderboard vs. real FPL data; needs npm run dev
```

Tests live in `src/lib/__tests__/`. They cover `squad.ts` only — it is pure, shared by
browser and server, and the one file where a quiet mistake becomes a wrong team on
stream. Change a rule there and a test should go red; if none does, the rule was not
pinned and the test is the missing half of the change. CI (`.github/workflows/ci.yml`)
runs `npm test` then `npm run build` on every push.

## Environment

`.env.local` (gitignored) holds the three Supabase values. `.env.example` is the
committed template and **must never contain real keys**. `SUPABASE_SERVICE_ROLE_KEY`
is server-only — never import `getServiceClient()` from a component.

`src/lib/supabase.ts` exports `isConfigured`; pages check it and render a banner
rather than throwing when keys are absent.

## Architecture

```
Browser ──picks squad──> POST /api/pools/[id]/entries ──validated──> Supabase
   │                              (service role key)                    │
   └──anon key, realtime subscribe on `entries` ───────────────────────┘
```

- **`src/lib/squad.ts`** — all squad rules and crowd maths. Imported by *both* the
  browser (instant feedback while picking) and the server (the decision that counts).
  Pure functions, no I/O. This is the file to be most careful in.
- **`src/lib/fpl.ts`** — FPL API, trimmed and cached. The raw payload is ~2.3MB, over
  Next's 2MB response-cache limit, so it is fetched `no-store`, cut to ~100KB, and
  *that* is wrapped in `unstable_cache`. Do not naively cache the fetch.
- **`src/lib/transfers.ts`** — everything a transfer pool decides: what a legal
  transfer is, what it costs, and the crowd maths over the votes. Pure, imported by
  both the browser and the server, and the sibling of `squad.ts` — the same
  arrangement, for the other kind of pool. Under test.
- **`src/lib/lock.ts`** — whether a pool is still taking teams, and what closing
  time a host may set. Pure, and imported by the picker, the board and the routes,
  so none of them can disagree about a pool being open. Under test.
- **`src/lib/pools.ts`** — DB reads, `server-only`.
- **`src/lib/scores.ts`** — the leaderboard, `server-only`. Read by both the scores
  page and its API route so the two can never disagree about who won.
- **`src/lib/og.tsx`** — the link-preview card, drawn with `next/og` in the board's
  palette. `src/app/opengraph-image.tsx` is the site card, `src/app/p/[id]/` the
  per-pool one. Absolute URLs need `metadataBase`, set in the root layout.
- **`src/app/api/`** — every write. The browser never writes to Supabase directly.
- **`src/components/`** — `TeamPicker` (picking; also builds a host's base team when
  given `onHostSave`), `LiveBoard` (results), `Scoreboard` (the leaderboard),
  `TransferPicker`/`TransferBoard`/`HostSetup`/`HostTeam` (the transfer pool's
  screens: vote, board, put a team up, change the one that is up),
  `SlotMenu` (the box a shirt opens, shared by both pickers),
  `SquadPitch` (a whole fifteen drawn read-only, shared by all three),
  `Pitch`/`Kit` (drawn shirts), `assets.ts` (artwork manifest).

A transfer pool's own pieces: `POST /api/pools` takes `kind` and `moves`;
`PATCH /api/pools/[id]` takes the host's `squad`; `POST /api/pools/[id]/transfers`
is the vote; `GET /api/fpl/entry/[id]` imports a real FPL team. The host sets up at
`/p/[id]/setup`, changes that team at `/p/[id]/manage`, viewers vote at `/p/[id]`,
and the board is the same `/p/[id]/live`.

Styling is plain CSS in `src/app/globals.css` with CSS custom properties and a
light/dark palette. No Tailwind, no CSS-in-JS — match that.

## Invariants

1. **Never trust the client.** `validateEntry()` re-checks a submitted squad from
   scratch against live prices. `validateSquad()` is the browser's convenience copy;
   changing a rule means changing both.
2. **Identity comes from the cookie, never the body.** A viewer is a random id in a
   signed httpOnly cookie (`src/lib/identity.ts`, issued by `src/middleware.ts`).
   `entries.voter` is not readable with the anon key — the anon key sees only
   `id, pool_id, updated_at`, which is what the realtime subscription needs.
3. **The formation is an output, unless the host fixed one.** Left alone, `crowdXI()`
   fills the legal minimum (1-3-2-1) then the four best remaining, capped
   5 DEF / 5 MID / 3 FWD. A host who chooses a shape when they create the pool
   (`pools.formation`, one of `FORMS`) gets exactly that shape, each row filled by
   its own most-picked players; it changes the board only, never what a viewer may
   pick. Never hard-code a shape anywhere else.
4. **The crowd XI is a hall of fame, not a squad.** Budget, bench and club cap
   constrain what a viewer may *pick* — `validateEntry()` enforces all three on every
   entry, and that must never soften. They do not apply to the aggregate, which
   answers a different question: who the crowd wants in each position. A crowd XI
   costing £130m with six Liverpool players is a correct result. Never "fix" it by
   filtering `crowdXI()`, and never present its cost or its club counts as a rule
   being broken — dropping a player who won the vote makes the board show a team
   nobody picked.
5. **Deadlines lock writes, and so does the host.** A pool shuts at
   `pools.deadline` — the official FPL deadline unless the host chose an earlier
   one, and never a later one, because past it the game has started — or the
   moment the host sets `pools.closed_at` from the board. `poolLock()` is the
   single answer to "is this pool open"; the entries route is where it counts and
   the picker's copy only saves a round trip. There are no accounts, so the host
   is the browser that opened the pool: `pools.host_voter` holds its signed viewer
   id and `PATCH /api/pools/[id]` checks the cookie against it before moving a
   deadline or closing anything.
6. **`supabase/schema.sql` must stay re-runnable.** It is guarded with
   `if not exists` / `drop policy if exists` throughout. Keep new statements guarded.
7. **Pool ids** use an alphabet with no look-alike characters (`ALPHABET` in
   `api/pools/route.ts`) because people read them aloud.
8. **A transfer is a position-matched pair.** `out_ids[i]` is sold to sign
   `in_ids[i]`, and the two are always the same position. This is not a
   simplification: a squad must stay 2/5/5/3, so the positions leaving and arriving
   have to match as multisets, and every legal set of transfers can therefore be
   written as pairs. Writing them that way is what makes "Haaland → João Pedro, 10%"
   countable rather than a guess at which sale paid for which signing.
9. **The crowd's transfers are a vote, not a plan.** `crowdTransfers()` applies the
   winning swaps in vote order, up to the pool's allowance, skipping only those that
   need a player an earlier swap already used — nobody is sold or signed twice.
   It never drops a swap for being unaffordable or for stacking a club: that is
   invariant 4 again, seen from the other side. The resulting bank and club counts
   come back alongside for the board to point at, and a negative bank is *reported*.
   Replacing the winner with the runner-up would put a transfer on stream that
   nobody voted for.
10. **The host acts on the vote; the crowd never acts on the team.** Only
    `/p/[id]/manage` changes the fifteen, and `PATCH` tells two edits apart:
    rearranging the same fifteen — a substitution, the armband, the shape — is
    saveable whenever, because every vote still names a player who is there;
    changing *who is in* the squad waits until voting is shut, which is when a
    host makes the transfer anyway. On the board those edits are a trial and
    nothing else: the host may try the crowd's swaps and sub the eleven around
    on their own screen, and none of it is written or shown to a viewer.
    `crowdTransfers()` skips a swap the current squad cannot make, so once the
    host has acted the board stops counting money for a sale already made.
11. **Selling prices are today's prices.** FPL only reveals a player's selling price
    to the manager who owns him, behind his login, so `transfers.ts` values a player
    at his current price on both sides of the trade. The bank is real — it comes
    back with the imported picks. The screens say so rather than assuming quietly.

## Conventions

- TypeScript strict. Imports use the `@/*` path alias.
- Player fields are deliberately short (`n`, `pos`, `pts`, `sel`) — the payload is sent
  to every viewer. Keep new fields terse.
- Money is in FPL tenths (`1000` = £100.0m). Use `money()` to display it.
- Comments explain *why*, not *what*, and are sparse. Match that density.
- User-facing error strings are full sentences that say what to do next.

## Current state

Working end to end: pool creation, picking, server-side validation, live crowd XI,
realtime updates, host controls (a custom closing time and a close-now button on
the board), and the leaderboard at `/p/[id]/scores`. Both Supabase keys are verified.

**Transfer pools are built but their schema is not applied.** The code, the rules
and the tests are in; the `pools` columns and the `transfers` table at the bottom of
`supabase/schema.sql` still have to be run in the Supabase SQL editor. Until they
are, *every* pool creation fails, because the insert now names `kind` and `moves`. M1 (identity, rate limiting), M2 (`squad.ts` under test,
CI) and M3 (the leaderboard screen, with real auto-subs) are done. M5 has started
ahead of the artwork: the prototype is deleted, the link has an icon and a preview
card, `error.tsx`/`not-found.tsx` wear the board's clothes, and `npm run lint` has a
linter behind it and runs in CI. What is left there is the real-gameweek pass, the
Vercel deploy and the key rotation.

**What we are going to do:** finish the product properly before it goes near a real
audience — close the security holes, get the rules under test, build the leaderboard
screen, add real artwork, then deploy. The plan, in order, with acceptance criteria,
is in [MILESTONES.md](MILESTONES.md). Read it before starting feature work, and tick
items off there as they land.

## Gotchas

- `next dev` will silently pick port 3001 if 3000 is busy. Check the log before
  assuming which server you are hitting.
- Auto-subs and the vice-captain fallback only apply once the FPL event is **settled**
  (`finished && data_checked`). Mid-gameweek, nil minutes usually means the player has
  not kicked off yet, so the board says "Provisional" and scores the XI as picked.
  Do not "fix" this by always applying them.
