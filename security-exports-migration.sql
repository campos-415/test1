-- Bulk exports, behind a door the database controls.
--
-- Settings -> Reports offers CSV downloads of dogs, owners, visits,
-- boardings, packages, payments and vaccinations. Requirement 3 says an
-- employee must not be able to walk out with the customer database without
-- specific authorisation, and until now the only thing stopping them was
-- that the button was on a page they could open.
--
-- Every export now goes through one of the two functions here. Both refuse
-- unless can_export passes, which means a manager or owner whose session
-- has satisfied MFA, and both write a line in the audit log naming the
-- person, the dataset and the number of rows.
--
--   export_dataset  is the data path for the plain table exports. It is
--                   security definer, so it - not the table policy - is the
--                   authorisation for reading a table in bulk.
--   record_export   is for the three exports the app composes in the
--                   browser out of figures already on screen: accounts and
--                   ageing, outstanding charges, and the dog directory. It
--                   authorises and records the act of exporting.
--
-- Photos and signatures are stripped here rather than in the browser. They
-- are megabytes of base64 that no spreadsheet can show, and the fewer
-- places a customer signature travels to, the better.
--
-- What this does NOT do, stated plainly because a security control that is
-- oversold is worse than one that is understood: an employee still has
-- SELECT on dogs and owners, because the front desk has to be able to look
-- up any dog that walks in and reach an emergency contact when one is hurt.
-- Somebody determined enough to use the API directly can therefore still
-- page through those two tables. What they cannot do is press a button and
-- get a spreadsheet, and what they cannot do quietly is anything at all -
-- the export path is the only bulk path that is authorised, and it is
-- logged. Closing that last gap means either scoped read functions in place
-- of table reads, or customer accounts, which is item 5 on the plan.
--
-- Run after security-audit-migration.sql. See the run order at the top of
-- security-roles-migration.sql. Reverse with security-rollback.sql.
--
-- Safe to run more than once.
--
-- No apostrophe, quote or dollar-quoted block appears in any comment here,
-- for the Supabase SQL editor reason noted in the other migrations.

-- ---------------------------------------------------------------------
-- The permission check, in one place so both functions agree and so the
-- message tells somebody what to do about it.
-- ---------------------------------------------------------------------

create or replace function public.assert_can_export()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'Sign in before exporting.'
      using errcode = 'insufficient_privilege';
  end if;

  if public.can_export() then
    return;
  end if;

  if public.staff_role() in ('owner_admin', 'manager') then
    raise exception 'This export needs your two-factor code. Finish signing in and try again.'
      using errcode = 'insufficient_privilege';
  end if;

  raise exception 'Exporting client records needs a manager or owner account. Ask one of them to run it.'
    using errcode = 'insufficient_privilege';
end
$fn$;

-- A refused attempt is not recorded here, and cannot be: raising rolls the
-- transaction back, and the audit row would roll back with it. The app logs
-- its own refusals from the browser, in a separate request, and Postgres
-- records the error either way.

-- ---------------------------------------------------------------------
-- The data path.
-- ---------------------------------------------------------------------

-- Paged, and it has to be.
--
-- PostgREST caps a response at 1,000 rows however many the caller asks for,
-- and that cap applies to a function returning a set exactly as it applies to
-- a table. An unpaged version of this returned the first thousand rows of a
-- 2,640 row table with no error and nothing to say the file was short - which
-- in an export of the client database is the worst possible failure, because
-- the spreadsheet looks complete. The same trap was found and fixed in
-- loadReportData; this is the same fix in the same shape.
--
-- Every dataset is ordered to the primary key as a tiebreak, not only by the
-- column that reads well in a spreadsheet. Two dogs with the same name have no
-- defined order between them otherwise, and an order that is not total can
-- shuffle between pages: a row appears twice, another never appears, and again
-- nothing says so.
create or replace function public.export_dataset(
  p_dataset text,
  p_offset int default 0,
  p_limit int default 1000
)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  -- Base64 blobs. Useless in a spreadsheet, and a signature is not
  -- something to copy into a downloads folder.
  blobs text[] := array['photo_data', 'signature_data', 'file_data'];
  exported bigint := 0;
  window_size int := least(greatest(coalesce(p_limit, 1000), 1), 1000);
  start_at int := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.assert_can_export();

  case p_dataset
    when 'dogs' then
      return query select to_jsonb(d) - blobs from public.dogs d
        order by d.dog_name, d.id offset start_at limit window_size;
    when 'owners' then
      return query select to_jsonb(o) - blobs from public.owners o
        order by o.phone, o.id offset start_at limit window_size;
    when 'visits' then
      return query select to_jsonb(s) - blobs from public.signins s
        order by s.created_at desc, s.id offset start_at limit window_size;
    when 'boardings' then
      return query select to_jsonb(b) - blobs from public.boardings b
        order by b.start_date desc, b.id offset start_at limit window_size;
    when 'packages' then
      return query select to_jsonb(p) - blobs from public.packages p
        order by p.created_at desc, p.id offset start_at limit window_size;
    when 'payments' then
      return query select to_jsonb(p) - blobs from public.payments p
        order by p.paid_on desc, p.id offset start_at limit window_size;
    when 'vaccinations' then
      return query select to_jsonb(v) - blobs from public.vaccinations v
        order by v.id offset start_at limit window_size;
    when 'walk_logs' then
      return query select to_jsonb(w) - blobs from public.walk_logs w
        order by w.date desc, w.id offset start_at limit window_size;
    else
      raise exception 'Unknown export: %', p_dataset;
  end case;

  -- Reached after the rows have been handed back, so the count is the real
  -- number that left the building.
  get diagnostics exported = row_count;

  -- One line per page rather than one per export. The biggest table here is
  -- three pages, so this is two extra lines at worst, and it is the honest
  -- version: it records what actually left even when somebody closes the tab
  -- half way through. Waiting for a final page that may never come would have
  -- recorded nothing at all for an abandoned export.
  insert into public.audit_log (
    actor_id, actor_email, actor_role, action, entity, summary, detail
  )
  values (
    auth.uid(),
    (select u.email from auth.users u where u.id = auth.uid()),
    public.staff_role(),
    'export.' || p_dataset,
    p_dataset,
    format(
      'Exported %s rows of %s to a spreadsheet (from row %s)',
      exported, p_dataset, start_at + 1
    ),
    jsonb_build_object(
      'dataset', p_dataset,
      'rows', exported,
      'offset', start_at,
      'via', 'export_dataset'
    )
  );

  return;
end
$fn$;

-- The old single-argument version, if an earlier run of this file created it.
-- Left behind it would keep working and keep truncating.
drop function if exists public.export_dataset(text);

revoke execute on function public.export_dataset(text, int, int) from public, anon;
grant execute on function public.export_dataset(text, int, int) to authenticated;

-- ---------------------------------------------------------------------
-- The three exports the browser composes for itself.
--
-- Accounts and ageing, outstanding charges and the dog directory are all
-- derived - balances allocated oldest charge first, vaccination status,
-- visit counts - and that arithmetic lives in lib/billing.ts and
-- lib/reports.ts. Reimplementing it in SQL would mean two versions of the
-- same sums, drifting apart. So the rows are built in the browser from
-- figures a manager is already allowed to see, and this function is what
-- authorises and records the download.
-- ---------------------------------------------------------------------

create or replace function public.record_export(p_dataset text, p_rows int default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  new_id uuid;
begin
  perform public.assert_can_export();

  insert into public.audit_log (
    actor_id, actor_email, actor_role, action, entity, summary, detail
  )
  values (
    auth.uid(),
    (select u.email from auth.users u where u.id = auth.uid()),
    public.staff_role(),
    'export.' || p_dataset,
    p_dataset,
    format('Exported %s rows of %s to a spreadsheet', coalesce(p_rows, 0), p_dataset),
    jsonb_build_object('dataset', p_dataset, 'rows', p_rows, 'via', 'record_export')
  )
  returning id into new_id;

  return new_id;
end
$fn$;

revoke execute on function public.record_export(text, int) from public, anon;
grant execute on function public.record_export(text, int) to authenticated;

-- ---------------------------------------------------------------------
-- Check.
--
-- Deliberately not a call to export_dataset. The SQL editor has no session,
-- so auth.uid is null there and the function refuses - which is the correct
-- answer: an export has to be attributable to a person, and nothing in the
-- SQL editor is. Exports are proved with real accounts, which is what
-- docs/SECURITY-ROLES.md sets out and what the test harness does.
--
-- Expect two functions, both security definer, both executable by
-- authenticated and by nobody else.
-- ---------------------------------------------------------------------
select
  p.proname as function_name,
  p.prosecdef as security_definer,
  coalesce(
    array_to_string(
      array(
        select distinct a.grantee
        from information_schema.routine_privileges a
        where a.specific_name = p.proname || '_' || p.oid
          and a.privilege_type = 'EXECUTE'
        order by a.grantee
      ),
      ', '
    ),
    'nobody'
  ) as can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('export_dataset', 'record_export', 'assert_can_export')
order by p.proname;
