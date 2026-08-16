-- Let a walk package pay for boarding walks, not just daycare ones.
--
-- A 10-walk block priced at 250 works out at 25 a walk, which is exactly
-- the boarding walk rate, so restricting the block to daycare was arbitrary
-- from the owner point of view. This records which package a stay draws
-- from; how many walks it covers is derived from what the block has left.
--
-- No apostrophe or quote appears in any comment here, for the Supabase SQL
-- editor reason noted in the other migrations.

alter table boardings add column if not exists walk_package_id uuid;
