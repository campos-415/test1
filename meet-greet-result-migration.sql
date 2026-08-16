-- Records how a meet and greet went.
--
-- The outcome lives on the sign-in row, not on the dog, because it is the
-- result of one assessment on one day. A dog that is brought back for a
-- second meet and greet gets a second row and a second verdict, and the
-- history of both survives. Screens that want the dogs current standing read
-- the most recent one.
--
-- Safe to run more than once. No apostrophe, quote or dollar-quoted block
-- appears in any comment here, because the Supabase SQL editor splits pasted
-- text naively and treats one as the start of a string.

alter table signins add column if not exists meet_greet_result text;

alter table signins drop constraint if exists signins_meet_greet_result_check;
alter table signins add constraint signins_meet_greet_result_check
  check (meet_greet_result is null or meet_greet_result in ('pass', 'fail'));

-- Staff can add a short note alongside the verdict.
alter table signins add column if not exists meet_greet_note text;

create index if not exists signins_meet_greet_result_idx
  on signins (meet_greet_result)
  where meet_greet_result is not null;

-- Check it landed:
-- select meet_greet_result, count(*) from signins group by meet_greet_result;
