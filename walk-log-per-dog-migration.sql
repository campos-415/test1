-- Make every walk log row say which dog it is for.
--
-- Until now a row identified its walk only by the reservation it belonged to
-- (boarding_id), so the table could not answer the one question staff ask of
-- it: whose walk was this. Reading walk_logs in the Supabase table editor
-- showed a stay reference and three times, with no dog anywhere, and every
-- lookup needed a join through boardings.
--
-- dog_id is the real identity; dog_name is carried alongside it so a row is
-- readable on its own, the same way package_uses already does.
--
-- Safe to run more than once. No apostrophe, quote or dollar-quoted block
-- appears in any comment here, because the Supabase SQL editor splits pasted
-- text naively and treats one as the start of a string.

alter table walk_logs add column if not exists dog_id uuid references dogs(id) on delete cascade;
alter table walk_logs add column if not exists dog_name text;

-- Backfill from the reservation each existing row hangs off.
update walk_logs w
set dog_id = b.dog_id,
    dog_name = b.dog_name
from boardings b
where b.id = w.boarding_id
  and (w.dog_id is null or w.dog_name is null);

-- The two lookups the app actually makes: one dog across time, and one dog
-- on one day.
create index if not exists walk_logs_dog_id_idx on walk_logs (dog_id);
create index if not exists walk_logs_dog_date_idx on walk_logs (dog_id, date);

-- Check it landed: every row should now name a dog.
-- select count(*) as rows, count(dog_id) as with_dog from walk_logs;
