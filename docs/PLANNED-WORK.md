# Planned work

Two pieces specified while the context was fresh, so neither has to be
re-derived. See also `PDF-PLAN.md`.

---

# 1. Two-stage enrollment

Today the enrollment form asks everything up front — roughly 25 questions per
dog plus the household, before the business has agreed to take the dog at all.
That is a lot to ask of somebody who has not met you yet, and most of it is
not needed until the dog actually turns up.

**Stage one** asks only what is needed to decide whether to book a meet and
greet, and to hold the booking safely. **Stage two** is emailed as a link once
the meet and greet has passed, and collects the rest.

## What goes in stage one

Everything here is either legally required, safety-critical, or needed to
identify the household:

- Owner first and last name, phone, email
- Dog name (repeatable — one household, several dogs)
- Breed, rough age or birthdate, sex, spayed/neutered
- **Vaccination dates and the uploaded record** — a dog cannot be on site
  without these, so they cannot wait for stage two
- Contract agreement, meet and greet policy agreement, signature
- Requested meet and greet date and window

## What moves to stage two

- Address, city, state, zip
- Emergency contact and relationship
- Authorized pick-up
- Veterinarian name, phone, address
- Behaviour questions (bitten, growled, dog fights, fence climbing)
- Health problems, allergies, medications, touch sensitivity
- Feeding instructions, activity restrictions
- Traits, play style, big-dog response, crate/kennel training
- Attendance plan, package interest, how they heard about us

## The link

- A `details_token` (random uuid) written when the enrollment is approved.
- Public route `/enroll/details/[token]`, no sign-in.
- The token identifies the household; the form prefills what stage one
  already collected and never asks for it twice — the same rule that already
  applies to the boarding form.
- Submitting merges into the existing dog records rather than creating new
  ones. The token is marked used; reopening the link shows what was submitted
  rather than a blank form.
- No expiry. An owner who fills it in three weeks later is normal, and an
  expired link is a phone call to the front desk.

## When it is sent

`writeMeetGreetResult(row, "pass")` in `app/in-house/page.tsx` is already the
single place a pass is recorded, and already requires a photo. Sending the
email belongs there — one trigger, one place to look when it does not arrive.

New settings templates alongside the existing approve/decline ones:
`detailsRequestSubject` and `detailsRequestBody`, with a `{{link}}` variable.

## Things that must change with it

- **`lib/enrollmentReview.ts`** — the review checklist currently treats a
  missing vet or emergency contact as a warning. At stage one those are not
  missing, they are *not yet asked*, and must not be reported as gaps. Give
  the checks a stage.
- **The requests queue** — needs a visible "details outstanding" state, so
  staff can see which approved households have not completed stage two.
- **`app/dogs/[id]`** — should show which fields are still awaiting stage two
  rather than rendering them blank.
- **Migration** — `enrollments.stage` (1 or 2), `enrollments.details_token`,
  `enrollments.details_submitted_at`.

## Care

The enrollment form is the most important public flow in the app. Stage one
must keep working end to end at every point during the change: kiosk signup,
the website form, and the embedded copy inside the boarding request form,
which submits both together.

---

# 2. Replacing the client data with fixtures

**This deletes real rows. Confirm the scope with the owner before running
anything.** The database currently holds 529 dogs, 497 owners, 2,640
vaccination records, 45 sign-ins, 17 boardings and 10 packages. Some of that
is genuine.

Safer shape, and what should be proposed first: build the fixture set
alongside, tagged, so the two can be told apart and the fixtures removed in
one statement. Deleting the originals is then a separate, explicit decision
rather than a side effect.

## What the fixture set needs

- ~500 households: real-looking names, valid-format phone numbers that cannot
  dial anybody (use 555 exchanges), plausible addresses in the business's own
  city.
- ~600 dogs, since some households have two or three. Real breed names,
  weights that match the breed, birthdates giving a believable age spread.
- **A photo on every dog.** This is the point of the exercise — the app looks
  like a toy when every dog is an emoji. They must go through
  `fileToBudgetedJpeg` at 640px/120 KB like a real upload, or the database
  will be enormous and the fixtures will not represent real usage.
- A vaccination record image per dog, generated as a certificate rather than
  a stock photo, so the review screens show something readable.
- Sign-in history across several months with a realistic weekday shape, some
  dogs regular, some occasional.
- Boardings that overlap, so the calendar shows the lane packing working.
- Packages at varying levels of use, some fully spent, some with a couple of
  days left, some walk packages.
- Payments that leave a realistic mix: mostly settled, a few outstanding, one
  or two in credit — so the unpaid colouring has something to show.

## Constraints

- Every fixture row carries a marker so the whole set can be removed in one
  statement. A distinct phone prefix is the simplest.
- Photos must be licensed for this use. Generated or public-domain sources
  only, and the source recorded.
- Insert in batches; 600 dogs each carrying a 120 KB photo is ~72 MB and
  will not go in one request.
- Run against a branch or a copy first if one is available.

---

# 3. Customer accounts — request-only portal

Customers sign in, see their own dogs, packages, stays and invoices, keep
their own details up to date, and submit boarding requests. They do **not**
book directly: requests go to the staff queue that already exists.

Depends on the staff roles work landing first — it is the same RLS rewrite
touching the same policies.

## The blocker to solve first

There is no identity for a household. `owners` has no `user_id`, and every
child table — dogs, packages, boardings, signins, payments — is grouped by a
**phone number string**. Nothing can be attached to an account because there
are no accounts.

Worse, RLS built on that string inherits every inconsistency in it. Code in
this app already strips non-digits before comparing phone numbers, which means
the stored formats vary. A policy of the form

    phone in (select phone from owners where user_id = auth.uid())

fails closed when a format differs — a customer silently cannot see their own
dog — and that is the better failure. The worse one is two households sharing
a normalised number.

**Do not build the portal on the phone string.** Add `owner_id` to dogs,
packages, boardings, signins, payments and dog_docs, backfill it from the
current phone grouping, and write the policies against that. It is a bigger
migration and it is the difference between an isolation guarantee and a
hopeful one.

## Claiming an account

497 owners already exist with no login. A customer must not be able to claim a
household by typing a phone number — guessing one is trivial, and that is
exactly the isolation failure the requirements are about.

Staff send an invite: a one-time token emailed to the address on file, which
proves control of that address. `owners.invite_token`, `owners.invited_at`,
`owners.claimed_at`. Signing up through the link binds `auth.uid()` to that
owner row.

## What a customer may do

Read, scoped to their own household: dogs and their vaccination records,
package balances and usage history, past and upcoming stays, invoices and what
is outstanding.

Write: update their own owner details (address, emergency contact, vet),
upload a replacement vaccination record, submit a boarding request.

Never: another household's anything, staff notes on a visit, pricing
configuration, reports, exports, or the staff pages.

Note the staff-only fields explicitly — a visit row carries internal notes,
and a customer-facing query must not select them.

## Screens

A route group of its own, so the staff chrome cannot leak in.

- Sign in / claim invite
- Overview: dogs, package days remaining, next stay
- Request boarding — reuse `BoardingRequestForm`, prefilled from the account,
  never asking for what is already on file
- History: visits and invoices, with the unpaid colouring already built
- Documents: vaccination records, and uploading a new one

## Not in scope

Direct booking without staff approval, online payment, and MFA for customers
(the requirements ask for MFA on staff accounts only).

---

# 4. Client requests, 12 August

## 4a. Customer portal behind a settings switch

The portal must be something management turns on, not something that exists
the day the app is installed. A daycare that has not opened has no customers,
and a sign-in page for accounts nobody holds is a support call waiting to
happen.

`settings.portal.enabled`, defaulting to **off**. When off: no `/account`
route, no invite button on the owner profile, and no portal link anywhere in
the staff app. Follow the pattern already used for the marketing website
(`site.enabled`) — including the part that took a bug to learn, that the
switch has to actually stop the route rendering rather than only hide a link.

## 4b. Owners upload the vaccination record; staff type the dates

Owners currently type five expiry dates. They mistype them, and staff verify
against the uploaded document anyway — so the typing is work that produces
something nobody trusts.

Change: the enrollment form asks only for the **document**. Dates become a
staff task on the dog profile, where the record is on screen beside the
fields.

Consequences to handle rather than discover:

- `lib/enrollmentReview.ts` currently blocks approval on missing vaccination
  dates. At submission there will never be dates, so that check has to move
  to "no record uploaded" instead — otherwise every enrollment arrives with a
  red blocker.
- The dog profile needs the dates to be obviously outstanding, or a dog gets
  approved with a record nobody read.
- Expiry reminders key off those dates. Until staff enter them the dog has no
  expiry, which must not read as "expired".

## 4c. Mobile

Reported on an iPhone, and visible in the screenshot: the staff navigation
takes four rows before any content appears — an account row (sign out, theme,
kiosk) and three rows of wrapped page pills. On a phone that is most of the
first screen.

`components/StaffNav.tsx` is 169 lines with four responsive classes in it. It
was built for a desk and wraps on a phone rather than adapting.

What it wants: a compact bar on small screens — current page plus a menu —
expanding to the present layout at `sm:` and up. The account controls belong
inside that menu on mobile, not on their own row.

Also seen: the sign-in table scrolls sideways on a phone, so the IN column is
cut mid-word. The scroll is deliberate and the alternative is worse, but it
needs to look scrollable — a fade at the edge, or the columns that matter
most moved left.
