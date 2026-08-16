-- Does one client actually get refused another client records?
--
-- NOTE: no apostrophe or quote character appears in any comment below, for
-- the Supabase SQL editor reason noted in the other migrations.
--
-- ---------------------------------------------------------------------
-- What this proves, and how
-- ---------------------------------------------------------------------
--
-- Requirement 1 of the client security document asks that customers cannot
-- reach another customer data, and requirement 12 asks that it be tested
-- rather than asserted. A portal that shows the right thing on screen proves
-- nothing: the API is public, the access token is in the browser, and the
-- interesting request is the one the app never makes.
--
-- So every probe below is a raw statement against the database, by id, with
-- no help from the application. Each one runs as the postgres role has
-- stepped down to authenticated and with request.jwt.claims set to the
-- account being tested - which is precisely what PostgREST does to serve one
-- REST request. A row returned here is a row that would come back from
-- /rest/v1/ with that account access token, and a row refused here is
-- refused there.
--
-- Both directions are checked. A test that only shows zeros can be passing
-- because everything is broken, so every refusal is paired with the same
-- read against the account own household, which must return rows.
--
-- ---------------------------------------------------------------------
-- What it leaves behind
-- ---------------------------------------------------------------------
--
-- Nothing. Two accounts that cannot sign in - no password is ever set on
-- them - are created, bound to two real households, used, and removed, along
-- with the payment and document rows the money and paperwork probes need.
-- The two households are put back exactly as they were found, including
-- their claim state.
--
-- Safe to run more than once, and safe to run on a database with real data
-- in it: it reads real rows and writes only rows it then deletes.
--
-- Run it after customer-accounts-migration.sql and rls-lockdown.sql.

-- ---------------------------------------------------------------------
-- The two probes. Both step down to authenticated for the length of the
-- call and hand the role back on the way out, which is what makes it safe
-- to run the rest of the script as the owner around them.
-- ---------------------------------------------------------------------

create or replace function public.probe_read(p_user uuid, p_sql text)
returns bigint
language plpgsql
set role = 'authenticated'
as $fn$
declare
  n bigint;
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text,
    true
  );
  execute 'select count(*) from (' || p_sql || ') probe' into n;
  return n;
exception when others then
  -- A refusal that arrives as an error rather than as no rows is still a
  -- refusal. Recorded as -1 so it is visibly different from an empty read.
  return -1;
end
$fn$;

create or replace function public.probe_write(p_user uuid, p_sql text)
returns text
language plpgsql
set role = 'authenticated'
as $fn$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text,
    true
  );
  execute p_sql;
  return 'ALLOWED';
exception when others then
  return sqlstate;
end
$fn$;

-- ---------------------------------------------------------------------
-- The run.
-- ---------------------------------------------------------------------

drop table if exists isolation_results;
create temp table isolation_results (
  seq serial,
  area text,
  probe text,
  expected text,
  actual text,
  verdict text
);

do $test$
declare
  a_owner uuid;   b_owner uuid;
  a_user uuid;    b_user uuid;
  a_claimed timestamptz; b_claimed timestamptz;
  a_invited timestamptz; b_invited timestamptz;
  a_prev_user uuid;      b_prev_user uuid;
  -- The whole of household B as it was found. The details probe genuinely
  -- rewrites twelve columns, so putting them back means having kept them.
  b_before public.owners%rowtype;
  b_dog uuid; b_pkg uuid; b_stay uuid; b_pay uuid; b_doc uuid; b_visit uuid; b_vacc uuid;
  a_dog uuid;
  n bigint;
  anon_dogs bigint;
  anon_views bigint;
  code text;
  own_dogs text;
  stranger uuid;
  staff_user uuid;
  spare_token uuid;
  probe_table text;
  marker text := 'isolation-test-fixture';
begin
  -- Two real households with the fullest set of records, so every probe has
  -- something genuine to aim at rather than an empty table that would pass
  -- by accident.
  select o.id into a_owner
  from public.owners o
  where exists (select 1 from public.dogs d where d.owner_id = o.id)
    and exists (select 1 from public.packages p where p.owner_id = o.id)
    and exists (select 1 from public.boardings b where b.owner_id = o.id)
    and exists (select 1 from public.signins s where s.owner_id = o.id)
    and o.claimed_at is null
  order by o.id
  limit 1;

  select o.id into b_owner
  from public.owners o
  where exists (select 1 from public.dogs d where d.owner_id = o.id)
    and exists (select 1 from public.packages p where p.owner_id = o.id)
    and exists (select 1 from public.boardings b where b.owner_id = o.id)
    and exists (select 1 from public.signins s where s.owner_id = o.id)
    and o.claimed_at is null
    and o.id <> a_owner
  order by o.id
  limit 1;

  if a_owner is null or b_owner is null then
    raise exception 'Need two unclaimed households that each have a dog, a package, a stay and a visit. This database does not have them.';
  end if;

  -- The audit log is append-only, by trigger, on purpose - so a test that
  -- binds two households and unbinds them again would leave half a dozen
  -- entries nobody can remove. Lifted for the run and put back at the end,
  -- the same way the backfill does it.
  alter table public.owners disable trigger audit_changes;
  alter table public.dog_docs disable trigger audit_changes;
  alter table public.payments disable trigger audit_changes;
  alter table public.boarding_requests disable trigger audit_changes;

  -- Fixture accounts. No password is set, so neither can ever be signed in
  -- to; they exist only to be a uuid that auth.uid can return.
  a_user := gen_random_uuid();
  b_user := gen_random_uuid();
  insert into auth.users (id, email) values
    (a_user, 'isolation-test-a@example.invalid'),
    (b_user, 'isolation-test-b@example.invalid');

  select user_id, claimed_at, invited_at into a_prev_user, a_claimed, a_invited from public.owners where id = a_owner;
  select user_id, claimed_at, invited_at into b_prev_user, b_claimed, b_invited from public.owners where id = b_owner;
  select * into b_before from public.owners where id = b_owner;

  update public.owners set user_id = a_user, claimed_at = now() where id = a_owner;
  update public.owners set user_id = b_user, claimed_at = now() where id = b_owner;

  -- Household B needs a payment and a document to aim at. Neither table is
  -- necessarily populated, and an isolation test that skips the invoice
  -- because there were no invoices is not a test.
  select id into b_dog from public.dogs where owner_id = b_owner order by id limit 1;
  select id into a_dog from public.dogs where owner_id = a_owner order by id limit 1;
  select id into b_pkg from public.packages where owner_id = b_owner order by id limit 1;
  select id into b_stay from public.boardings where owner_id = b_owner order by id limit 1;
  select id into b_visit from public.signins where owner_id = b_owner order by id limit 1;
  select id into b_vacc from public.vaccinations where dog_id = b_dog order by id limit 1;

  insert into public.payments (phone, dog_id, amount, method, note, paid_on)
  select o.phone, b_dog, 42.00, 'card', marker, current_date
  from public.owners o where o.id = b_owner
  returning id into b_pay;

  insert into public.dog_docs (dog_id, kind, file_name, mime_type, data)
  values (b_dog, 'vaccination', marker, 'image/jpeg', 'data:image/jpeg;base64,TEST')
  returning id into b_doc;

  -- Household A needs one of each too, for the positive controls.
  insert into public.payments (phone, dog_id, amount, method, note, paid_on)
  select o.phone, a_dog, 17.00, 'cash', marker, current_date
  from public.owners o where o.id = a_owner;

  insert into public.dog_docs (dog_id, kind, file_name, mime_type, data)
  values (a_dog, 'vaccination', marker, 'image/jpeg', 'data:image/jpeg;base64,TEST');

  -- -----------------------------------------------------------------
  -- 1. The five the specification names, by id, on the base tables.
  --    A base table is what an attacker reaches for first, and a client
  --    has no select policy on any of them.
  -- -----------------------------------------------------------------
  n := public.probe_read(a_user, format('select * from public.dogs where id = %L', b_dog));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('another household', 'dogs by id, base table', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  n := public.probe_read(a_user, format('select * from public.packages where id = %L', b_pkg));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('another household', 'packages by id, base table', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  n := public.probe_read(a_user, format('select * from public.boardings where id = %L', b_stay));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('another household', 'boardings by id, base table', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  n := public.probe_read(a_user, format('select * from public.payments where id = %L', b_pay));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('another household', 'payments by id, base table', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  n := public.probe_read(a_user, format('select * from public.dog_docs where id = %L', b_doc));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('another household', 'dog_docs by id, base table', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  -- -----------------------------------------------------------------
  -- 2. The same five through the views the portal actually reads. The
  --    views bypass RLS by design, so their where clause is the only
  --    thing standing there and it is the thing worth testing.
  -- -----------------------------------------------------------------
  n := public.probe_read(a_user, format('select * from public.my_dogs where id = %L', b_dog));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('another household', 'my_dogs by id', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  n := public.probe_read(a_user, format('select * from public.my_packages where id = %L', b_pkg));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('another household', 'my_packages by id', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  n := public.probe_read(a_user, format('select * from public.my_stays where id = %L', b_stay));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('another household', 'my_stays by id', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  n := public.probe_read(a_user, format('select * from public.my_payments where id = %L', b_pay));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('another household', 'my_payments by id', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  n := public.probe_read(a_user, format('select * from public.my_documents where id = %L', b_doc));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('another household', 'my_documents by id', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  -- -----------------------------------------------------------------
  -- 3. Everything else a household has that the five do not cover.
  -- -----------------------------------------------------------------
  n := public.probe_read(a_user, format('select * from public.my_visits where id = %L', b_visit));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('another household', 'my_visits by id', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  n := public.probe_read(a_user, format('select * from public.signins where id = %L', b_visit));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('another household', 'signins by id, base table', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  n := public.probe_read(a_user, format('select * from public.owners where id = %L', b_owner));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('another household', 'owners by id, base table', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  n := public.probe_read(a_user, format('select * from public.my_household where id = %L', b_owner));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('another household', 'my_household by id', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  if b_vacc is not null then
    n := public.probe_read(a_user, format('select * from public.my_vaccinations where id = %L', b_vacc));
    insert into isolation_results (area, probe, expected, actual, verdict)
    values ('another household', 'my_vaccinations by id', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);
  end if;

  -- The whole table, not one row. A policy can be right about a single id
  -- and wrong about a bare select, which is the query a curious person
  -- actually types.
  n := public.probe_read(a_user, 'select * from public.dogs');
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('the whole book', 'select every dog, base table', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  n := public.probe_read(a_user, 'select * from public.owners');
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('the whole book', 'select every owner, base table', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  select count(*)::text into own_dogs from public.dogs where owner_id = a_owner;
  n := public.probe_read(a_user, 'select * from public.my_dogs');
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('the whole book', 'select every dog through my_dogs', own_dogs || ' rows, only their own', n::text,
          case when n::text = own_dogs then 'PASS' else 'FAIL' end);

  -- -----------------------------------------------------------------
  -- 4. Staff-only material. Not another household - their own, which is
  --    the subtler failure: notes written about their dog, by staff, for
  --    staff.
  -- -----------------------------------------------------------------
  n := public.probe_read(a_user, 'select * from public.audit_log');
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('staff only', 'the audit log', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  n := public.probe_read(a_user, 'select * from public.staff_roles');
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('staff only', 'who works here', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  n := public.probe_read(a_user, 'select * from public.enrollments');
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('staff only', 'the enrollment queue', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  n := public.probe_read(a_user, 'select * from public.meal_logs');
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('staff only', 'the meal logs', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  -- The one the specification calls out. Asking my_visits for a column it
  -- does not have is an error, and an error here is the correct answer:
  -- there is no route from a client session to a handover note.
  n := public.probe_read(a_user, 'select staff_note from public.my_visits');
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('staff only', 'staff_note through my_visits', 'refused, no such column', case when n = -1 then 'refused' else n::text || ' rows' end,
          case when n = -1 then 'PASS' else 'FAIL' end);

  n := public.probe_read(a_user, 'select staff_note from public.signins');
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('staff only', 'staff_note through signins', '0 rows', n::text, case when n = 0 then 'PASS' else 'FAIL' end);

  -- -----------------------------------------------------------------
  -- 5. Writing. Reading is half the question.
  -- -----------------------------------------------------------------
  code := public.probe_write(a_user, format(
    'insert into public.dog_docs (dog_id, kind, file_name, mime_type, data) values (%L, ''vaccination'', ''%s'', ''image/jpeg'', ''x'')',
    b_dog, marker));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('writing', 'upload a record onto another household dog', 'refused', code,
          case when code <> 'ALLOWED' then 'PASS' else 'FAIL' end);

  code := public.probe_write(a_user, format(
    'update public.owners set owner_name = ''Taken over'' where id = %L', b_owner));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('writing', 'edit another household details', 'refused or no rows', code,
          -- An update that matches no row is not an error, so the check is
          -- that the row did not change rather than that the call failed.
          case when (select owner_name from public.owners where id = b_owner) is distinct from 'Taken over'
               then 'PASS' else 'FAIL' end);

  -- These three are asserted on the VALUE rather than on whether the call
  -- raised, and that distinction is the whole reason this file exists. The
  -- first version of it checked only that the statement errored; all three
  -- passed while doing nothing at all, and so did the positive control that
  -- was supposed to prove a client CAN edit their own details. A silent
  -- no-op looks exactly like a refusal from the outside.
  code := public.probe_write(a_user, format(
    'update public.owners set notes = ''added by a client'' where id = %L', a_owner));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('writing', 'write a staff note on their OWN household', 'unchanged',
          coalesce((select notes from public.owners where id = a_owner), 'still null'),
          case when (select notes from public.owners where id = a_owner) is distinct from 'added by a client'
               then 'PASS' else 'FAIL' end);

  code := public.probe_write(a_user, format(
    'update public.owners set phone = ''(000) 000-0000'' where id = %L', a_owner));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('writing', 'change the phone their household is keyed on', 'unchanged',
          (select phone from public.owners where id = a_owner),
          case when (select phone from public.owners where id = a_owner) <> '(000) 000-0000'
               then 'PASS' else 'FAIL' end);

  code := public.probe_write(a_user, format(
    'update public.owners set user_id = %L where id = %L', b_user, a_owner));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('writing', 'rebind their own household to another account', 'unchanged',
          case when (select user_id from public.owners where id = a_owner) = a_user then 'still theirs' else 'MOVED' end,
          case when (select user_id from public.owners where id = a_owner) = a_user
               then 'PASS' else 'FAIL' end);

  -- The guard itself, reached the only way it can be reached: as the owner,
  -- where RLS is bypassed and the trigger is the only thing left. This is
  -- what stands between update_my_household and a thirteenth column being
  -- added to it one day without anybody thinking about which one.
  perform set_config('request.jwt.claims',
    json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  begin
    update public.owners set notes = 'straight past the policy' where id = a_owner;
    code := 'ALLOWED';
  exception when others then
    code := sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('writing', 'the column guard, with RLS out of the way', 'refused', code,
          case when code = '42501' then 'PASS' else 'FAIL' end);

  code := public.probe_write(a_user, format(
    'update public.owners set claimed_at = null, invite_token = gen_random_uuid() where id = %L', b_owner));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('writing', 'mint an invitation for another household', 'refused or no rows', code,
          case when (select invite_token from public.owners where id = b_owner) is null
               then 'PASS' else 'FAIL' end);

  code := public.probe_write(a_user, format(
    'select public.issue_owner_invite(%L)', b_owner));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('writing', 'call the staff invite function', 'refused', code,
          case when code <> 'ALLOWED' then 'PASS' else 'FAIL' end);

  code := public.probe_write(a_user, 'delete from public.payments');
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('writing', 'delete the payment history', 'refused or no rows', code,
          case when (select count(*) from public.payments) > 0 then 'PASS' else 'FAIL' end);

  -- -----------------------------------------------------------------
  -- 6. Positive controls. Every refusal above is only meaningful if the
  --    same account can read its own household.
  -- -----------------------------------------------------------------
  n := public.probe_read(b_user, format('select * from public.my_dogs where id = %L', b_dog));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('their own household', 'their dog', '1 row', n::text, case when n = 1 then 'PASS' else 'FAIL' end);

  n := public.probe_read(b_user, format('select * from public.my_packages where id = %L', b_pkg));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('their own household', 'their package', '1 row', n::text, case when n = 1 then 'PASS' else 'FAIL' end);

  n := public.probe_read(b_user, format('select * from public.my_stays where id = %L', b_stay));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('their own household', 'their stay', '1 row', n::text, case when n = 1 then 'PASS' else 'FAIL' end);

  n := public.probe_read(b_user, format('select * from public.my_payments where id = %L', b_pay));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('their own household', 'their invoice', '1 row', n::text, case when n = 1 then 'PASS' else 'FAIL' end);

  n := public.probe_read(b_user, format('select * from public.my_documents where id = %L', b_doc));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('their own household', 'their vaccination record', '1 row', n::text, case when n = 1 then 'PASS' else 'FAIL' end);

  n := public.probe_read(b_user, 'select * from public.my_household');
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('their own household', 'their own details', '1 row', n::text, case when n = 1 then 'PASS' else 'FAIL' end);

  n := public.probe_read(b_user, 'select * from public.my_visits');
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('their own household', 'their visit history', 'more than 0 rows', n::text, case when n > 0 then 'PASS' else 'FAIL' end);

  n := public.probe_read(b_user, 'select * from public.settings');
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('their own household', 'prices and branding, so the site renders', '1 row', n::text, case when n = 1 then 'PASS' else 'FAIL' end);

  -- Asserted on the value, for the reason given above.
  code := public.probe_write(b_user,
    'select public.update_my_household(''Updated by the portal'', ''portal@example.invalid'', ''1 Test Street'', ''San Francisco'', ''CA'', ''94123'', ''Emergency Person'', ''(415) 555-0100'', ''friend'', ''Test Vet'', ''(415) 555-0101'', ''2 Vet Street'')');
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('their own household', 'update their own details', 'the row actually changes',
          coalesce((select emergency_name from public.owners where id = b_owner), 'unchanged'),
          case when (select emergency_name from public.owners where id = b_owner) = 'Emergency Person'
               then 'PASS' else 'FAIL' end);

  -- The same call must not have reached across. A returns-void function
  -- that quietly wrote to the wrong row would look identical from here
  -- without this line.
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('their own household', 'that update did not touch the other household', 'unchanged',
          case when (select owner_name from public.owners where id = a_owner) is distinct from 'Updated by the portal'
               then 'untouched' else 'CHANGED' end,
          case when (select owner_name from public.owners where id = a_owner) is distinct from 'Updated by the portal'
               then 'PASS' else 'FAIL' end);

  code := public.probe_write(b_user, format(
    'insert into public.dog_docs (dog_id, kind, file_name, mime_type, data) values (%L, ''vaccination'', ''%s'', ''image/jpeg'', ''x'')',
    b_dog, marker));
  select count(*) into n from public.dog_docs where dog_id = b_dog and file_name = marker;
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('their own household', 'upload a replacement record for their own dog', 'the row is there', n::text || ' on file',
          case when code = 'ALLOWED' and n = 2 then 'PASS' else 'FAIL' end);

  code := public.probe_write(b_user, format(
    'insert into public.boarding_requests (phone, owner_name, last_name, dog_names, start_date, end_date, status, source, data) values (''x'', ''x'', ''x'', array[''x''], current_date + 30, current_date + 32, ''pending'', ''portal'', %L)',
    ('{"marker":"' || marker || '"}')::jsonb));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('their own household', 'submit a boarding request', 'ALLOWED', code,
          case when code = 'ALLOWED' then 'PASS' else 'FAIL' end);

  -- A request submitted by a client must arrive stamped with their own
  -- household and their own number, whatever the form said. The insert
  -- above deliberately sent a junk phone.
  select count(*) into n
  from public.boarding_requests r
  join public.owners o on o.id = r.owner_id
  where r.data ->> 'marker' = marker
    and r.owner_id = b_owner
    and r.phone = o.phone;
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('their own household', 'that request is stamped with their household, not the form', '1 row', n::text,
          case when n = 1 then 'PASS' else 'FAIL' end);

  -- -----------------------------------------------------------------
  -- 7. A signed-out visitor, for completeness. The anon key ships in the
  --    JavaScript of the public website, so this is the widest audience
  --    any of these tables has.
  -- -----------------------------------------------------------------
  -- Both answers are collected while the role is anon and recorded after it
  -- has been handed back: the results table belongs to the owner, and a
  -- visitor writing to it would be its own small failure.
  set local role anon;
  begin
    execute 'select count(*) from public.dogs' into anon_dogs;
  exception when others then
    anon_dogs := -1;
  end;
  begin
    execute 'select count(*) from public.my_dogs' into anon_views;
  exception when others then
    anon_views := -1;
  end;
  reset role;

  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('signed out', 'every dog with the public key', '0 rows or refused', anon_dogs::text,
          case when anon_dogs <= 0 then 'PASS' else 'FAIL' end);

  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('signed out', 'the client views with the public key', 'refused',
          case when anon_views = -1 then 'refused' else anon_views::text end,
          case when anon_views = -1 then 'PASS' else 'FAIL' end);

  -- -----------------------------------------------------------------
  -- 8. A stranger with an account.
  --
  -- The shape that matters most and is easiest to forget: a real session,
  -- no staff role, no household claimed. Anybody who signs themselves up
  -- is this, and the portal needs sign-ups to be open so somebody can set a
  -- password from their invitation link. The whole argument for allowing
  -- that is the block below - an account on its own inherits nothing, so
  -- the invitation token is what grants access rather than the sign-up
  -- gate. If any line here fails, that argument fails with it and sign-ups
  -- have to be closed again.
  -- -----------------------------------------------------------------
  stranger := gen_random_uuid();
  insert into auth.users (id, email) values (stranger, 'isolation-test-stranger@example.invalid');

  foreach probe_table in array array[
    'dogs', 'owners', 'signins', 'boardings', 'packages', 'package_uses',
    'payments', 'vaccinations', 'meal_logs', 'walk_logs', 'dog_docs',
    'enrollments', 'boarding_requests', 'staff_roles', 'audit_log',
    'my_dogs', 'my_household', 'my_visits', 'my_payments', 'my_documents',
    'my_packages', 'my_stays', 'my_vaccinations', 'my_boarding_requests'
  ] loop
    n := public.probe_read(stranger, format('select * from public.%I', probe_table));
    insert into isolation_results (area, probe, expected, actual, verdict)
    values ('an account and nothing else', 'read ' || probe_table, '0 rows', n::text,
            case when n = 0 then 'PASS' else 'FAIL' end);
  end loop;

  -- The exception, and it is deliberate. settings, site_photos and reviews
  -- are readable by a signed-out visitor already, so a signed-in one must
  -- not have to clear a higher bar. This started as a failure: the cell was
  -- is_customer, and somebody who had set a password but not yet finished
  -- claiming lost the business name and colours on the claim page.
  n := public.probe_read(stranger, 'select * from public.settings');
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('an account and nothing else', 'read settings, so the page has a name on it', '1 row', n::text,
          case when n = 1 then 'PASS' else 'FAIL' end);

  code := public.probe_write(stranger, format(
    'select public.claim_owner_invite(%L)', gen_random_uuid()));
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('an account and nothing else', 'claim a guessed token', 'refused', code,
          case when code <> 'ALLOWED' then 'PASS' else 'FAIL' end);

  code := public.probe_write(stranger,
    'select public.update_my_household(''X'', ''x@example.invalid'', null, null, null, null, null, null, null, null, null, null)');
  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('an account and nothing else', 'change somebody details', 'refused', code,
          case when code <> 'ALLOWED' then 'PASS' else 'FAIL' end);

  -- A staff account must not also be able to become a household.
  select user_id into staff_user from public.staff_roles limit 1;
  if staff_user is not null then
    update public.owners set invite_token = gen_random_uuid(), invited_at = now() where id = a_owner;
    select invite_token into spare_token from public.owners where id = a_owner;
    code := public.probe_write(staff_user, format('select public.claim_owner_invite(%L)', spare_token));
    insert into isolation_results (area, probe, expected, actual, verdict)
    values ('an account and nothing else', 'a staff account claiming a household', 'refused', code,
            case when code <> 'ALLOWED' then 'PASS' else 'FAIL' end);
    update public.owners set invite_token = null, invited_at = null where id = a_owner;
  end if;

  delete from auth.users where id = stranger;

  -- -----------------------------------------------------------------
  -- Put everything back.
  --
  -- The claims have to go first. They are transaction-local rather than
  -- function-local, so they outlive the last probe, and with them still set
  -- the owners_customer_guard trigger would see the cleanup as the client
  -- editing their own row and refuse to let go of the fields it protects -
  -- which are exactly the fields being put back.
  -- -----------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);

  delete from public.dog_docs where file_name = marker;
  delete from public.payments where note = marker;
  delete from public.boarding_requests where data ->> 'marker' = marker;

  -- invited_at is restored too, and it was not the first time round. A run
  -- left it set on a household nobody had invited, which showed on the owner
  -- profile as an invitation that had been sent. A test that tidies up
  -- almost everything is how a database drifts.
  update public.owners set
    user_id = a_prev_user, claimed_at = a_claimed, invited_at = a_invited, invite_token = null
  where id = a_owner;
  update public.owners set
    owner_name = b_before.owner_name,
    email = b_before.email,
    address = b_before.address,
    city = b_before.city,
    state = b_before.state,
    zip = b_before.zip,
    emergency_name = b_before.emergency_name,
    emergency_phone = b_before.emergency_phone,
    emergency_relation = b_before.emergency_relation,
    vet_name = b_before.vet_name,
    vet_phone = b_before.vet_phone,
    vet_address = b_before.vet_address,
    user_id = b_prev_user,
    claimed_at = b_claimed,
    invited_at = b_invited,
    invite_token = null
  where id = b_owner;
  delete from auth.users where id in (a_user, b_user);

  alter table public.owners enable trigger audit_changes;
  alter table public.dog_docs enable trigger audit_changes;
  alter table public.payments enable trigger audit_changes;
  alter table public.boarding_requests enable trigger audit_changes;

  insert into isolation_results (area, probe, expected, actual, verdict)
  values ('cleanup', 'fixture accounts, payments and documents removed', 'none left',
          (select count(*)::text from auth.users where email like 'isolation-test-%@example.invalid'),
          case when not exists (select 1 from auth.users where email like 'isolation-test-%@example.invalid')
               then 'PASS' else 'FAIL' end);
end
$test$;

-- The probes are dropped at the end of the file. Anything that can step down
-- to another role and run arbitrary SQL is a testing tool, not something to
-- leave sitting in a production schema.

-- ---------------------------------------------------------------------
-- The result. Every line should read PASS.
-- ---------------------------------------------------------------------
select area, probe, expected, actual, verdict
from isolation_results
order by seq;

select
  count(*) as probes,
  count(*) filter (where verdict = 'PASS') as passed,
  count(*) filter (where verdict = 'FAIL') as failed
from isolation_results;

drop function if exists public.probe_read(uuid, text);
drop function if exists public.probe_write(uuid, text);
