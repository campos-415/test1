-- Meals for a dog in house.
-- Paste into the Supabase SQL editor and run once. Safe to run again.
--
-- All four hang off the drop-off row, because all four are about one visit
-- rather than about the dog. A dog that skips lunch today still eats lunch
-- tomorrow, and a note asking staff to hold a dog back from the big group is
-- about this afternoon, not forever. Anything permanent belongs on the dog
-- profile, which already exists.
--
--   meals            which meals this dog is due today
--   meals_given      which of them have actually been given
--
-- Both are text arrays to match the addons column, which already holds the
-- same kind of short fixed keys.
--
-- Two columns rather than one, because needing a meal and having been given
-- it are different facts and staff need both: the kitchen list is the first,
-- what is left to do this afternoon is the difference between them.
--
-- No apostrophe, quote or dollar-quoted block appears in any comment here,
-- for the Supabase SQL editor reason noted in the other migrations.

alter table signins add column if not exists meals text[] default '{}';
alter table signins add column if not exists meals_given text[] default '{}';
-- ---------------------------------------------------------------------
-- Check. Expect two rows.
-- ---------------------------------------------------------------------
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'signins'
  and column_name in ('meals', 'meals_given')
order by column_name;
