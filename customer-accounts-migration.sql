-- Customer accounts: a real household identity, and the claim that binds an
-- account to it.
--
-- NOTE: no apostrophe or quote character appears in any comment below. The
-- Supabase SQL editor splits statements on semicolons using a naive scanner
-- that treats a lone apostrophe in a comment as the start of a string
-- literal, which makes it swallow every semicolon after it and report one
-- confusing syntax error for the whole file.
--
-- ---------------------------------------------------------------------
-- Why this file is mostly a backfill
-- ---------------------------------------------------------------------
--
-- Until now a household was a PHONE NUMBER STRING. Every child table - dogs,
-- packages, boardings, signins, payments - carried a phone column and that
-- was the only thing tying them together. There was no owners.id anywhere
-- except in the owners table itself.
--
-- A policy of the shape
--
--     phone in (select phone from owners where user_id = auth.uid())
--
-- would inherit every inconsistency in that string. The application already
-- strips non-digits before comparing numbers, which is the tell: the stored
-- formats vary. Such a policy fails closed when a format differs - a client
-- silently cannot see their own dog - and that is the BETTER failure. The
-- worse one is two households whose numbers normalise to the same digits
-- reading each other.
--
-- So the isolation is built on a real key. Every table a customer can reach
-- gets owner_id, a foreign key to owners.id, backfilled once from the phone
-- grouping under a check that refuses to finish if the grouping is ambiguous
-- or leaves anything unattached. After this runs, the phone column is still
-- there and staff screens still use it; nothing about access control does.
--
-- ---------------------------------------------------------------------
-- RUN ORDER
-- ---------------------------------------------------------------------
--
--   1. security-roles-migration.sql
--   2. security-audit-migration.sql
--   3. security-exports-migration.sql
--   4. customer-accounts-migration.sql   this file
--   5. rls-lockdown.sql
--
-- This file grants nobody anything. It adds columns, a backfill, functions
-- and views, and it leaves the new views readable only by accounts that have
-- claimed a household. The policies that let a customer read at all arrive in
-- step 5, which refuses to run until this one has.
--
-- Safe to run more than once. The backfill and its verification are one DO
-- block, which is one statement, which is one transaction: if the data does
-- not support the guarantee, nothing is written and the database is left
-- exactly as it was.

-- ---------------------------------------------------------------------
-- 0. Refuse to run out of order.
-- ---------------------------------------------------------------------

do $preflight$
begin
  if to_regclass('public.staff_roles') is null then
    raise exception 'staff_roles does not exist. Run security-roles-migration.sql first - the customer policies sit alongside the staff ones and share the same matrix.';
  end if;
  if to_regclass('public.owners') is null then
    raise exception 'The owners table does not exist. Nothing here has a household to attach to.';
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------
-- 1. One definition of what a phone number is.
--
-- Used by the backfill, by the trigger that keeps owner_id filled in, and by
-- the index that makes both quick. Immutable so it can be indexed: without
-- the index the fallback lookup is a sequential scan of every owner on every
-- insert, which the kiosk would feel.
-- ---------------------------------------------------------------------

create or replace function public.phone_digits(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g')
$fn$;

create index if not exists owners_phone_digits_idx
  on public.owners (public.phone_digits(phone));

-- ---------------------------------------------------------------------
-- 2. The household identity, and the invitation that binds an account to it.
--
-- 498 households already exist with no login. A customer must NOT be able to
-- claim one by typing a phone number: guessing a phone number is trivial, and
-- handing somebody a household because they guessed its number is precisely
-- the isolation failure this work exists to prevent.
--
-- So claiming is staff-initiated. Staff issue an invitation, the token goes
-- by email to the address already on file, and holding that token is what
-- proves control of the address. There is no self-service route in, by
-- design - see claim_owner_invite below, which is the only way user_id is
-- ever set through the API.
-- ---------------------------------------------------------------------

alter table public.owners add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.owners add column if not exists invite_token uuid;
alter table public.owners add column if not exists invited_at timestamptz;
alter table public.owners add column if not exists claimed_at timestamptz;

-- One account, one household. Without this a bug in the claim path could
-- attach the same login to two households and the isolation question would
-- have no answer.
create unique index if not exists owners_user_id_key on public.owners (user_id) where user_id is not null;
create unique index if not exists owners_invite_token_key on public.owners (invite_token) where invite_token is not null;

comment on column public.owners.user_id is
  'The Supabase account that has claimed this household. Set only by claim_owner_invite.';
comment on column public.owners.invite_token is
  'One-time claim token, emailed to the address on file. Cleared the moment it is used.';

-- ---------------------------------------------------------------------
-- 3. owner_id on everything a customer can reach.
--
-- Nullable on purpose. Making it not null would mean every existing insert
-- path in the application - the kiosk sign-in, the enrollment approval, the
-- package sale - had to be changed in the same breath or the app would stop
-- working. The trigger in section 6 fills it in instead, so a row written
-- tomorrow by code that has never heard of owner_id still lands in the right
-- household. A null here means one thing only: a row with no phone number on
-- it, which has no household to belong to.
--
-- on delete set null rather than cascade: deleting an owner record should
-- orphan the history, not destroy it. An orphaned row is invisible to every
-- customer and still visible to staff, which is the safe direction.
-- ---------------------------------------------------------------------

do $columns$
declare
  t text;
begin
  foreach t in array array[
    'dogs', 'packages', 'boardings', 'signins', 'payments', 'dog_docs',
    -- Not in the original list, and not optional: a signed-in customer is
    -- authenticated but holds no staff role, so without a customer policy
    -- here the portal could not file a request at all. And a request a
    -- customer cannot see the status of gets submitted again, and again.
    'boarding_requests'
  ] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format(
      'alter table public.%I add column if not exists owner_id uuid references public.owners(id) on delete set null',
      t
    );
    execute format(
      'create index if not exists %I on public.%I (owner_id)',
      t || '_owner_id_idx', t
    );
  end loop;
end
$columns$;

-- ---------------------------------------------------------------------
-- 4. The backfill, and the verification that decides whether to keep it.
--
-- Everything in this block either happens or does not. The order matters:
--
--   a. Refuse if the phone grouping is ambiguous. Two owner rows whose
--      numbers normalise to the same digits means the old grouping was
--      already wrong and no backfill can be trusted. Better to stop here
--      than to hand one household the records belonging to another.
--   b. Give every phone that appears in a child table an owner row, so
--      nothing is left unattached for want of a parent.
--   c. Attach: exact match first, normalised match for the rest.
--   d. Verify. Any row that has a phone and still has no owner_id, or whose
--      owner_id disagrees with its own phone, aborts the whole thing.
--
-- The audit triggers are lifted for the duration. A backfill is one
-- migration, not six hundred staff edits to customer files, and leaving them
-- on would bury the real log under noise attributed to nobody.
-- ---------------------------------------------------------------------

do $backfill$
declare
  -- Every table below that carries an audit_changes trigger. boarding_requests
  -- is here because its trigger fires on update, and the backfill updates it.
  audited text[] := array[
    'dogs', 'owners', 'dog_docs', 'packages', 'payments', 'boardings',
    'boarding_requests'
  ];
  phone_tables text[] := array['dogs', 'packages', 'boardings', 'signins', 'payments', 'boarding_requests'];
  -- The tables where an unattached row is a failure. boarding_requests is
  -- deliberately not among them: it is a PUBLIC form, and a request from
  -- somebody who is not a client yet has no household to belong to. That is
  -- a true statement about the row rather than a gap in the backfill, and
  -- the first run of this migration found exactly one. A request submitted
  -- from the portal always has an owner_id, because the trigger stamps it
  -- from the session rather than reading it off the form.
  strict_tables text[] := array['dogs', 'packages', 'boardings', 'signins', 'payments'];
  t text;
  ambiguous text;
  created int;
  orphans int;
  mismatched int;
  total_orphans int := 0;
  total_mismatched int := 0;
  report text := '';
begin
  -- a. Ambiguity.
  select string_agg(digits || ' (' || n || ' owners)', ', ')
  into ambiguous
  from (
    select public.phone_digits(phone) as digits, count(*) as n
    from public.owners
    where public.phone_digits(phone) <> ''
    group by 1
    having count(*) > 1
  ) d;

  if ambiguous is not null then
    raise exception 'Refusing to backfill: these numbers belong to more than one owner row, so the phone grouping cannot say which household a dog is in: %. Merge them first.', ambiguous;
  end if;

  -- Lift the audit triggers.
  foreach t in array audited loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I disable trigger audit_changes', t);
    end if;
  end loop;

  -- b. A parent for every phone that appears anywhere.
  --
  -- These are households the app has records for and no owner row - a dog
  -- signed in at the kiosk under a number nobody ever filled in a profile
  -- for. They need a row to point at, or the verification below would fail
  -- for a reason that is the old schema rather than a mistake in the data.
  with everyone as (
    select phone from public.dogs where phone is not null
    union select phone from public.packages where phone is not null
    union select phone from public.boardings where phone is not null
    union select phone from public.signins where phone is not null
    union select phone from public.payments where phone is not null
  ),
  missing as (
    select distinct e.phone
    from everyone e
    where public.phone_digits(e.phone) <> ''
      and not exists (
        select 1 from public.owners o
        where o.phone = e.phone
           or public.phone_digits(o.phone) = public.phone_digits(e.phone)
      )
  )
  insert into public.owners (phone, notes)
  select m.phone, 'Created by customer-accounts-migration: records existed on this number with no owner profile.'
  from missing m
  on conflict (phone) do nothing;

  get diagnostics created = row_count;

  -- c. Attach. Exact first: it is the common case and it cannot be wrong.
  foreach t in array phone_tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format(
      'update public.%I c set owner_id = o.id from public.owners o
       where c.owner_id is null and c.phone is not null and o.phone = c.phone',
      t
    );

    -- Then the normalised fallback, for rows written with a different
    -- format from the one the owner profile carries. Unambiguous by now:
    -- step (a) proved no two owners share a normalised number.
    execute format(
      'update public.%I c set owner_id = o.id from public.owners o
       where c.owner_id is null and c.phone is not null
         and public.phone_digits(c.phone) <> ''''
         and public.phone_digits(o.phone) = public.phone_digits(c.phone)',
      t
    );
  end loop;

  -- Documents hang off a dog rather than a phone, so they follow the dog.
  if to_regclass('public.dog_docs') is not null then
    update public.dog_docs d
    set owner_id = g.owner_id
    from public.dogs g
    where d.dog_id = g.id and d.owner_id is distinct from g.owner_id;
  end if;

  -- d. Verify, and abort if the guarantee does not hold.
  --
  -- Every table is checked for a row attached to the WRONG household, which
  -- is never acceptable anywhere. Only the strict tables are checked for
  -- rows attached to no household at all.
  foreach t in array phone_tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    if t = any (strict_tables) then
      execute format(
        'select count(*) from public.%I where owner_id is null and phone is not null and public.phone_digits(phone) <> ''''',
        t
      ) into orphans;
    else
      orphans := 0;
    end if;

    execute format(
      'select count(*) from public.%I c join public.owners o on o.id = c.owner_id
       where public.phone_digits(o.phone) <> public.phone_digits(c.phone)',
      t
    ) into mismatched;

    total_orphans := total_orphans + orphans;
    total_mismatched := total_mismatched + mismatched;
    if orphans > 0 or mismatched > 0 then
      report := report || format('%s: %s unattached, %s attached to the wrong household. ', t, orphans, mismatched);
    end if;
  end loop;

  if to_regclass('public.dog_docs') is not null then
    select count(*) into orphans
    from public.dog_docs d join public.dogs g on g.id = d.dog_id
    where d.owner_id is distinct from g.owner_id;
    total_mismatched := total_mismatched + orphans;
    if orphans > 0 then
      report := report || format('dog_docs: %s attached to a different household from their own dog. ', orphans);
    end if;
  end if;

  if total_orphans > 0 or total_mismatched > 0 then
    raise exception 'Backfill left records the isolation cannot cover, so nothing has been written: %', report;
  end if;

  -- Put the audit triggers back. Not in an exception handler on purpose:
  -- if anything above raised, the whole transaction rolls back and the
  -- triggers were never disabled.
  foreach t in array audited loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable trigger audit_changes', t);
    end if;
  end loop;

  -- Rows with no phone at all are reported rather than treated as a
  -- failure. A sign-in with no number on it has no household - that is a
  -- fact about the row, not a fault in the backfill. It will be invisible
  -- to every customer, which is correct.
  select count(*) into orphans from public.signins where phone is null or public.phone_digits(phone) = '';
  select count(*) into mismatched from public.boarding_requests where owner_id is null;
  raise notice 'Backfill complete. Owner rows created for unattached numbers: %. Sign-ins with no phone number, which belong to no household: %. Boarding requests from numbers that are not clients: %.', created, orphans, mismatched;
end
$backfill$;

-- ---------------------------------------------------------------------
-- 5. Who the caller is.
--
-- customer_owner_id is the whole of the customer half of the permission
-- system. Every customer policy and every view below is that function
-- compared against a column, and nothing else.
--
-- It returns null unless the account has claimed a household, so a signed-in
-- account that is halfway through claiming, or a staff account, or an
-- account somebody created by hand, all get null - and null compared to a
-- uuid column is null, which is not true, which is no rows. The failure
-- direction is closed.
--
-- security definer because a customer cannot read the owners table directly,
-- and search_path is pinned empty with every name schema-qualified: without
-- that, a caller able to create a table called owners earlier on their own
-- search path could decide which household they are in.
-- ---------------------------------------------------------------------

create or replace function public.customer_owner_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select o.id
  from public.owners o
  where o.user_id = auth.uid()
    and o.claimed_at is not null
$fn$;

create or replace function public.is_customer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.customer_owner_id() is not null
$fn$;

do $grants$
declare
  fn text;
begin
  foreach fn in array array['public.customer_owner_id()', 'public.is_customer()'] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end
$grants$;

-- ---------------------------------------------------------------------
-- 6. Keeping owner_id true.
--
-- A backfill that is right once and wrong the next morning is not an
-- isolation guarantee. Two things can break it: a row written by code that
-- does not set owner_id, and a row whose phone number is later changed.
-- This handles both.
--
-- It also takes the decision away from the caller. A customer does not get
-- to say which household a row they are writing belongs to - the trigger
-- stamps it from the session. That is what turns the insert policies below
-- from a check on a value the client chose into a check on a value the
-- database chose.
-- ---------------------------------------------------------------------

create or replace function public.fill_owner_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  cust uuid;
  found uuid;
  digits text;
begin
  cust := public.customer_owner_id();

  -- Documents follow their dog, whoever is writing. A customer uploading
  -- against a dog from another household therefore gets that household on
  -- the row, and the with check on the insert policy refuses it - rather
  -- than the row being filed under their own household while pointing at a
  -- dog that is not theirs.
  if tg_table_name = 'dog_docs' then
    if new.dog_id is not null then
      select d.owner_id into new.owner_id from public.dogs d where d.id = new.dog_id;
    elsif cust is not null then
      new.owner_id := cust;
    end if;
    return new;
  end if;

  if cust is not null then
    new.owner_id := cust;
    if tg_table_name = 'boarding_requests' then
      -- The queue matches dogs by the phone on the request, and the draft
      -- inside data is what the approval actually reads. Both come from the
      -- account rather than from the form, so a request cannot arrive
      -- claiming to be from a number that is not theirs.
      select o.phone into new.phone from public.owners o where o.id = cust;
      new.data := jsonb_set(coalesce(new.data, '{}'::jsonb), '{phone}', to_jsonb(new.phone));
    end if;
    return new;
  end if;

  -- A number that changed belongs to a different household now.
  if tg_op = 'UPDATE' and new.phone is distinct from old.phone then
    new.owner_id := null;
  end if;

  if new.owner_id is not null then
    return new;
  end if;
  if new.phone is null then
    return new;
  end if;

  select o.id into found from public.owners o where o.phone = new.phone;
  if found is null then
    digits := public.phone_digits(new.phone);
    if digits <> '' then
      select o.id into found from public.owners o where public.phone_digits(o.phone) = digits limit 1;
    end if;
  end if;

  new.owner_id := found;
  return new;
end
$fn$;

-- A dog that moves household takes its paperwork with it. Without this the
-- dog is reattached and its vaccination records are left pointing at the old
-- household, which is a leak that appears weeks after the migration and
-- looks like nothing to do with it.
create or replace function public.resync_dog_docs_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.owner_id is distinct from old.owner_id then
    update public.dog_docs set owner_id = new.owner_id where dog_id = new.id;
  end if;
  return new;
end
$fn$;

do $triggers$
declare
  t text;
begin
  foreach t in array array[
    'dogs', 'packages', 'boardings', 'signins', 'payments', 'dog_docs', 'boarding_requests'
  ] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop trigger if exists fill_owner_id on public.%I', t);
    execute format(
      'create trigger fill_owner_id before insert or update on public.%I for each row execute function public.fill_owner_id()',
      t
    );
  end loop;

  drop trigger if exists resync_dog_docs_owner on public.dogs;
  create trigger resync_dog_docs_owner
    after update on public.dogs
    for each row execute function public.resync_dog_docs_owner();
end
$triggers$;

-- ---------------------------------------------------------------------
-- 7. What a customer may change about themselves.
--
-- RLS decides which ROWS a customer may update - their own owner row and
-- nothing else. It cannot express which COLUMNS, and the difference matters
-- here more than anywhere: user_id, claimed_at and invite_token live on this
-- row. An update policy on its own would let a customer rewrite the very
-- fields that decide which household they are, and phone is the key the
-- whole backfill was built on.
--
-- So the same shape as staff_roles_guard: the policy opens the door, the
-- trigger decides what may come through it. Contact details, and nothing
-- else.
-- ---------------------------------------------------------------------

create or replace function public.owners_customer_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  allowed text[] := array[
    'owner_name', 'email', 'address', 'city', 'state', 'zip',
    'emergency_name', 'emergency_phone', 'emergency_relation',
    'vet_name', 'vet_phone', 'vet_address'
  ];
  changed text[];
begin
  -- Only the customer who owns this row is guarded. Staff editing a profile,
  -- and the claim function binding an account to it, both run with
  -- customer_owner_id pointing somewhere else or nowhere.
  if public.customer_owner_id() is distinct from old.id then
    return new;
  end if;

  select array_agg(e.key order by e.key) into changed
  from jsonb_each_text(to_jsonb(new)) e
  where e.value is distinct from (to_jsonb(old) ->> e.key)
    and not (e.key = any (allowed));

  if changed is not null then
    raise exception 'A customer account can change its contact details, not %', array_to_string(changed, ', ')
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end
$fn$;

drop trigger if exists owners_customer_guard on public.owners;
create trigger owners_customer_guard
  before update on public.owners
  for each row execute function public.owners_customer_guard();

-- ---------------------------------------------------------------------
-- 8. Issuing, claiming and revoking.
--
-- The only three ways owners.user_id ever moves. All three are functions
-- rather than policies because each of them has to check something a policy
-- cannot say, and because the claim in particular must run before the caller
-- is a customer - there is nothing yet for a policy to match on.
-- ---------------------------------------------------------------------

-- How long an invitation stays good for.
--
-- The enrollment details link deliberately has no expiry, and the reasoning
-- there was sound: an owner who fills the form in three weeks later is
-- normal. This is a different thing. That link opens a form; this one hands
-- over permanent read access to a household, and it sits in an inbox
-- afterwards. Two weeks, and re-sending is one click.
create or replace function public.owner_invite_days()
returns int
language sql
immutable
set search_path = ''
as $fn$
  select 14
$fn$;

create or replace function public.issue_owner_invite(p_owner_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  o public.owners%rowtype;
  token uuid;
begin
  if not public.at_least_employee() then
    raise exception 'Inviting a client to their account needs a staff account.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into o from public.owners where id = p_owner_id;
  if not found then
    raise exception 'No such owner record.';
  end if;

  -- Re-inviting a household that already has an account would email a fresh
  -- key to whatever address is on file now, which is not necessarily the
  -- person holding the account. Unbinding first is an owner decision.
  if o.claimed_at is not null then
    raise exception 'That household has already claimed its account. An owner or admin can unbind it first.'
      using errcode = 'insufficient_privilege';
  end if;

  if o.email is null or length(trim(o.email)) = 0 then
    raise exception 'There is no email address on file for that household, and the invitation has nowhere to go.';
  end if;

  token := gen_random_uuid();
  update public.owners
  set invite_token = token, invited_at = now()
  where id = p_owner_id;

  perform public.audit_write(
    'customer.invited',
    'owners',
    p_owner_id::text,
    'Invited a client to claim their account',
    jsonb_build_object('household', o.phone)
  );

  return token;
end
$fn$;

create or replace function public.claim_owner_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  o public.owners%rowtype;
  mine uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first, then open the link again.'
      using errcode = 'insufficient_privilege';
  end if;

  -- A staff account must not also be a household. It would give one person
  -- two identities, and every line the audit log wrote about them would be
  -- ambiguous about which one was acting.
  if public.staff_role() is not null then
    raise exception 'That is a staff account. Client accounts are separate.'
      using errcode = 'insufficient_privilege';
  end if;

  select id into mine from public.owners where user_id = auth.uid();

  select * into o
  from public.owners
  where invite_token = p_token and claimed_at is null;

  if not found then
    -- Already used, never existed, or revoked - one message for all three.
    -- Telling the difference would turn this into an oracle for which
    -- tokens are real.
    if mine is not null then
      return mine;
    end if;
    raise exception 'That invitation is not valid any more. Ask us to send a new one.'
      using errcode = 'insufficient_privilege';
  end if;

  if o.invited_at is null or o.invited_at < now() - make_interval(days => public.owner_invite_days()) then
    raise exception 'That invitation is not valid any more. Ask us to send a new one.'
      using errcode = 'insufficient_privilege';
  end if;

  if mine is not null and mine <> o.id then
    raise exception 'This account already belongs to another household.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.owners
  set user_id = auth.uid(), claimed_at = now(), invite_token = null
  where id = o.id;

  perform public.audit_write(
    'customer.claimed',
    'owners',
    o.id::text,
    'A client claimed their account',
    jsonb_build_object('household', o.phone)
  );

  return o.id;
end
$fn$;

-- ---------------------------------------------------------------------
-- 8b. The server half of the claim.
--
-- claim_owner_invite above binds an account that already exists and is
-- already signed in. These two are for the case that account does NOT exist
-- yet, which is the normal one: somebody opening the link for the first
-- time.
--
-- They exist because of a hole worth naming. The first version of the claim
-- page asked the person to type an email address and called signUp with it
-- in the browser. Nothing stopped them typing a different address from the
-- one the invitation was sent to - so a forwarded link could be claimed by
-- whoever it was forwarded to, under their own address, and the whole
-- argument for this design (the token went to the address on file, so
-- holding it proves control of that address) quietly stopped being true.
--
-- The address is therefore never supplied by the browser and never shown to
-- it. The server reads it off the owner record, creates the account with it,
-- and binds the household - and if the binding fails, the account it just
-- created is removed rather than left behind with no household.
--
-- Only the service role may call these. They are reachable exclusively from
-- app/api/claim/route.ts, which holds the secret key.
-- ---------------------------------------------------------------------

create or replace function public.invite_email_for_token(p_token uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select o.email
  from public.owners o
  where o.invite_token = p_token
    and o.claimed_at is null
    and o.invited_at is not null
    and o.invited_at >= now() - make_interval(days => public.owner_invite_days())
$fn$;

create or replace function public.bind_owner_account(p_token uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  o public.owners%rowtype;
begin
  select * into o
  from public.owners
  where invite_token = p_token and claimed_at is null;

  if not found then
    raise exception 'That invitation is not valid any more.'
      using errcode = 'insufficient_privilege';
  end if;

  if o.invited_at is null or o.invited_at < now() - make_interval(days => public.owner_invite_days()) then
    raise exception 'That invitation is not valid any more.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.owners where user_id = p_user_id) then
    raise exception 'That account already belongs to a household.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.staff_roles where user_id = p_user_id) then
    raise exception 'That is a staff account. Client accounts are separate.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.owners
  set user_id = p_user_id, claimed_at = now(), invite_token = null
  where id = o.id;

  -- Written straight to the log rather than through audit_write, which
  -- needs a session to attribute the entry to and there is none here: the
  -- route is holding the secret key, not a token. The actor is the account
  -- that was just created, which is the honest answer to who claimed it.
  insert into public.audit_log (
    actor_id, actor_email, actor_role, action, entity, entity_id, summary, detail
  )
  values (
    p_user_id,
    (select u.email from auth.users u where u.id = p_user_id),
    'customer',
    'customer.claimed',
    'owners',
    o.id::text,
    'A client set up their account from the invitation link',
    jsonb_build_object('household', o.phone)
  );

  return o.id;
end
$fn$;

do $servergrants$
declare
  fn text;
begin
  foreach fn in array array[
    'public.invite_email_for_token(uuid)',
    'public.bind_owner_account(uuid, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$servergrants$;

create or replace function public.revoke_owner_claim(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_owner_admin() then
    raise exception 'Unbinding a client account is an owner or admin decision.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.owners
  set user_id = null, claimed_at = null, invite_token = null
  where id = p_owner_id;

  perform public.audit_write(
    'customer.revoked',
    'owners',
    p_owner_id::text,
    'Unbound a client account from its household',
    '{}'::jsonb
  );
end
$fn$;

do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'public.issue_owner_invite(uuid)',
    'public.claim_owner_invite(uuid)',
    'public.revoke_owner_claim(uuid)',
    'public.owner_invite_days()'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end
$grants$;

-- ---------------------------------------------------------------------
-- 9. What a customer reads.
--
-- Row Level Security answers WHICH ROWS. It has no answer for WHICH COLUMNS,
-- and several of these tables carry a column staff write for each other:
--
--   signins.staff_note        the handover note, marked internal in the
--                             types file and never printed on a day sheet
--   signins.meet_greet_note   why a dog passed or failed
--   dogs.notes                the staff note on a dog
--   owners.notes              the staff note on a household
--   boardings.notes           what the front desk needs to know for the stay
--   payments.note             why a payment was taken the way it was
--
-- A row policy that let a customer select from signins would let them ask
-- for select=* over the REST API and read every one of those about their own
-- household. Not selecting the column in the client is not a control - the
-- client is theirs.
--
-- So a customer never reads a base table. Each read goes through one of
-- these views, which names its columns, and the base table refuses them
-- outright. The column list below IS the specification of what a customer
-- can see; there is no second place where that is decided.
--
-- Each view runs as its owner and therefore is not itself subject to RLS -
-- the where clause is the isolation, and it is the same clause every time.
-- customer_owner_id returns null for staff and for anybody who has not
-- claimed a household, and owner_id = null is null, not true, so the failure
-- direction is no rows rather than all of them.
--
-- Dropped rather than replaced: create or replace view refuses to change a
-- column list, so a re-run after an edit here would otherwise fail.
-- ---------------------------------------------------------------------

drop view if exists public.my_household;
create view public.my_household as
  select
    o.id, o.phone, o.owner_name, o.email,
    o.address, o.city, o.state, o.zip,
    o.emergency_name, o.emergency_phone, o.emergency_relation,
    o.vet_name, o.vet_phone, o.vet_address,
    o.claimed_at
  from public.owners o
  where o.id = public.customer_owner_id();

drop view if exists public.my_dogs;
create view public.my_dogs as
  select
    d.id, d.owner_id, d.dog_name, d.last_name,
    d.breed, d.sex, d.fixed_status, d.birthdate, d.weight_lb, d.color,
    d.photo_data, d.waiver_on_file,
    d.allergies, d.health_problems, d.health_notes, d.activity_restrictions,
    d.authorized_pickup, d.vet,
    d.meet_greet_on, d.enrolled_at, d.created_at
  from public.dogs d
  where d.owner_id = public.customer_owner_id();

drop view if exists public.my_vaccinations;
create view public.my_vaccinations as
  select v.id, v.dog_id, v.vaccine, v.given_on, v.expires_on, v.created_at
  from public.vaccinations v
  where v.dog_id in (
    select d.id from public.dogs d where d.owner_id = public.customer_owner_id()
  );

drop view if exists public.my_documents;
create view public.my_documents as
  select d.id, d.owner_id, d.dog_id, d.kind, d.file_name, d.mime_type, d.data, d.created_at
  from public.dog_docs d
  where d.owner_id = public.customer_owner_id();

drop view if exists public.my_packages;
create view public.my_packages as
  select
    p.id, p.owner_id, p.client_name, p.dog_name, p.kind,
    p.total_days, p.days_used, p.price, p.created_at
  from public.packages p
  where p.owner_id = public.customer_owner_id();

drop view if exists public.my_package_uses;
create view public.my_package_uses as
  select u.id, u.package_id, u.dog_id, u.dog_name, u.used_on, u.created_at
  from public.package_uses u
  where u.package_id in (
    select p.id from public.packages p where p.owner_id = public.customer_owner_id()
  );

drop view if exists public.my_stays;
create view public.my_stays as
  select
    b.id, b.owner_id, b.dog_id, b.dog_name, b.last_name,
    b.start_date, b.end_date, b.addons, b.walks_per_day, b.bath_size,
    b.feeding_instructions, b.medication_instructions, b.created_at
  from public.boardings b
  where b.owner_id = public.customer_owner_id();

-- The one the specification calls out by name. Everything a client would
-- want to know about a day their dog spent here, and nothing written by one
-- member of staff for another: no staff_note, no meet_greet_note or result,
-- no walk_staff_initials, no signature.
drop view if exists public.my_visits;
create view public.my_visits as
  select
    s.id, s.owner_id, s.dog_id, s.dog_name,
    s.action, s.service_type, s.addons, s.price,
    s.drop_off_by, s.pick_up_by, s.pickup_window,
    s.meals, s.meals_given, s.walk_out, s.walk_in, s.bath_size,
    s.created_at
  from public.signins s
  where s.owner_id = public.customer_owner_id();

drop view if exists public.my_payments;
create view public.my_payments as
  select p.id, p.owner_id, p.dog_id, p.amount, p.method, p.paid_on, p.created_at
  from public.payments p
  where p.owner_id = public.customer_owner_id();

-- review_note is left out deliberately. It is the reason staff gave for
-- declining, it is written in the knowledge that staff are the readers, and
-- the wording a client gets is the email - which staff edit before sending.
drop view if exists public.my_boarding_requests;
create view public.my_boarding_requests as
  select
    r.id, r.owner_id, r.dog_names, r.start_date, r.end_date,
    r.status, r.created_at, r.reviewed_at
  from public.boarding_requests r
  where r.owner_id = public.customer_owner_id();

do $viewgrants$
declare
  v text;
begin
  foreach v in array array[
    'my_household', 'my_dogs', 'my_vaccinations', 'my_documents',
    'my_packages', 'my_package_uses', 'my_stays', 'my_visits',
    'my_payments', 'my_boarding_requests'
  ] loop
    execute format('revoke all on public.%I from anon, public', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end
$viewgrants$;

-- ---------------------------------------------------------------------
-- 9b. What a customer changes about themselves.
--
-- This started as an update policy on owners and it did not work, in the
-- way that matters most: it did not fail, it silently did nothing. Worth
-- writing down, because the reason is not obvious and the next person will
-- reach for the policy too.
--
-- Postgres applies SELECT policies to the rows an UPDATE reads, and
-- PostgREST turns update().eq(id) into update ... where id = ... - which
-- reads. A client has no select policy on owners, deliberately, because
-- owners.notes is a staff note about the household. So the update matched
-- zero rows, returned success, and changed nothing. The isolation test
-- caught it only because it checks that the value actually moved rather
-- than that the call did not error.
--
-- So the write names its columns for the same reason the reads do. Twelve
-- contact fields, the caller own row, and no way to express anything else.
-- phone is absent on purpose: it is the key the whole backfill was built
-- on, and a household that renumbers is a phone call to the front desk.
-- ---------------------------------------------------------------------

create or replace function public.update_my_household(
  p_owner_name text,
  p_email text,
  p_address text,
  p_city text,
  p_state text,
  p_zip text,
  p_emergency_name text,
  p_emergency_phone text,
  p_emergency_relation text,
  p_vet_name text,
  p_vet_phone text,
  p_vet_address text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  mine uuid;
begin
  mine := public.customer_owner_id();
  if mine is null then
    raise exception 'Only a client account that has claimed a household can change its details.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_email is null or length(trim(p_email)) = 0 then
    raise exception 'An email address is how we reach you about your dog, so it cannot be blank.';
  end if;

  -- owners_customer_guard still fires on this update, and that is the
  -- point rather than an accident: if a column is ever added to the list
  -- below that the guard does not allow, the guard refuses it. The function
  -- and the trigger have to agree, and neither one alone is trusted.
  update public.owners set
    owner_name         = nullif(trim(coalesce(p_owner_name, '')), ''),
    email              = trim(p_email),
    address            = nullif(trim(coalesce(p_address, '')), ''),
    city               = nullif(trim(coalesce(p_city, '')), ''),
    state              = nullif(trim(coalesce(p_state, '')), ''),
    zip                = nullif(trim(coalesce(p_zip, '')), ''),
    emergency_name     = nullif(trim(coalesce(p_emergency_name, '')), ''),
    emergency_phone    = nullif(trim(coalesce(p_emergency_phone, '')), ''),
    emergency_relation = nullif(trim(coalesce(p_emergency_relation, '')), ''),
    vet_name           = nullif(trim(coalesce(p_vet_name, '')), ''),
    vet_phone          = nullif(trim(coalesce(p_vet_phone, '')), ''),
    vet_address        = nullif(trim(coalesce(p_vet_address, '')), '')
  where id = mine;
end
$fn$;

revoke execute on function public.update_my_household(
  text, text, text, text, text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.update_my_household(
  text, text, text, text, text, text, text, text, text, text, text, text
) to authenticated;

-- ---------------------------------------------------------------------
-- 10. What staff see about the account itself.
--
-- The invite state belongs on the owner profile, and staff read the owners
-- table directly, so nothing new is needed for invited_at and claimed_at.
-- The one thing they cannot see is the email address of the account that
-- claimed it, which lives in auth.users - same reason list_staff exists.
-- ---------------------------------------------------------------------

create or replace function public.owner_account(p_owner_id uuid)
returns table (
  invited_at timestamptz,
  claimed_at timestamptz,
  has_invite boolean,
  account_email text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.at_least_employee() then
    raise exception 'Seeing a client account needs a staff account.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      o.invited_at,
      o.claimed_at,
      o.invite_token is not null,
      u.email::text
    from public.owners o
    left join auth.users u on u.id = o.user_id
    where o.id = p_owner_id;
end
$fn$;

revoke execute on function public.owner_account(uuid) from public, anon;
grant execute on function public.owner_account(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Check 1. The backfill, per table. Expect unattached to be zero everywhere
-- except sign-ins with no phone number on them, and wrong_household to be
-- zero everywhere.
-- ---------------------------------------------------------------------
select
  t.table_name,
  t.total,
  t.attached,
  t.total - t.attached as unattached,
  t.wrong_household
from (
  select 'dogs' as table_name,
         (select count(*) from public.dogs) as total,
         (select count(*) from public.dogs where owner_id is not null) as attached,
         (select count(*) from public.dogs c join public.owners o on o.id = c.owner_id
           where public.phone_digits(o.phone) <> public.phone_digits(c.phone)) as wrong_household
  union all
  select 'packages',
         (select count(*) from public.packages),
         (select count(*) from public.packages where owner_id is not null),
         (select count(*) from public.packages c join public.owners o on o.id = c.owner_id
           where public.phone_digits(o.phone) <> public.phone_digits(c.phone))
  union all
  select 'boardings',
         (select count(*) from public.boardings),
         (select count(*) from public.boardings where owner_id is not null),
         (select count(*) from public.boardings c join public.owners o on o.id = c.owner_id
           where public.phone_digits(o.phone) <> public.phone_digits(c.phone))
  union all
  select 'signins',
         (select count(*) from public.signins),
         (select count(*) from public.signins where owner_id is not null),
         (select count(*) from public.signins c join public.owners o on o.id = c.owner_id
           where public.phone_digits(o.phone) <> public.phone_digits(c.phone))
  union all
  select 'payments',
         (select count(*) from public.payments),
         (select count(*) from public.payments where owner_id is not null),
         (select count(*) from public.payments c join public.owners o on o.id = c.owner_id
           where public.phone_digits(o.phone) <> public.phone_digits(c.phone))
  union all
  select 'dog_docs',
         (select count(*) from public.dog_docs),
         (select count(*) from public.dog_docs where owner_id is not null),
         (select count(*) from public.dog_docs d join public.dogs g on g.id = d.dog_id
           where d.owner_id is distinct from g.owner_id)
) t
order by t.table_name;

-- ---------------------------------------------------------------------
-- Check 2. Households, and how many have an account. All zero on a database
-- that has not sent any invitations yet, which is the expected state.
-- ---------------------------------------------------------------------
select
  count(*) as households,
  count(*) filter (where email is not null and length(trim(email)) > 0) as with_an_email_address,
  count(*) filter (where invite_token is not null) as invitation_outstanding,
  count(*) filter (where claimed_at is not null) as claimed
from public.owners;
