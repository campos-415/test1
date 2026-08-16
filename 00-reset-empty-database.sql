-- Start a half-built database over.
--
-- Only for a NEW database whose setup went wrong part way through - a file run
-- out of order, or an early version of 00-base-schema.sql that created a table
-- without the constraints it should have had. Re-running 00-base-schema.sql
-- does not fix that on its own, because create table if not exists skips a
-- table that is already there and therefore never adds the missing pieces.
--
-- THIS DROPS TABLES. It is written so that it cannot drop a database that has
-- anything in it: the first block counts every row it can find and refuses if
-- the total is not zero. A production database has dogs and owners in it, so
-- running this against the wrong project stops with an error instead of
-- destroying it. That guard is the entire point of the file - do not remove it
-- to force the file through.
--
-- After this, run 00-base-schema.sql and then the migrations in the order
-- given in docs/NEW-DATABASE.md.
--
-- No apostrophe or quote character appears in any comment here, for the
-- Supabase SQL editor reason noted in the other migrations.

do $guard$
declare
  t text;
  n bigint;
  total bigint := 0;
  populated text[] := '{}';
  all_tables text[] := array[
    'owners', 'dogs', 'boardings', 'packages', 'signins', 'package_uses',
    'payments', 'vaccinations', 'walk_logs', 'meal_logs', 'settings',
    'vaccinations_staging', 'enrollments', 'dog_docs', 'boarding_requests',
    'site_photos', 'staff_roles', 'audit_log'
  ];
begin
  foreach t in array all_tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('select count(*) from public.%I', t) into n;
    if n > 0 then
      total := total + n;
      populated := populated || (t || ' (' || n || ')');
    end if;
  end loop;

  if total > 0 then
    raise exception
      'Refusing to reset: this database has % rows in it, so it is not a new one. Tables with data: %',
      total, array_to_string(populated, ', ');
  end if;

  raise notice 'Empty database confirmed. Dropping tables.';
end
$guard$;

-- Cascade takes the policies, indexes and foreign keys with them. Steps 0 to
-- 10 create no functions or views, so there is nothing else left behind.

drop table if exists public.site_photos cascade;
drop table if exists public.boarding_requests cascade;
drop table if exists public.dog_docs cascade;
drop table if exists public.enrollments cascade;
drop table if exists public.vaccinations_staging cascade;
drop table if exists public.settings cascade;
drop table if exists public.meal_logs cascade;
drop table if exists public.walk_logs cascade;
drop table if exists public.vaccinations cascade;
drop table if exists public.payments cascade;
drop table if exists public.package_uses cascade;
drop table if exists public.signins cascade;
drop table if exists public.packages cascade;
drop table if exists public.boardings cascade;
drop table if exists public.dogs cascade;
drop table if exists public.owners cascade;

-- The security tables, in case the run got as far as them. Dropping these is
-- what makes security-roles-migration.sql runnable again from clean.
drop table if exists public.audit_log cascade;
drop table if exists public.staff_roles cascade;
