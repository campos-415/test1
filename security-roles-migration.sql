-- change Roles in LN365, enforced in the database.
--
-- Until now there was one class of signed-in user. RLS granted
-- authenticated full read and write on every table, so the front desk, the
-- lobby iPad and the owner all had identical power: read every customer
-- record, every payment, every balance, and export the lot.
--
-- This adds the missing thing: a role per account, in a table the database
-- itself reads when it decides whether to allow a statement.
--
--   owner_admin  the business owner. Everything, including permissions,
--                settings and deleting payment records.
--   manager      runs the shift. Money, reservations, packages, deletions,
--                and the bulk exports.
--   employee     day-to-day care. Sign dogs in and out, keep records, read
--                what is needed to look after a dog. No exports, no
--                deletions, no permission or settings changes.
--   kiosk        the wall-mounted iPad in the lobby. Narrower than an
--                employee because nobody is standing next to it: it can
--                sign a dog in and take a payment, and it cannot read the
--                owner table at all.
--
-- The kiosk role is not in the requirements document, which names three
-- roles. It is here because the kiosk is a real account and an unattended
-- public-facing screen should not hold employee-level access to the whole
-- customer database. Treating it as an employee would have been the easy
-- choice and the wrong one.
--
-- RUN ORDER. These four files depend on each other and go in this order:
--
--   1. security-roles-migration.sql    (this file)
--   2. security-audit-migration.sql
--   3. security-exports-migration.sql
--   4. rls-lockdown.sql
--
-- Reverse with security-rollback.sql. Nothing here opens the database: this
-- file only adds a table and functions, and the table is created with RLS
-- on and no policies, which denies everyone until step 4 grants access
-- deliberately.
--
-- Safe to run more than once.
--
-- No apostrophe, quote or dollar-quoted block appears in any comment here,
-- for the Supabase SQL editor reason noted in the other migrations.

-- ---------------------------------------------------------------------
-- 1. Who to seed.
--
-- EDIT THIS before running. Every existing account needs a role or its
-- owner is locked out the moment step 4 runs, and an account not listed
-- here gets no role and therefore no access. The block at the end refuses
-- to finish if the list would leave the business with no owner_admin, so a
-- typo here fails loudly instead of locking everybody out.
-- ---------------------------------------------------------------------

create table if not exists public.staff_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null,
  -- When true, this account must be at aal2 to use any manager or owner
  -- capability, with no grace period. Set automatically once the account
  -- finishes TOTP enrolment. See mfa_ok below.
  require_mfa boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.staff_roles drop constraint if exists staff_roles_role_check;
alter table public.staff_roles add constraint staff_roles_role_check
  check (role in ('owner_admin', 'manager', 'employee', 'kiosk'));

-- Deny by default from the moment the table exists. Policies arrive in
-- rls-lockdown.sql; until then nobody can read or write this table through
-- the API, which is the safe direction to fail.
alter table public.staff_roles enable row level security;

-- The coarse layer under RLS. Supabase sets default privileges that would
-- probably grant these anyway, but probably is not good enough for the
-- table the whole permission system reads: without a grant here the app
-- cannot find out what role it has, and every signed-in person sees an
-- application that believes they have none. RLS above is what actually
-- decides who may write; this only opens the door far enough for RLS to be
-- asked the question.
grant select, insert, update, delete on public.staff_roles to authenticated;
-- A visitor to the website has no business knowing who works here.
revoke all on public.staff_roles from anon;

comment on table public.staff_roles is
  'One row per staff account. The role the RLS policies read. Written only by an owner_admin.';

-- ---------------------------------------------------------------------
-- 2. The functions the policies call.
--
-- All of them are stable, so Postgres evaluates each once per statement
-- rather than once per row, and security definer, so they can read
-- staff_roles and the auth schema regardless of who is asking.
--
-- search_path is pinned empty and every name is schema-qualified. Without
-- that, a caller who can create a table named staff_roles in a schema
-- earlier on their own search_path can decide what role they have.
-- ---------------------------------------------------------------------

-- The role of the caller, or null for a signed-out or unassigned account.
create or replace function public.staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.role
  from public.staff_roles r
  where r.user_id = auth.uid()
$fn$;

-- Has the caller satisfied multi-factor authentication?
--
-- True when the session reached aal2, meaning a TOTP code was accepted
-- this session. Also true for an account that has no verified factor yet
-- and is not marked require_mfa, which is the grace window that lets an
-- owner sign in and enrol rather than being locked out by the migration
-- that introduced the requirement. Enrolling closes the window for that
-- account: the app sets require_mfa when verification succeeds, and from
-- then on aal2 is the only way through.
create or replace function public.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    or (
      not coalesce(
        (select r.require_mfa from public.staff_roles r where r.user_id = auth.uid()),
        false
      )
      and not exists (
        select 1
        from auth.mfa_factors f
        where f.user_id = auth.uid()
          and f.status = 'verified'
      )
    )
$fn$;

-- Owner or admin, MFA satisfied.
create or replace function public.is_owner_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.staff_role() = 'owner_admin' and public.mfa_ok()
$fn$;

-- Manager or above, MFA satisfied. This is the line the money, the
-- deletions and the bulk exports sit behind.
create or replace function public.at_least_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.staff_role() in ('owner_admin', 'manager') and public.mfa_ok()
$fn$;

-- Employee or above. No MFA requirement: the requirement asks for MFA on
-- Owner/Admin and Manager accounts, and demanding a code from the front
-- desk every shift would get the app worked around rather than used.
create or replace function public.at_least_employee()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.staff_role() in ('owner_admin', 'manager', 'employee')
$fn$;

create or replace function public.is_kiosk()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.staff_role() = 'kiosk'
$fn$;

-- Anyone with any role. Used for the handful of tables every signed-in
-- device reads, such as settings.
create or replace function public.has_staff_role()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.staff_role() is not null
$fn$;

-- The specific authorisation the requirements document asks for before
-- anybody walks out with the customer database. Named separately from
-- at_least_manager so it can be moved to owner-only by editing one line.
create or replace function public.can_export()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.at_least_manager()
$fn$;

-- The staff list the Settings screen shows.
--
-- staff_roles holds user ids, and the sign-in emails live in auth.users,
-- which the browser cannot read and should not be able to. This hands back
-- the joined view - who exists, what role they hold, whether they have set
-- up an authenticator, when they last signed in - to a manager or owner and
-- to nobody else.
--
-- Accounts with no role are included on purpose. An owner cannot assign a
-- role to somebody they cannot see, and an account nobody has assigned is
-- exactly the one worth noticing.
create or replace function public.list_staff()
returns table (
  user_id uuid,
  email text,
  role text,
  require_mfa boolean,
  has_totp boolean,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.at_least_manager() then
    raise exception 'Seeing who works here needs a manager or owner account.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      u.id,
      u.email::text,
      r.role,
      coalesce(r.require_mfa, false),
      exists (
        select 1 from auth.mfa_factors f
        where f.user_id = u.id and f.status = 'verified'
      ),
      u.last_sign_in_at
    from auth.users u
    left join public.staff_roles r on r.user_id = u.id
    -- Customers hold accounts too, and they were being listed here beside
    -- the staff with the same role dropdown next to them - so the screen for
    -- managing who works here offered to make a client a manager. Nothing
    -- ever assigned one automatically, but offering the choice at all is the
    -- kind of mistake that gets made at a busy front desk.
    --
    -- Anybody who already holds a staff role stays listed whatever else they
    -- are, so a member of staff who also brings their own dog here does not
    -- vanish from the list and become unmanageable.
    where r.user_id is not null
       or not exists (
            select 1 from public.owners o where o.user_id = u.id
          )
    order by r.role nulls first, u.email;
end
$fn$;

revoke execute on function public.list_staff() from public, anon;
grant execute on function public.list_staff() to authenticated;

-- A signed-out visitor gains nothing from calling these, but there is no
-- reason to offer them either.
do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'public.staff_role()', 'public.mfa_ok()', 'public.is_owner_admin()',
    'public.at_least_manager()', 'public.at_least_employee()',
    'public.is_kiosk()', 'public.has_staff_role()', 'public.can_export()'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end
$grants$;

-- ---------------------------------------------------------------------
-- 3. The guard on the roles table itself.
--
-- RLS decides who may write a row. This decides what a write may say,
-- which RLS cannot express: an account may harden itself by turning
-- require_mfa on, and may not promote itself, demote anyone, or turn its
-- own MFA requirement back off.
-- ---------------------------------------------------------------------

create or replace function public.staff_roles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();

  -- No session at all means the SQL editor or the secret key. Both already
  -- bypass RLS and both are how an owner recovers from a mistake in this
  -- table, so they are let through rather than blocked.
  if auth.uid() is null then
    return new;
  end if;

  if public.is_owner_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Only an owner or admin can grant a role'
      using errcode = 'insufficient_privilege';
  end if;

  if new.user_id <> auth.uid() or old.user_id <> auth.uid() then
    raise exception 'Only an owner or admin can change another account'
      using errcode = 'insufficient_privilege';
  end if;

  if new.role <> old.role then
    raise exception 'Only an owner or admin can change a role'
      using errcode = 'insufficient_privilege';
  end if;

  if old.require_mfa and not new.require_mfa then
    raise exception 'Only an owner or admin can switch off the MFA requirement'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end
$fn$;

drop trigger if exists staff_roles_guard on public.staff_roles;
create trigger staff_roles_guard
  before insert or update on public.staff_roles
  for each row execute function public.staff_roles_guard();

-- ---------------------------------------------------------------------
-- 4. Seed the accounts that already exist, and refuse to finish if the
--    result would lock the business out of its own database.
-- ---------------------------------------------------------------------

do $seed$
declare
  -- EDIT ME. Left column is the sign-in email, right column the role.
  --
  -- These must be accounts that ALREADY EXIST. Create them first, in the
  -- Supabase dashboard under Authentication, with Auto Confirm User ticked.
  -- An email here with no account behind it is skipped, not created, and if
  -- that happens to the owner_admin row this block refuses to finish.
  --
  -- At least one owner_admin is required. The other two are the usual shape
  -- of a daycare and can be renamed, removed or added to.
  --
  -- You can skip editing this entirely by creating a table called
  -- public.staff_seed with email and role columns and putting the rows there.
  -- If that table exists and has anything in it, it wins over the list below.
  -- That is how scripts/setup.mjs seeds roles without rewriting this file.
  seeds text[][] := array[
  ['cesar@staff.local', 'owner_admin'],
  ['kiosk@staff.local', 'kiosk'],
  ['frontdesk@staff.local', 'employee']
];
  from_table text[][];
  i int;
  seed_email text;
  seed_role text;
  seed_id uuid;
  unassigned text;
  missing text[] := '{}';
  owners int;
begin
  if to_regclass('public.staff_seed') is not null then
    execute
      'select array_agg(array[s.email, s.role] order by s.email) from public.staff_seed s'
      into from_table;
    if from_table is not null then
      seeds := from_table;
      raise notice 'Seeding roles from the staff_seed table, not the list in this file.';
    end if;
  end if;

  for i in 1 .. array_length(seeds, 1) loop
    seed_email := seeds[i][1];
    seed_role := seeds[i][2];

    select id into seed_id from auth.users where lower(email) = lower(seed_email);
    if seed_id is null then
      missing := missing || (seed_email || ' (' || seed_role || ')');
      raise notice 'No account found for %, skipped', seed_email;
      continue;
    end if;

    insert into public.staff_roles (user_id, role, note)
    values (seed_id, seed_role, 'Seeded by security-roles-migration')
    on conflict (user_id) do nothing;
  end loop;

  -- Anybody left without a role will be refused by every policy in step 4.
  -- That is the correct default, but it must not be a surprise.
  select string_agg(u.email, ', ' order by u.email) into unassigned
  from auth.users u
  left join public.staff_roles r on r.user_id = u.id
  where r.user_id is null;

  if unassigned is not null then
    raise notice 'Accounts with no role, which will have no access: %', unassigned;
  end if;

  select count(*) into owners from public.staff_roles where role = 'owner_admin';
  if owners = 0 then
    if array_length(missing, 1) > 0 then
      raise exception
        'Refusing to finish: no owner_admin exists, so rls-lockdown.sql would lock everyone out. These seed emails have no account behind them: %. Create them under Authentication in the Supabase dashboard with Auto Confirm User ticked, or edit the seed list in section 4 near the end of this file to the emails you actually created. Then run this file again.',
        array_to_string(missing, ', ');
    else
      raise exception
        'Refusing to finish: no owner_admin exists, so rls-lockdown.sql would lock everyone out. The accounts exist but none of them is seeded as owner_admin. Set the role in the seed list in section 4 near the end of this file and run it again.';
    end if;
  end if;

  raise notice 'Roles in place. owner_admin accounts: %', owners;
end
$seed$;

-- ---------------------------------------------------------------------
-- Check. One row per account, with the role the database will now enforce.
-- ---------------------------------------------------------------------
select
  u.email,
  coalesce(r.role, 'NO ROLE - no access') as role,
  r.require_mfa,
  exists (
    select 1 from auth.mfa_factors f
    where f.user_id = u.id and f.status = 'verified'
  ) as has_totp
from auth.users u
left join public.staff_roles r on r.user_id = u.id
order by u.email;
