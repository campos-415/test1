-- Photos for the public website, uploaded from /settings.
-- Paste into the Supabase SQL editor and run once. Safe to run again.
--
-- Their own table rather than a field on the settings row: settings are
-- loaded by every page in the app, including the lobby kiosk, and a dozen
-- base64 photos in there would be fetched constantly by screens that never
-- show them. Only the website reads this.
--
-- This creates the table the gallery, the home hero, the About hero and the
-- team cards all read. Without it every one of those falls back to the stock
-- images the app shipped with, and the uploaders on the settings page fail
-- silently, because a missing table is treated as no photos rather than as an
-- error.
--
-- The policies below match rls-lockdown.sql on purpose. An earlier version of
-- this file finished with a blanket allow-all policy, which was fine when it
-- ran before the lockdown and quietly wrong afterwards: the table would have
-- been the one thing in the database anyone could write to.
--
-- No apostrophe, quote or dollar-quoted block appears in any comment here,
-- for the Supabase SQL editor reason noted in the other migrations.

create table if not exists site_photos (
  id uuid primary key default gen_random_uuid(),
  -- gallery, hero, about, team.
  kind text not null default 'gallery',
  -- Alt text. Not optional in spirit: it is what a screen reader announces
  -- and what search engines index the image by.
  alt text,
  data text not null,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

-- Kind-specific fields. Team cards carry a name, role and bio alongside the
-- portrait; hero images need none of it. One JSON column keeps a single table
-- serving every placement instead of one table per placement.
alter table site_photos add column if not exists meta jsonb default '{}'::jsonb;

create index if not exists site_photos_kind_idx on site_photos (kind, sort_order);

alter table site_photos enable row level security;

-- Remove anything an earlier run of this file or of the lockdown left behind.
drop policy if exists "allow all" on site_photos;
drop policy if exists "staff full access" on site_photos;
drop policy if exists "public read" on site_photos;

-- Any signed-in account manages the photos. Staff and the kiosk are both real
-- accounts, so one rule covers them.
create policy "staff full access" on site_photos
  for all to authenticated using (true) with check (true);

-- The website is public and these are the images on it.
create policy "public read" on site_photos
  for select to anon using (true);

-- ---------------------------------------------------------------------
-- Check. Expect exactly two rows: staff full access for authenticated,
-- and public read for anon.
-- ---------------------------------------------------------------------
select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public' and tablename = 'site_photos'
order by policyname;
