-- Retiring a dog. Paste the whole thing into the Supabase SQL editor and run
-- it once. Every statement is idempotent, so re-running is harmless.
--
-- NOTE: no apostrophe or quote character appears in any comment below.
-- The Supabase SQL editor splits statements on semicolons using a naive
-- scanner that treats a lone apostrophe in a comment as the start of a
-- string literal, which makes it swallow every semicolon after it and
-- report one confusing syntax error for the whole file.
--
-- Until now a dog could only exist or be deleted, and deleting cascades its
-- vaccinations and its uploaded records away with it. So a dog that passed
-- away had nowhere to go: it stayed in the kiosk lookup, in the calendar
-- picker and on the day report forever, and if the household later enrolled
-- a new dog under the same name, approving that form overwrote the dead dog
-- record in place -- same row, same id, so the new dog inherited its visits,
-- its balance, its photo and its bite history.
--
-- Retiring keeps the row and everything hanging off it, and takes the dog out
-- of every screen that books, charges or checks a dog in. It is reversible:
-- clearing retired_at puts the dog back exactly as it was.

-- When the dog stopped coming. Null means it is still with us, which is why
-- this is a nullable timestamp rather than a boolean -- the date is worth
-- keeping, and "is null" is the whole filter.
alter table dogs add column if not exists retired_at timestamptz;

-- Why, in the words the front desk chose: passed away, moved away, or no
-- longer coming. Free text rather than an enum so a reason nobody thought of
-- can still be recorded, and so adding one later needs no migration.
alter table dogs add column if not exists retired_reason text;

-- Anything staff typed alongside the reason.
alter table dogs add column if not exists retired_note text;

-- Almost every list in the app now asks for the dogs that are not retired.
-- Partial, because the rows worth indexing are the ones the filter keeps.
create index if not exists dogs_active_idx on dogs (phone) where retired_at is null;

-- The customer portal reads its dogs through this view, not the table, and
-- the view lists its columns one by one -- so without adding it here a
-- customer would still be offered a retired dog in the boarding request
-- picker. Recreated exactly as customer-accounts-migration.sql defines it,
-- plus retired_at.
--
-- The grant is reapplied below because dropping a view drops its grants with
-- it, and a portal that can no longer read its own dogs is a worse outcome
-- than the one being fixed.
drop view if exists public.my_dogs;
create view public.my_dogs as
  select
    d.id, d.owner_id, d.dog_name, d.last_name,
    d.breed, d.sex, d.fixed_status, d.birthdate, d.weight_lb, d.color,
    d.photo_data, d.waiver_on_file,
    d.allergies, d.health_problems, d.health_notes, d.activity_restrictions,
    d.authorized_pickup, d.vet,
    d.meet_greet_on, d.enrolled_at, d.created_at,
    d.retired_at
  from public.dogs d
  where d.owner_id = public.customer_owner_id();

revoke all on public.my_dogs from anon, public;
grant select on public.my_dogs to authenticated;
