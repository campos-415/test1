-- A client adding a second dog from their own account.
--
-- NOTE: no apostrophe or quote character appears in any comment below, for
-- the Supabase SQL editor reason noted in the other migrations.
--
-- It files an ordinary stage-one enrollment into the same pending queue the
-- public form feeds, because that is what it is: a dog nobody here has met,
-- needing a meet and greet like any other. Nothing about the review changes.
--
-- What changes is that the household is already known. The phone and the
-- owner are stamped from the session rather than read off the form, so a
-- client cannot file an application against somebody else - and the OWN cell
-- in the matrix is then checking a value the database chose.
--
-- Run order: after customer-accounts-migration.sql, before re-running
-- rls-lockdown.sql. Safe to run more than once.

do $preflight$
begin
  if to_regprocedure('public.customer_owner_id()') is null then
    raise exception 'customer_owner_id does not exist. Run customer-accounts-migration.sql first.';
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------
-- 1. enrollments joins the tables that carry a household key.
--
-- Nullable, like the others: an enrollment from the public form is usually a
-- household that does not exist yet, and that is not a fault. Null simply
-- means no client account filed it.
-- ---------------------------------------------------------------------

alter table public.enrollments
  add column if not exists owner_id uuid references public.owners(id) on delete set null;

create index if not exists enrollments_owner_id_idx on public.enrollments (owner_id);

-- Backfill what can be matched, so a household that applied before it had an
-- account still sees its own history line up.
do $backfill$
begin
  alter table public.enrollments disable trigger audit_changes;

  update public.enrollments e
  set owner_id = o.id
  from public.owners o
  where e.owner_id is null
    and e.phone is not null
    and public.phone_digits(o.phone) = public.phone_digits(e.phone);

  alter table public.enrollments enable trigger audit_changes;
end
$backfill$;

-- ---------------------------------------------------------------------
-- 2. The stamp.
--
-- Same function the other tables use, extended so an enrollment written by a
-- signed-in client carries their household and their number rather than
-- whatever the form said. The public form is untouched: with no session
-- there is no customer, and it falls through to the phone lookup exactly as
-- before.
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

  -- Documents follow their dog, whoever is writing.
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
    -- The queue matches a household by the phone on the row, and for a
    -- boarding request the approval reads the copy inside data as well. Both
    -- come from the account so neither can claim to be somebody else.
    if tg_table_name in ('boarding_requests', 'enrollments') then
      select o.phone into new.phone from public.owners o where o.id = cust;
      if tg_table_name = 'boarding_requests' then
        new.data := jsonb_set(coalesce(new.data, '{}'::jsonb), '{phone}', to_jsonb(new.phone));
      else
        new.data := jsonb_set(
          coalesce(new.data, '{}'::jsonb), '{owner,phone}', to_jsonb(new.phone), true
        );
      end if;
    end if;
    return new;
  end if;

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

drop trigger if exists fill_owner_id on public.enrollments;
create trigger fill_owner_id
  before insert or update on public.enrollments
  for each row execute function public.fill_owner_id();

-- ---------------------------------------------------------------------
-- Check. Expect no enrollment attached to a household whose number it does
-- not share.
-- ---------------------------------------------------------------------
select
  count(*) as enrollments,
  count(owner_id) as attached_to_a_household,
  count(*) filter (
    where owner_id is not null
      and public.phone_digits(phone)
          <> (select public.phone_digits(o.phone) from public.owners o where o.id = enrollments.owner_id)
  ) as attached_to_the_wrong_one
from public.enrollments;
