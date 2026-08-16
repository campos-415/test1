-- Boarding request form: the client-facing booking queue.
-- Paste into the Supabase SQL editor and run once. Idempotent.
--
-- NOTE: no apostrophe or quote character appears in any comment below.
-- The Supabase SQL editor splits statements on semicolons with a naive
-- scanner that treats a lone apostrophe in a comment as the start of a
-- string literal, which makes it swallow every following semicolon.

-- A submitted request is a REQUEST, not a booking. Nothing reaches the
-- calendar until staff confirm it on /boarding-requests, which is what
-- creates the real rows in `boardings`.
create table if not exists boarding_requests (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  owner_name text,
  last_name text,
  email text,
  dog_names text[] default '{}',
  -- Promoted out of the JSON so the review list can sort by soonest
  -- drop-off without loading every submission body.
  start_date date not null,
  end_date date not null,
  status text not null default 'pending',
  source text,
  data jsonb not null default '{}'::jsonb,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

alter table boarding_requests enable row level security;

drop policy if exists "allow all" on boarding_requests;

create policy "allow all" on boarding_requests for all using (true) with check (true);

-- The nav badge counts pending rows on every staff page load, and the
-- review list orders by drop-off date.
create index if not exists boarding_requests_status_idx
  on boarding_requests (status, start_date);
