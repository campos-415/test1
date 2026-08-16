-- Enrollment form: new client questionnaire, review queue, and uploads.
-- Paste the whole thing into the Supabase SQL editor and run it once.
-- Every statement is idempotent, so re-running it is harmless.
--
-- NOTE: no apostrophe or quote character appears in any comment below.
-- The Supabase SQL editor splits statements on semicolons using a naive
-- scanner that treats a lone apostrophe in a comment as the start of a
-- string literal, which makes it swallow every semicolon after it and
-- report one confusing syntax error for the whole file.

-- ---------------------------------------------------------------------
-- 1. The review queue. A submitted form is a REQUEST, not a client: the
--    public form is reachable by anyone with the link, so nothing becomes
--    bookable until staff approve it on /enrollments.
-- ---------------------------------------------------------------------
create table if not exists enrollments (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  owner_name text,
  last_name text,
  dog_names text[] default '{}',
  status text not null default 'pending',
  source text,
  -- The whole submitted draft, including the signature and any uploaded
  -- paperwork. Stored as one document so that adding a question to the
  -- form needs no migration.
  data jsonb not null default '{}'::jsonb,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

alter table enrollments enable row level security;

drop policy if exists "allow all" on enrollments;

create policy "allow all" on enrollments for all using (true) with check (true);

-- The nav badge counts pending rows on every staff page load.
create index if not exists enrollments_status_idx on enrollments (status);

-- ---------------------------------------------------------------------
-- 2. Uploaded documents (vaccination records). Their own table on purpose:
--    a multi-megabyte base64 PDF sitting on the dogs row would be
--    dragged into memory by every list page that selects all columns.
-- ---------------------------------------------------------------------
create table if not exists dog_docs (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid references dogs(id) on delete cascade,
  kind text not null default 'vaccination',
  file_name text,
  mime_type text,
  data text,
  created_at timestamptz default now()
);

alter table dog_docs enable row level security;

drop policy if exists "allow all" on dog_docs;

create policy "allow all" on dog_docs for all using (true) with check (true);

create index if not exists dog_docs_dog_idx on dog_docs (dog_id);

-- ---------------------------------------------------------------------
-- 3. Owner-level answers.
-- ---------------------------------------------------------------------
alter table owners add column if not exists vet_name text;
alter table owners add column if not exists vet_phone text;
alter table owners add column if not exists vet_address text;
alter table owners add column if not exists heard_about text;

-- ---------------------------------------------------------------------
-- 4. Dog-level answers. All nullable: dogs added by staff, or imported
--    from a previous system, never answered any of this.
-- ---------------------------------------------------------------------
alter table dogs add column if not exists color text;
alter table dogs add column if not exists flea_program text;
alter table dogs add column if not exists fixed_scheduled_on date;
alter table dogs add column if not exists dog_source text;

alter table dogs add column if not exists growled boolean;
alter table dogs add column if not exists growled_note text;
alter table dogs add column if not exists bitten boolean;
alter table dogs add column if not exists bitten_note text;
alter table dogs add column if not exists climbed_fence boolean;
alter table dogs add column if not exists fence_height text;
alter table dogs add column if not exists dog_fight boolean;
alter table dogs add column if not exists dog_fight_note text;

alter table dogs add column if not exists health_problems boolean;
alter table dogs add column if not exists health_notes text;
alter table dogs add column if not exists activity_restrictions text[] default '{}';
alter table dogs add column if not exists allergies text[] default '{}';
alter table dogs add column if not exists sensitive_areas boolean;
alter table dogs add column if not exists sensitive_areas_note text;

alter table dogs add column if not exists behavior_traits text[] default '{}';
alter table dogs add column if not exists play_style text[] default '{}';
alter table dogs add column if not exists attendance_plan text;
alter table dogs add column if not exists big_dog_response text;
alter table dogs add column if not exists crate_trained boolean;
alter table dogs add column if not exists kennel_trained boolean;

alter table dogs add column if not exists package_interest text;
alter table dogs add column if not exists meet_greet_on date;
alter table dogs add column if not exists enrolled_at timestamptz;

-- Approving an enrollment upserts vaccine dates per dog and vaccine, so
-- that pair has to be unique.
create unique index if not exists vaccinations_dog_vaccine_key
  on vaccinations (dog_id, vaccine);

-- Meet and greet arrival window, chosen alongside the date on the
-- enrollment form. Weekday mornings only; see MEET_GREET_WINDOWS.
alter table dogs add column if not exists meet_greet_window text;
