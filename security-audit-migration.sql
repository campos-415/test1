-- The audit log.
--
-- Requirement 9 asked for a record of admin sign-ins, permission changes,
-- staff edits to customer accounts and data exports, and for that record to
-- hold no passwords, tokens or payment data. There was none of it.
--
-- Four things make this trustworthy rather than decorative:
--
--   The actor is stamped by the database, never sent by the caller. There
--   is no insert policy on the table at all; the only ways in are the
--   audit_write function and the triggers below, and both read the actor
--   from the session.
--
--   Edits and exports are recorded by triggers on the tables themselves,
--   so a code path that forgets to log still gets logged. Instrumenting
--   call sites would have meant the log was only as complete as the next
--   person to add a feature remembered to make it.
--
--   Column values are never recorded, only which columns changed. The log
--   is a record of who touched what, not a second copy of the customer
--   database in a table with different policies. It also keeps the rows
--   small, which matters because a dog row carries a photo.
--
--   Nothing can be edited or deleted, including by the secret key, because
--   the block is a trigger rather than a policy. Removing old entries is
--   possible only through prune_audit_log, which an owner has to call and
--   which records that it ran.
--
-- Run after security-roles-migration.sql. See the run order at the top of
-- that file. Reverse with security-rollback.sql.
--
-- Safe to run more than once.
--
-- No apostrophe, quote or dollar-quoted block appears in any comment here,
-- for the Supabase SQL editor reason noted in the other migrations.

-- ---------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  -- Null means the action came from the SQL editor or the secret key
  -- rather than from a signed-in person.
  actor_id uuid,
  actor_email text,
  actor_role text,
  -- Dotted and stable, so the log can be filtered: auth.sign_in,
  -- role.granted, dogs.update, export.owners.
  action text not null,
  entity text,
  entity_id text,
  summary text,
  detail jsonb not null default '{}'::jsonb
);

create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, at desc);
create index if not exists audit_log_action_idx on public.audit_log (action, at desc);
create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id);

alter table public.audit_log enable row level security;

-- Reading is granted and then narrowed to managers by policy. Writing is
-- not granted at all: the only writers are audit_write and the triggers,
-- which run as the table owner. So an employee holding a session cannot
-- reach this table with an INSERT even before a policy is consulted, and a
-- future policy added by mistake cannot open it either.
grant select on public.audit_log to authenticated;
revoke insert, update, delete on public.audit_log from authenticated;
revoke all on public.audit_log from anon;

comment on table public.audit_log is
  'Append-only record of sign-ins, permission changes, edits to customer records and data exports. Written only by audit_write and by triggers. No values, only which columns changed.';

-- ---------------------------------------------------------------------
-- 2. Redaction, enforced on the way in.
--
-- The requirement is that the log holds no passwords, tokens or payment
-- data. A rule at each call site would be a promise; a trigger is a
-- guarantee, including for call sites written next year.
-- ---------------------------------------------------------------------

-- Luhn, so an ordinary long number is not mistaken for a card and a card
-- is not missed because it was written with spaces or dashes.
create or replace function public.looks_like_card(t text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  digits text;
  total int := 0;
  d int;
  i int;
  alt boolean := false;
begin
  if t is null then
    return false;
  end if;
  -- Anything other than digits, spaces and dashes means this is prose that
  -- happens to contain numbers, not a card number.
  if length(regexp_replace(t, '[0-9 -]', '', 'g')) > 0 then
    return false;
  end if;
  digits := regexp_replace(t, '[^0-9]', '', 'g');
  if length(digits) < 13 or length(digits) > 19 then
    return false;
  end if;
  for i in reverse length(digits) .. 1 loop
    d := substr(digits, i, 1)::int;
    if alt then
      d := d * 2;
      if d > 9 then
        d := d - 9;
      end if;
    end if;
    total := total + d;
    alt := not alt;
  end loop;
  return total % 10 = 0;
end
$fn$;

create or replace function public.looks_secret(t text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select
    t is not null
    and (
      -- A JWT, which is what a Supabase session token looks like.
      t ~ '^eyJ[A-Za-z0-9_-]{10,}\.'
      -- A Supabase publishable or secret key.
      or t ~ '^sb[a-z]?_[A-Za-z0-9_-]{20,}'
      -- An API key of the shape most services issue.
      or t ~ '^(sk|pk|rk|re)_[A-Za-z0-9]{16,}'
      or public.looks_like_card(t)
    )
$fn$;

-- Redacts what is inside a piece of text rather than judging the whole of
-- it. A card number in the middle of a sentence, or a token in the middle
-- of a note, is exactly the case that a whole-string test misses: the
-- string as a whole looks like prose, and the dangerous part travels inside
-- it. Grouped card numbers are why the digits are matched together with the
-- spaces and dashes between them.
create or replace function public.redact_text(t text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  result text := t;
  candidate text;
begin
  if t is null then
    return null;
  end if;

  for candidate in
    select (regexp_matches(t, '([0-9][0-9 -]{11,22}[0-9])', 'g'))[1]
  loop
    if public.looks_like_card(candidate) then
      result := replace(result, candidate, '[redacted]');
    end if;
  end loop;

  for candidate in
    select (regexp_matches(t, '([A-Za-z0-9_.-]{16,})', 'g'))[1]
  loop
    if public.looks_secret(candidate) then
      result := replace(result, candidate, '[redacted]');
    end if;
  end loop;

  return result;
end
$fn$;

-- Walks a jsonb value and replaces anything named like a secret, and any
-- string that carries one, with a marker.
create or replace function public.audit_scrub(v jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  result jsonb;
  k text;
begin
  if v is null then
    return null;
  end if;

  case jsonb_typeof(v)
    when 'object' then
      result := '{}'::jsonb;
      for k in select jsonb_object_keys(v) loop
        if k ~* '(passw|passcode|pass[_-]?phrase|secret|token|jwt|bearer|api[_-]?key|apikey|credential|private[_-]?key|access[_-]?key|cvv|cvc|(^|_)card(_|$)|card[_-]?(number|no)|(^|_)pan(_|$)|iban|routing|account[_-]?number|(^|_)ssn(_|$)|signature|photo_data|file_data)' then
          result := result || jsonb_build_object(k, '[redacted]');
        else
          result := result || jsonb_build_object(k, public.audit_scrub(v -> k));
        end if;
      end loop;
      return result;
    when 'array' then
      return coalesce(
        (select jsonb_agg(public.audit_scrub(e)) from jsonb_array_elements(v) e),
        '[]'::jsonb
      );
    when 'string' then
      return to_jsonb(public.redact_text(v #>> '{}'));
    else
      return v;
  end case;
end
$fn$;

create or replace function public.audit_redact()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.detail := coalesce(public.audit_scrub(new.detail), '{}'::jsonb);
  -- The summary is a human sentence, so the dangerous part is redacted out
  -- of it and the sentence survives.
  new.summary := public.redact_text(new.summary);
  return new;
end
$fn$;

drop trigger if exists audit_log_redact on public.audit_log;
create trigger audit_log_redact
  before insert on public.audit_log
  for each row execute function public.audit_redact();

-- ---------------------------------------------------------------------
-- 3. Append-only.
--
-- A trigger rather than the absence of a policy, because a policy only
-- binds the API roles: the secret key and the SQL editor bypass RLS and
-- would be able to rewrite history. A trigger binds everyone.
-- ---------------------------------------------------------------------

create or replace function public.audit_immutable()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.audit_prune', true), '') = 'on' then
    return old;
  end if;
  raise exception 'audit_log is append-only, so % is not permitted. Removing old entries is done with prune_audit_log.', tg_op
    using errcode = 'insufficient_privilege';
end
$fn$;

drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function public.audit_immutable();

drop trigger if exists audit_log_no_delete on public.audit_log;
create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute function public.audit_immutable();

-- Retention, through the only door that opens: an owner asks, and the ask
-- is itself recorded.
create or replace function public.prune_audit_log(p_before date)
returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  removed bigint;
begin
  if auth.uid() is not null and not public.is_owner_admin() then
    raise exception 'Only an owner or admin can prune the audit log'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('app.audit_prune', 'on', true);
  delete from public.audit_log where at < p_before::timestamptz;
  get diagnostics removed = row_count;
  perform set_config('app.audit_prune', 'off', true);

  insert into public.audit_log (actor_id, actor_email, actor_role, action, entity, summary, detail)
  values (
    auth.uid(),
    (select u.email from auth.users u where u.id = auth.uid()),
    public.staff_role(),
    'audit.pruned',
    'audit_log',
    format('Removed %s audit entries dated before %s', removed, p_before),
    jsonb_build_object('removed', removed, 'before', p_before)
  );

  return removed;
end
$fn$;

revoke execute on function public.prune_audit_log(date) from public, anon;
grant execute on function public.prune_audit_log(date) to authenticated;

-- ---------------------------------------------------------------------
-- 4. The writer the application calls.
--
-- Everything except actor identity comes from the caller; identity never
-- does. An employee can write an entry about themselves and cannot write
-- one about anybody else.
-- ---------------------------------------------------------------------

create or replace function public.audit_write(
  p_action text,
  p_entity text default null,
  p_entity_id text default null,
  p_summary text default null,
  p_detail jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  new_id uuid;
begin
  if p_action is null or length(trim(p_action)) = 0 then
    raise exception 'audit_write needs an action';
  end if;
  if auth.uid() is null then
    raise exception 'audit_write needs a signed-in session'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_log (
    actor_id, actor_email, actor_role, action, entity, entity_id, summary, detail
  )
  values (
    auth.uid(),
    (select u.email from auth.users u where u.id = auth.uid()),
    public.staff_role(),
    left(p_action, 80),
    left(p_entity, 80),
    left(p_entity_id, 120),
    left(p_summary, 500),
    coalesce(p_detail, '{}'::jsonb)
  )
  returning id into new_id;

  return new_id;
end
$fn$;

revoke execute on function public.audit_write(text, text, text, text, jsonb) from public, anon;
grant execute on function public.audit_write(text, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Edits to customer records, recorded by the tables themselves.
-- ---------------------------------------------------------------------

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  new_j jsonb;
  old_j jsonb;
  row_j jsonb;
  changed text[];
  label text;
begin
  new_j := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  old_j := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  row_j := coalesce(new_j, old_j);

  if tg_op = 'UPDATE' then
    select array_agg(e.key order by e.key) into changed
    from jsonb_each_text(new_j) e
    where e.value is distinct from (old_j ->> e.key);
    -- A save that changed nothing is not an edit worth a line in the log.
    if changed is null then
      return new;
    end if;
  end if;

  label := coalesce(
    row_j ->> 'dog_name',
    row_j ->> 'owner_name',
    row_j ->> 'client_name',
    row_j ->> 'phone',
    ''
  );

  insert into public.audit_log (
    actor_id, actor_email, actor_role, action, entity, entity_id, summary, detail
  )
  values (
    auth.uid(),
    (select u.email from auth.users u where u.id = auth.uid()),
    public.staff_role(),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    row_j ->> 'id',
    trim(both ' ' from format('%s %s %s', lower(tg_op), tg_table_name, label)),
    jsonb_build_object(
      -- Column names only. The values stay in the table they belong to.
      'changed', case when changed is null then null else to_jsonb(changed) end,
      'household', row_j ->> 'phone'
    )
  );

  return coalesce(new, old);
end
$fn$;

do $attach$
declare
  -- Customer records: every write is somebody editing a client file.
  full_tables text[] := array[
    'dogs', 'owners', 'vaccinations', 'dog_docs', 'packages', 'payments', 'boardings'
  ];
  -- Public form submissions arrive by the hundred and are not staff edits.
  -- What staff then do to them - approve, decline, delete - is.
  edit_only_tables text[] := array['enrollments', 'boarding_requests', 'settings'];
  t text;
begin
  foreach t in array full_tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop trigger if exists audit_changes on public.%I', t);
    execute format(
      'create trigger audit_changes after insert or update or delete on public.%I for each row execute function public.audit_row_change()',
      t
    );
  end loop;

  foreach t in array edit_only_tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop trigger if exists audit_changes on public.%I', t);
    execute format(
      'create trigger audit_changes after update or delete on public.%I for each row execute function public.audit_row_change()',
      t
    );
  end loop;
end
$attach$;

-- Deliberately not logged: signins, walk_logs, meal_logs and package_uses.
-- They are the operational record of a day rather than edits to a customer
-- file, they change many times per dog per day, and they would bury the
-- entries that matter. The rows themselves already carry who and when.

-- ---------------------------------------------------------------------
-- 6. Permission changes.
--
-- The most important entries in the log get their own trigger, so they
-- read as sentences rather than as a list of changed column names.
-- ---------------------------------------------------------------------

create or replace function public.audit_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  target_id uuid := coalesce(new.user_id, old.user_id);
  target_email text;
  act text;
  line text;
begin
  select u.email into target_email from auth.users u where u.id = target_id;
  target_email := coalesce(target_email, target_id::text);

  if tg_op = 'INSERT' then
    act := 'role.granted';
    line := format('Granted %s to %s', new.role, target_email);
  elsif tg_op = 'DELETE' then
    act := 'role.revoked';
    line := format('Revoked %s from %s, leaving the account with no access', old.role, target_email);
  elsif new.role <> old.role then
    act := 'role.changed';
    line := format('Changed %s from %s to %s', target_email, old.role, new.role);
  elsif new.require_mfa <> old.require_mfa then
    act := case when new.require_mfa then 'role.mfa_required' else 'role.mfa_relaxed' end;
    line := format(
      'MFA requirement for %s turned %s',
      target_email,
      case when new.require_mfa then 'on' else 'off' end
    );
  else
    return coalesce(new, old);
  end if;

  insert into public.audit_log (
    actor_id, actor_email, actor_role, action, entity, entity_id, summary, detail
  )
  values (
    auth.uid(),
    (select u.email from auth.users u where u.id = auth.uid()),
    public.staff_role(),
    act,
    'staff_roles',
    target_id::text,
    line,
    jsonb_build_object(
      'target', target_email,
      'role_before', case when tg_op = 'INSERT' then null else old.role end,
      'role_after', case when tg_op = 'DELETE' then null else new.role end,
      'require_mfa', case when tg_op = 'DELETE' then null else new.require_mfa end
    )
  );

  return coalesce(new, old);
end
$fn$;

drop trigger if exists audit_role_changes on public.staff_roles;
create trigger audit_role_changes
  after insert or update or delete on public.staff_roles
  for each row execute function public.audit_role_change();

-- ---------------------------------------------------------------------
-- Checks.
-- ---------------------------------------------------------------------

-- Redaction, proved rather than assumed. Expect every value to come back
-- as [redacted] except the last two, which are ordinary data.
select
  public.audit_scrub('{"password":"hunter2"}'::jsonb) as a_password,
  public.audit_scrub('{"access_token":"abc"}'::jsonb) as a_token,
  public.audit_scrub('{"note":"eyJhbGciOiJIUzI1NiJ9.payload"}'::jsonb) as a_jwt,
  public.audit_scrub('{"note":"4111 1111 1111 1111"}'::jsonb) as a_card,
  public.audit_scrub('{"signature_data":"iVBORw0KGgo"}'::jsonb) as a_signature,
  public.audit_scrub('{"changed":["notes","feeding"]}'::jsonb) as kept_columns,
  public.audit_scrub('{"amount":42.5,"household":"6305551234"}'::jsonb) as kept_business;

-- The same for a sentence: the card goes, the sentence stays.
select
  public.redact_text('Took 42.50 on card 4111 1111 1111 1111 at pick-up') as summary_card,
  public.redact_text('Signed in as manager') as summary_kept;

-- Where the triggers ended up.
select
  c.relname as table_name,
  t.tgname as trigger_name
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not t.tgisinternal
  and t.tgname in ('audit_changes', 'audit_role_changes', 'audit_log_redact', 'audit_log_no_update', 'audit_log_no_delete')
order by c.relname, t.tgname;
