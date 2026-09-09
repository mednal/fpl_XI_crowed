# CLAUDE.md

Context for Claude Code working in this repo. Keep it short — it loads every session.

## What this is

**Crowd XI.** A host shares one link; every viewer builds a real FPL squad; the
most-picked XI and captain appear live on a results screen the host puts on stream.
Next.js 15 (App Router) + React 19 + Supabase. No auth — identity is a random id in
the viewer's browser.

Player data, prices and deadlines come from the official FPL API, which is
unauthenticated and can go down. Every path that touches it must degrade, not crash.

## Commands

```bash
npm run dev      # dev server, reads .env.local
npm run build    # production build — run before claiming a change works
npm run lint
npm test         # Vitest, the rules in src/lib/squad.ts
npm run test:watch
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
- **`src/lib/pools.ts`** — DB reads, `server-only`.
- **`src/app/api/`** — every write. The browser never writes to Supabase directly.
- **`src/components/`** — `TeamPicker` (picking), `LiveBoard` (results), `Pitch`/`Kit`
  (drawn shirts), `assets.ts` (artwork manifest).

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
3. **The formation is an output.** `crowdXI()` fills the legal minimum (1-3-2-1) then
   the four best remaining, capped 5 DEF / 5 MID / 3 FWD. Never hard-code a shape.
4. **Deadlines lock writes.** Entries are rejected once `pools.deadline` has passed.
5. **`supabase/schema.sql` must stay re-runnable.** It is guarded with
   `if not exists` / `drop policy if exists` throughout. Keep new statements guarded.
6. **Pool ids** use an alphabet with no look-alike characters (`ALPHABET` in
   `api/pools/route.ts`) because people read them aloud.

## Conventions

- TypeScript strict. Imports use the `@/*` path alias.
- Player fields are deliberately short (`n`, `pos`, `pts`, `sel`) — the payload is sent
  to every viewer. Keep new fields terse.
- Money is in FPL tenths (`1000` = £100.0m). Use `money()` to display it.
- Comments explain *why*, not *what*, and are sparse. Match that density.
- User-facing error strings are full sentences that say what to do next.

## Current state

Working end to end: pool creation, picking, server-side validation, live crowd XI,
realtime updates, and a `/api/pools/[id]/scores` endpoint. Schema is applied and both
Supabase keys are verified. M1 (identity, rate limiting) and M2 (`squad.ts` under
test, CI) are done; the leaderboard screen is next.

**What we are going to do:** finish the product properly before it goes near a real
audience — close the security holes, get the rules under test, build the leaderboard
screen, add real artwork, then deploy. The plan, in order, with acceptance criteria,
is in [MILESTONES.md](MILESTONES.md). Read it before starting feature work, and tick
items off there as they land.

## Gotchas

- `demo/` is the earlier single-file prototype. It is excluded from `tsconfig` and is
  not part of the build. Do not edit it; it gets deleted in Milestone 5.
- `next dev` will silently pick port 3001 if 3000 is busy. Check the log before
  assuming which server you are hitting.
- The `scores` endpoint scores an XI FPL-style but does **not** apply auto-subs or the
  vice-captain fallback when the captain plays no minutes. That is a known gap, not an
  oversight — see Milestone 3.
