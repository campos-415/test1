-- Two-stage enrollment. Paste the whole thing into the Supabase SQL editor
-- and run it once. Every statement is idempotent, so re-running is harmless.
--
-- NOTE: no apostrophe or quote character appears in any comment below.
-- The Supabase SQL editor splits statements on semicolons using a naive
-- scanner that treats a lone apostrophe in a comment as the start of a
-- string literal, which makes it swallow every semicolon after it and
-- report one confusing syntax error for the whole file.
--
-- Stage one asks only what is needed to decide on a meet and greet and to
-- hold it safely: who the household is, the dog basics, vaccinations with
-- the uploaded record, the agreements and the signature. Stage two is a
-- link emailed once the meet and greet has passed, and collects the rest.

-- Which stage the submission has reached: 1 while the details form is still
-- outstanding, 2 once it has been returned.
--
-- The default is 2 on purpose. Every row that exists before this migration
-- was submitted through the old single-stage form, so it already holds every
-- answer — calling those rows stage one would put the whole back catalogue in
-- the details-outstanding queue. New submissions set the column explicitly.
alter table enrollments add column if not exists stage smallint not null default 2;

-- The unguessable half of the public details link, written when the
-- enrollment is approved. Whoever holds it can complete stage two for this
-- household and nothing else, with no sign-in and no expiry.
alter table enrollments add column if not exists details_token uuid;

alter table enrollments add column if not exists details_submitted_at timestamptz;

-- The public route looks a submission up by token alone, so the token has to
-- identify exactly one row.
create unique index if not exists enrollments_details_token_key
  on enrollments (details_token);

-- Staff filtering the queue for approved households that have not returned
-- their details.
create index if not exists enrollments_status_stage_idx
  on enrollments (status, stage);
