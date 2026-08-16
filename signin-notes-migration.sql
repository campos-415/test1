-- Two columns on signins, both about a single visit.
-- Paste into the Supabase SQL editor and run once. Safe to run again.
--
-- staff_note
--   A note for a dog while it is here. Special requests, things the owner
--   said at drop-off, anything the next person on shift needs to know.
--   Deliberately per visit rather than on the dog: what matters today is
--   almost never true forever, and a note that outlives its day becomes
--   noise nobody trusts. It is written on the drop-off row, which is the
--   row that represents the visit while the dog is still here.
--
--   Not printed. It is an internal handover note, not a client document,
--   and the day sheets go out to owners.
--
-- package_opt_out
--   Whether staff have said this daycare visit must not spend a package
--   day, when the automatic rule would have spent one.
--
--   Past four hours a package day gets spent at pick-up whether or not
--   anyone touches the picker, so the list shows that block already
--   selected. Nothing was stored for it though, which made the No day used
--   option a lie: choosing it compared the stored value (nothing) against
--   the new value (nothing), decided nothing had changed, and the projected
--   block reappeared. Walk packages were never projected, which is why they
--   always worked and this did not.
--
--   A null here means nobody has decided, which is not the same as false.
--
-- No apostrophe, quote or dollar-quoted block appears in any comment here,
-- for the Supabase SQL editor reason noted in the other migrations.

alter table signins add column if not exists staff_note text;

alter table signins add column if not exists package_opt_out boolean;

-- ---------------------------------------------------------------------
-- Check. Expect both columns, and package_opt_out nullable.
-- ---------------------------------------------------------------------
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'signins'
  and column_name in ('staff_note', 'package_opt_out')
order by column_name;
