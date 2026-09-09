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
