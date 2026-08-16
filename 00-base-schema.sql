-- The tables everything else is built on.
--
-- These tables existed only as create-table statements scattered through the
-- README, so no migration file created them. A fresh database therefore failed
-- on the very first migration, because it tried to alter a dogs table that
-- nothing had made.
--
-- Column list read out of the live database. Constraints, delete rules and
-- defaults read out of the README, because the live database does not report
-- those over the API and dropping them silently breaks things much later:
-- the unique constraint on owners.phone is what makes on conflict (phone)
-- work, and without it customer-accounts-migration.sql fails and three of the
-- app upserts fail at runtime.
--
-- Worth knowing what this actually is: the live database has every migration
-- already applied, so this is a snapshot of the CURRENT schema, not the
-- historical starting point. Columns that later migrations add are already
-- here. That is harmless - every migration in this repository uses add column
-- if not exists, so they become no-ops rather than errors - but where such a
-- column carries a constraint, that constraint is declared here too. Otherwise
-- the migration adds nothing and the constraint would never exist at all.
--
-- Row level security is switched on with no policies, so the tables are closed
-- until rls-lockdown.sql opens them deliberately. A deployment interrupted
-- half way through is then shut rather than open. The SQL editor runs as the
-- owning role and is not affected, so the migrations in between still work.
--
-- Run this FIRST, before any migration. Safe to run more than once.
--
-- No apostrophe or quote character appears in any comment here, for the
-- Supabase SQL editor reason noted in the other migrations.

-- ---------------------------------------------------------------------
-- The household. Everything else hangs off this, either by owner_id or by
-- the phone number that predates it.
-- ---------------------------------------------------------------------

create table if not exists public.owners (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  owner_name text,
  email text,
  address text,
  emergency_name text,
  emergency_phone text,
  emergency_relation text,
  notes text,
  created_at timestamp with time zone default now(),
  city text,
  state text,
  zip text,
  external_id text,
  vet_name text,
  vet_phone text,
  vet_address text,
  heard_about text,
  user_id uuid references auth.users(id) on delete set null,
  invite_token uuid,
  invited_at timestamp with time zone,
  claimed_at timestamp with time zone
);

create table if not exists public.dogs (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  dog_name text not null,
  last_name text not null,
  drop_off_by text,
  signature_data text,
  created_at timestamp with time zone default now(),
  photo_data text,
  waiver_on_file boolean,
  breed text,
  sex text,
  fixed_status text,
  birthdate date,
  weight_lb numeric,
  vet text,
  authorized_pickup text,
  notes text,
  external_id text,
  photo_filename text,
  default_package_id uuid,
  default_walk_package_id uuid,
  color text,
  flea_program text,
  fixed_scheduled_on date,
  dog_source text,
  growled boolean,
  growled_note text,
  bitten boolean,
  bitten_note text,
  climbed_fence boolean,
  fence_height text,
  dog_fight boolean,
  dog_fight_note text,
  health_problems boolean,
  health_notes text,
  activity_restrictions text[] default '{}',
  allergies text[] default '{}',
  sensitive_areas boolean,
  sensitive_areas_note text,
  behavior_traits text[] default '{}',
  play_style text[] default '{}',
  attendance_plan text,
  big_dog_response text,
  crate_trained boolean,
  kennel_trained boolean,
  package_interest text,
  meet_greet_on date,
  enrolled_at timestamp with time zone,
  meet_greet_window text,
  owner_id uuid references public.owners(id) on delete set null
);

create table if not exists public.boardings (
  id uuid primary key default gen_random_uuid(),
  dog_name text not null,
  last_name text not null,
  phone text not null,
  dog_id uuid,
  start_date date not null,
  end_date date not null,
  feeding_instructions text,
  notes text,
  created_at timestamp with time zone default now(),
  addons text[] default '{}',
  walks_per_day integer,
  bath_size text,
  medication_instructions text,
  photo_data text,
  walk_package_id uuid,
  owner_id uuid references public.owners(id) on delete set null
);

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  client_name text,
  phone text,
  total_days integer not null,
  days_used integer not null default 0,
  created_at timestamp with time zone default now(),
  dog_name text,
  price numeric,
  kind text not null,
  owner_id uuid references public.owners(id) on delete set null
);

create table if not exists public.signins (
  id uuid primary key default gen_random_uuid(),
  dog_name text,
  phone text,
  drop_off_by text,
  last_name text,
  action text,
  service_type text,
  addons text[] default '{}',
  package_id uuid,
  dog_id uuid,
  signature_data text,
  created_at timestamp with time zone default now(),
  pick_up_by text,
  price numeric,
  bath_size text,
  walk_out text,
  walk_in text,
  walk_staff_initials text,
  pickup_window text,
  by_staff boolean default false,
  meet_greet_result text,
  meet_greet_note text,
  staff_note text,
  package_opt_out boolean,
  meals text[] default '{}',
  meals_given text[] default '{}',
  owner_id uuid references public.owners(id) on delete set null
);

-- ---------------------------------------------------------------------
-- Money and packages.
-- ---------------------------------------------------------------------

create table if not exists public.package_uses (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references public.packages(id) on delete cascade,
  dog_id uuid,
  signin_id uuid,
  dog_name text,
  used_on date not null default current_date,
  created_at timestamp with time zone default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  dog_id uuid,
  amount numeric not null,
  method text,
  note text,
  paid_on date not null default current_date,
  created_at timestamp with time zone default now(),
  owner_id uuid references public.owners(id) on delete set null
);

-- ---------------------------------------------------------------------
-- Care records. The unique constraints here are load-bearing: the app writes
-- all three with upsert and names these exact columns as the conflict target.
-- ---------------------------------------------------------------------

create table if not exists public.vaccinations (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid references public.dogs(id) on delete cascade,
  vaccine text not null,
  given_on date,
  expires_on date,
  created_at timestamp with time zone default now(),
  unique (dog_id, vaccine)
);

create table if not exists public.walk_logs (
  id uuid primary key default gen_random_uuid(),
  boarding_id uuid references public.boardings(id) on delete cascade,
  date date not null,
  walk_index integer not null default 0,
  walk_out text,
  walk_in text,
  staff_initials text,
  created_at timestamp with time zone default now(),
  dog_id uuid references public.dogs(id) on delete cascade,
  dog_name text,
  unique (boarding_id, date, walk_index)
);

create table if not exists public.meal_logs (
  id uuid primary key default gen_random_uuid(),
  boarding_id uuid references public.boardings(id) on delete cascade,
  date date not null,
  meal_type text not null,
  fed boolean not null default false,
  notes text,
  created_at timestamp with time zone default now(),
  fed_by text,
  unique (boarding_id, date, meal_type)
);

-- ---------------------------------------------------------------------
-- Configuration and import scratch space.
--
-- settings is one row holding one JSON blob, and the check constraint is what
-- keeps it one row. It is created empty on purpose: the app reads it with
-- maybeSingle, falls back to the built-in defaults when there is no row, and
-- writes row 1 the first time staff save anything.
-- ---------------------------------------------------------------------

create table if not exists public.settings (
  id integer primary key default 1,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone default now(),
  constraint settings_singleton check (id = 1)
);

-- Landing area for a bulk vaccination import, matched to dogs by phone and
-- name after the fact. Deliberately has no keys: it holds whatever the
-- spreadsheet had, including rows that match nothing.
create table if not exists public.vaccinations_staging (
  phone text,
  dog_name text,
  vaccine text,
  expires_on date
);

-- ---------------------------------------------------------------------
-- Closed by default. rls-lockdown.sql, the last file in the run order, is
-- what decides who may read and write each of these.
-- ---------------------------------------------------------------------

do $lockdown$
declare
  t text;
begin
  foreach t in array array[
    'owners', 'dogs', 'boardings', 'packages', 'signins', 'package_uses',
    'payments', 'vaccinations', 'walk_logs', 'meal_logs', 'settings',
    'vaccinations_staging'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end
$lockdown$;
