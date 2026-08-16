-- Stage two moves behind the client account.
--
-- NOTE: no apostrophe or quote character appears in any comment below, for
-- the Supabase SQL editor reason noted in the other migrations.
--
-- ---------------------------------------------------------------------
-- What changes, and why
-- ---------------------------------------------------------------------
--
-- When a meet and greet passed, the app emailed a link to
-- /enroll/details/<token> - a public page, no sign-in, holding the rest of
-- the questionnaire. That worked, and it had two problems.
--
-- The first is privacy. The token is a bearer credential: anybody the mail
-- is forwarded to can open that household form and read what stage one
-- collected. The route guards it as well as a public route can - the server
-- checks the token with the secret key and hands back a deliberately small
-- slice - but the slice is still the household own answers, and forwarding
-- an email is not a hostile act, so this happens by accident rather than by
-- attack.
--
-- The second is that the client portal existed and nobody was ever pushed
-- into it. An account is most useful at exactly the moment a household is
-- new and has something to do.
--
-- So the pass email now carries the ACCOUNT invitation. They set a password,
-- sign in, and the portal puts the long form in front of them and does not
-- let them past it until it is done. Same form, same questions, behind a
-- login instead of behind a link.
--
-- The old links keep working. Some are already in inboxes, and breaking them
-- turns into a phone call to the front desk. Nothing new issues them.
--
-- Run order: after customer-accounts-migration.sql. Safe to run more than
-- once. Adds one function and no columns.

do $preflight$
begin
  if to_regprocedure('public.customer_owner_id()') is null then
    raise exception 'customer_owner_id does not exist. Run customer-accounts-migration.sql first.';
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------
-- What the signed-in household still owes, if anything.
--
-- On the phone match: this joins enrollments to owners on the normalised
-- number, which everywhere else in this work would be the wrong thing to do.
-- It is right here because it is NOT the isolation boundary. The boundary is
-- o.id = customer_owner_id(), which is a real key and is what decides whose
-- row this is; the phone match only picks which of that household own
-- enrollment rows is the outstanding one. A wrong match inside a household
-- shows somebody their own form twice, which is a nuisance. It cannot show
-- them anybody else.
--
-- Returns the details token, which the portal hands to the existing
-- /api/enrollment-details route. That route already knows how to read and
-- write stage two safely against the secret key, and reusing it means there
-- is one implementation of the whitelist rather than two.
-- ---------------------------------------------------------------------

create or replace function public.my_pending_enrollment()
returns table (
  details_token uuid,
  dog_names text[],
  enrollment_id uuid
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select e.details_token, e.dog_names, e.id
  from public.enrollments e
  join public.owners o
    on public.phone_digits(o.phone) = public.phone_digits(e.phone)
  where o.id = public.customer_owner_id()
    and e.status = 'approved'
    -- Rows written before two-stage enrollment existed hold the whole
    -- questionnaire, so an absent stage means complete, not stage one.
    and coalesce(e.stage, 2) = 1
    and e.details_submitted_at is null
    and e.details_token is not null
  order by e.created_at desc
  limit 1
$fn$;

revoke execute on function public.my_pending_enrollment() from public, anon;
grant execute on function public.my_pending_enrollment() to authenticated;

-- ---------------------------------------------------------------------
-- Check. On a database with no outstanding stage two this returns nothing,
-- which is the expected state.
-- ---------------------------------------------------------------------
select
  count(*) filter (where status = 'approved' and coalesce(stage, 2) = 1 and details_submitted_at is null)
    as households_still_owing_stage_two,
  count(*) filter (where details_submitted_at is not null) as stage_two_completed,
  count(*) as enrollments_total
from public.enrollments;
