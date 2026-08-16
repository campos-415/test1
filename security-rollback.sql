-- Reversing the role, MFA and audit work.
--
-- Two stages, because they answer two different questions.
--
-- STAGE 1 is the one to run in a hurry. It puts the policies back the way
-- they were before roles existed - any signed-in account may do anything,
-- plus the same four narrow public grants - so the app works for everybody
-- again. It leaves staff_roles and the audit log alone, which means no role
-- assignment is lost and no history is destroyed, and rls-lockdown.sql can
-- be run again once whatever went wrong is understood.
--
-- This is the script to have open in a tab while running the migration. If
-- the front desk cannot sign a dog in, run stage 1 and diagnose afterwards.
--
-- STAGE 2 removes the machinery: triggers, functions, then the two tables.
-- It is commented out on purpose. Running it destroys the audit log, which
-- is a record the business may be relying on, and the order matters - the
-- triggers reference the functions and the functions reference staff_roles,
-- so taking them out backwards leaves writes to dogs failing.
--
-- Stage 1 is one DO block, which is one statement, which is one
-- transaction: at no point is a table left with no policy at all, and a
-- failure part way through changes nothing.
--
-- No apostrophe, quote or dollar-quoted block appears in any comment here,
-- for the Supabase SQL editor reason noted in the other migrations.

-- =====================================================================
-- STAGE 1. Give every signed-in account full access again.
-- =====================================================================

do $rollback$
declare
  all_tables text[] := array[
    'dogs', 'owners', 'signins', 'boardings', 'packages', 'package_uses',
    'payments', 'vaccinations', 'meal_logs', 'walk_logs', 'dog_docs',
    'enrollments', 'boarding_requests', 'settings', 'site_photos', 'reviews'
  ];
  public_read text[] := array['settings', 'site_photos', 'reviews'];
  public_insert text[] := array['enrollments', 'boarding_requests'];

  -- Every policy name either version of the lockdown has created.
  old_names text[] := array[
    'allow all', 'staff full access', 'public read', 'public submit',
    'staff select', 'staff insert', 'staff update', 'staff delete'
  ];

  t text;
  name text;
  skipped text[] := '{}';
begin
  foreach t in array all_tables loop
    if to_regclass('public.' || t) is null then
      skipped := skipped || t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    foreach name in array old_names loop
      execute format('drop policy if exists %I on public.%I', name, t);
    end loop;

    execute format(
      'create policy "staff full access" on public.%I for all to authenticated using (true) with check (true)',
      t
    );

    if t = any(public_read) then
      execute format('create policy "public read" on public.%I for select to anon using (true)', t);
    end if;

    if t = any(public_insert) then
      execute format('create policy "public submit" on public.%I for insert to anon with check (true)', t);
    end if;
  end loop;

  -- Deliberately absent from the list above: vaccinations_staging. The
  -- lockdown restricts it to managers, and it is left restricted here rather
  -- than handed to every signed-in account, because unlike the tables above
  -- that is not where it started - no earlier migration named it at all.
  -- Nothing in the application reads it, so nothing breaks by leaving it
  -- alone, and rolling back should not open something on the way past.

  -- The two tables the roles work added. Left in place and readable, so
  -- rolling back does not lose who was assigned what, or the history.
  if to_regclass('public.staff_roles') is not null then
    execute 'drop policy if exists "own role" on public.staff_roles';
    execute 'drop policy if exists "manage roles" on public.staff_roles';
    execute 'drop policy if exists "harden own account" on public.staff_roles';
    execute 'create policy "own role" on public.staff_roles for select to authenticated using (true)';
    execute 'create policy "manage roles" on public.staff_roles for all to authenticated using (true) with check (true)';
  end if;

  if to_regclass('public.audit_log') is not null then
    execute 'drop policy if exists "read audit log" on public.audit_log';
    execute 'create policy "read audit log" on public.audit_log for select to authenticated using (true)';
  end if;

  if array_length(skipped, 1) is not null then
    raise notice 'Skipped tables that do not exist: %', array_to_string(skipped, ', ');
  end if;
  raise notice 'Stage 1 done: every signed-in account has full access again. Roles and audit history kept.';
end
$rollback$;

select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- =====================================================================
-- STAGE 2. Remove the machinery entirely.
--
-- Read this before uncommenting: it deletes the audit log. If the log is
-- worth keeping, copy it out first, for example
--
--   select * from public.audit_log order by at;
--
-- and save the result. Then remove the block comment markers below and run.
-- The order is triggers, then functions, then tables - reverse of how they
-- were built, because each layer depends on the one under it.
-- =====================================================================

/*
do $teardown$
declare
  audited text[] := array[
    'dogs', 'owners', 'vaccinations', 'dog_docs', 'packages', 'payments',
    'boardings', 'enrollments', 'boarding_requests', 'settings'
  ];
  t text;
begin
  foreach t in array audited loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists audit_changes on public.%I', t);
    end if;
  end loop;

  if to_regclass('public.staff_roles') is not null then
    execute 'drop trigger if exists audit_role_changes on public.staff_roles';
    execute 'drop trigger if exists staff_roles_guard on public.staff_roles';
  end if;

  if to_regclass('public.audit_log') is not null then
    execute 'drop trigger if exists audit_log_redact on public.audit_log';
    execute 'drop trigger if exists audit_log_no_update on public.audit_log';
    execute 'drop trigger if exists audit_log_no_delete on public.audit_log';
  end if;
end
$teardown$;

drop function if exists public.export_dataset(text);
drop function if exists public.record_export(text, int);
drop function if exists public.assert_can_export();
drop function if exists public.prune_audit_log(date);
drop function if exists public.audit_write(text, text, text, text, jsonb);
drop function if exists public.audit_row_change();
drop function if exists public.audit_role_change();
drop function if exists public.audit_redact();
drop function if exists public.audit_immutable();
drop function if exists public.audit_scrub(jsonb);
drop function if exists public.redact_text(text);
drop function if exists public.looks_secret(text);
drop function if exists public.looks_like_card(text);
drop function if exists public.can_export();
drop function if exists public.has_staff_role();
drop function if exists public.is_kiosk();
drop function if exists public.at_least_employee();
drop function if exists public.at_least_manager();
drop function if exists public.is_owner_admin();
drop function if exists public.mfa_ok();
drop function if exists public.staff_role();
drop function if exists public.staff_roles_guard();

drop table if exists public.audit_log;
drop table if exists public.staff_roles;
*/

-- =====================================================================
-- BREAK GLASS: somebody cannot get past the two-factor prompt.
--
-- Read this first, because most of the time the answer is that there is no
-- problem. An account that has never enrolled is NOT blocked by the app: the
-- prompt is a banner it can dismiss, and the database lets it work at
-- employee level while refusing exports, deletions and permission changes.
-- So this section is for one situation only - an account that DID enrol and
-- no longer has the phone.
--
-- The ordinary fix needs no SQL: another owner lifts the requirement in
-- Settings, Security, and the person enrols again on the new phone. Use the
-- statements below only when nobody can get in to do that.
--
-- Put the sign-in email in both places, and run them together.
-- =====================================================================

/*
-- 1. Stop the database demanding a code from this account.
update public.staff_roles
set require_mfa = false
where user_id = (select id from auth.users where lower(email) = lower('owner@staff.local'));

-- 2. Remove the enrolled authenticator, so mfa_ok stops looking for it.
--    The supported route is the app or the Auth admin API; this is the
--    break-glass version for when neither is reachable.
delete from auth.mfa_factors
where user_id = (select id from auth.users where lower(email) = lower('owner@staff.local'));

-- 3. Check. Expect require_mfa false and factors 0.
select
  u.email,
  r.role,
  r.require_mfa,
  (select count(*) from auth.mfa_factors f where f.user_id = u.id) as factors
from auth.users u
left join public.staff_roles r on r.user_id = u.id
where lower(u.email) = lower('owner@staff.local');
*/

-- =====================================================================
-- Note on MFA, which this script cannot undo.
--
-- Enrolled authenticator factors live in the auth schema, managed by
-- Supabase Auth, and are not touched by anything here. Somebody who has
-- enrolled stays enrolled, which is harmless: with these policies back to
-- blanket access, nothing in the database asks about assurance level, so a
-- factor is simply an extra prompt the app can be told to stop showing.
--
-- To remove a factor for one account, do it from the app - the Security
-- panel in Settings - or with the Auth admin API. Deleting rows out of
-- auth.mfa_factors by hand is not the supported route.
-- =====================================================================
