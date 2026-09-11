-- Crowd XI — run this once in your Supabase project's SQL editor.

create table if not exists pools (
  id          text primary key,
  name        text not null,
  host        text,
  gw          integer not null,
  budget      boolean not null default true,
  deadline    timestamptz,
  created_at  timestamptz not null default now()
);

-- The shape the results board is drawn in. Null — the default — lets the
-- most-picked players decide it. Added after the first pools existed, so it is
-- a guarded alter rather than a column in the create above.
alter table pools add column if not exists formation text;

-- Host controls. There are no accounts, so the host of a pool is the browser
-- that opened it: `host_voter` holds that browser's signed viewer id, and only
-- a request carrying the matching cookie may move the deadline or close the
-- pool. `closed_at` is the host stopping it by hand mid-stream, ahead of a
-- deadline that has not arrived yet; clearing it reopens the pool.
alter table pools add column if not exists host_voter text;
alter table pools add column if not exists closed_at  timestamptz;

create table if not exists entries (
  id          uuid primary key default gen_random_uuid(),
  pool_id     text not null references pools(id) on delete cascade,
  voter       text not null,              -- a per-browser id, so a viewer can edit their own team
  nick        text not null default 'Anonymous',
  formation   text not null,
  xi          integer[] not null,
  bench       integer[] not null,
  captain     integer not null,
  vice        integer not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (pool_id, voter)
);

create index if not exists entries_pool_idx on entries (pool_id);

-- Row level security: the public may READ pools and entries, which is what lets
-- the results screen subscribe to live updates with the anon key. Nothing may be
-- written with the anon key — every insert and update goes through an API route
-- using the service role key, after the squad has been validated server-side.
alter table pools   enable row level security;
alter table entries enable row level security;

drop policy if exists "pools are readable"   on pools;
drop policy if exists "entries are readable" on entries;

create policy "pools are readable"   on pools   for select using (true);
create policy "entries are readable" on entries for select using (true);

-- Column privileges on top of that policy. `voter` says which browser owns an
-- entry: exposed to the anon key, reading one off this table was enough to
-- submit over that person's team. The anon key now sees only the three columns
-- the results screen's realtime subscription needs — it filters on pool_id and
-- then refetches the teams through the API — and the squads themselves are
-- served by a route using the service role key.
revoke select on entries from anon, authenticated;
grant  select (id, pool_id, updated_at) on entries to anon, authenticated;

-- `pools.host_voter` says which browser may move the deadline or close the
-- pool, so it gets the same treatment: every pool read in the app goes through
-- the service role, and the anon key sees the row without that column.
revoke select on pools from anon, authenticated;
grant  select (id, name, host, gw, budget, formation, deadline, closed_at, created_at)
  on pools to anon, authenticated;

-- Realtime: push entry changes to subscribed results screens. Guarded so the
-- whole file stays safe to re-run — adding a table twice is an error.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'entries'
  ) then
    alter publication supabase_realtime add table entries;
  end if;
end $$;

-- ============================ transfer pools ============================
-- A second kind of pool. Instead of the crowd building an XI from nothing, the
-- host puts up their own team — imported from FPL or built here — and the crowd
-- votes on the transfers they should make. Everything the two kinds share stays
-- on `pools`; only what a transfer pool needs is added here, guarded like the
-- rest of the file.
--
-- `kind`  'crowd' (the original poll) or 'transfer'.
-- `squad` the host's fifteen, their bank, and where it was imported from. Null
--         until the host has set it, which is what the setup screen is for.
-- `moves` how many transfers each viewer may propose. Null means one.
alter table pools add column if not exists kind  text not null default 'crowd';
alter table pools add column if not exists squad jsonb;
alter table pools add column if not exists moves integer;

-- One viewer's proposed transfers. `out_ids` and `in_ids` are parallel: index i
-- of one is sold for index i of the other, and the pair is always the same
-- position. That is not a house rule — a squad has to stay 2/5/5/3, so any
-- legal set of transfers can be written as position-matched pairs — and it is
-- what makes "Haaland → João Pedro, 10%" a countable thing rather than a
-- guess at which sale paid for which signing.
create table if not exists transfers (
  id          uuid primary key default gen_random_uuid(),
  pool_id     text not null references pools(id) on delete cascade,
  voter       text not null,
  nick        text not null default 'Anonymous',
  out_ids     integer[] not null default '{}',
  in_ids      integer[] not null default '{}',
  captain     integer,                     -- null: keep the host's captain
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (pool_id, voter)
);

create index if not exists transfers_pool_idx on transfers (pool_id);

alter table transfers enable row level security;
drop policy if exists "transfers are readable" on transfers;
create policy "transfers are readable" on transfers for select using (true);

-- Same treatment as `entries`: `voter` says who owns a row, so the anon key
-- sees only what the realtime subscription needs and the rows themselves are
-- served by a route holding the service role key.
revoke select on transfers from anon, authenticated;
grant  select (id, pool_id, updated_at) on transfers to anon, authenticated;

-- The three new pool columns join the anon grant. `squad` is the host's team,
-- which every viewer has to see in order to transfer anything.
grant select (kind, squad, moves) on pools to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'transfers'
  ) then
    alter publication supabase_realtime add table transfers;
  end if;
end $$;
