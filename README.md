# Dog daycare sign-in kiosk

Lobby sign-in/out form for a dog daycare front desk. Next.js 14 + TypeScript + Supabase, meant to run on an iPad/tablet in the lobby.

## 1. Supabase setup

Create a free project at supabase.com, then run this in the SQL editor:

```sql
create table signins (
  id uuid primary key default gen_random_uuid(),
  dog_name text,
  phone text,
  drop_off_by text,
  pick_up_by text,
  last_name text,
  action text,
  service_type text,
  addons text[] default '{}',
  package_id uuid,
  signature_data text,
  price numeric,
  bath_size text,
  created_at timestamptz default now()
);
alter table signins enable row level security;
create policy "allow all" on signins for all using (true) with check (true);

create table packages (
  id uuid primary key default gen_random_uuid(),
  client_name text,
  dog_name text,
  phone text,
  total_days integer not null,
  days_used integer not null default 0,
  created_at timestamptz default now()
);
alter table packages enable row level security;
create policy "allow all" on packages for all using (true) with check (true);
```

If you already have a `packages` table from an earlier version, just add the new column:

```sql
alter table packages add column if not exists dog_name text;
```

If you already created the `signins` table from an earlier version, just run this to add the new columns instead of recreating it:

```sql
alter table signins add column if not exists addons text[] default '{}';
alter table signins add column if not exists package_id uuid;
alter table signins add column if not exists dog_id uuid;
alter table signins add column if not exists pick_up_by text;
alter table signins add column if not exists price numeric;
alter table signins add column if not exists bath_size text;
alter table signins add column if not exists walk_out text;
alter table signins add column if not exists walk_in text;
alter table signins add column if not exists walk_staff_initials text;
```

Then add the `dogs` table — this is the one-time signup/waiver profile, looked up by phone at check-in:

```sql
create table dogs (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  dog_name text not null,
  last_name text not null,
  drop_off_by text,
  signature_data text,
  created_at timestamptz default now()
);
alter table dogs enable row level security;
create policy "allow all" on clients for all using (true) with check (true);
```

If you already have a `dogs` table from an earlier version, add the photo column instead of recreating it:

```sql
alter table dogs add column if not exists photo_data text;
```

Then add the `boardings` table (staff-created advance boarding reservations) and `meal_logs` (the per-day meal chart on `/report`):

```sql
create table boardings (
  id uuid primary key default gen_random_uuid(),
  dog_name text not null,
  last_name text not null,
  phone text not null,
  dog_id uuid,
  start_date date not null,
  end_date date not null,
  feeding_instructions text,
  notes text,
  created_at timestamptz default now()
);
alter table boardings enable row level security;
create policy "allow all" on boardings for all using (true) with check (true);

create table meal_logs (
  id uuid primary key default gen_random_uuid(),
  boarding_id uuid references boardings(id) on delete cascade,
  date date not null,
  meal_type text not null,
  fed boolean not null default false,
  notes text,
  created_at timestamptz default now(),
  unique (boarding_id, date, meal_type)
);
alter table meal_logs enable row level security;
create policy "allow all" on meal_logs for all using (true) with check (true);
```

If you already have a `boardings` table from an earlier version, add the add-on columns (walk/bath/nail trim/medication) and the reservation photo column instead of recreating it:

```sql
alter table boardings add column if not exists addons text[] default '{}';
alter table boardings add column if not exists walks_per_day integer;
alter table boardings add column if not exists bath_size text;
alter table boardings add column if not exists medication_instructions text;
alter table boardings add column if not exists photo_data text;
```

Finally, the tables behind the staff profile pages, vaccine records, boarding walk log, and package usage history:

```sql
-- Owner-level details. `dogs` is one row per DOG, so this is where the
-- person behind a phone number lives. Created lazily on first save.
create table owners (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  owner_name text,
  email text,
  address text,
  emergency_name text,
  emergency_phone text,
  emergency_relation text,
  notes text,
  created_at timestamptz default now()
);
alter table owners enable row level security;
create policy "allow all" on owners for all using (true) with check (true);

-- One row per (dog, vaccine). Fixed vaccine list — staff only fill in dates.
create table vaccinations (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid references clients(id) on delete cascade,
  vaccine text not null,
  given_on date,
  expires_on date,
  created_at timestamptz default now(),
  unique (dog_id, vaccine)
);
alter table vaccinations enable row level security;
create policy "allow all" on vaccinations for all using (true) with check (true);

-- Per-day, per-slot walks for a boarding stay. A daycare walk is stored on
-- the signins row itself; a stay spans many days with several walks a day,
-- so it needs its own table.
create table walk_logs (
  id uuid primary key default gen_random_uuid(),
  boarding_id uuid references boardings(id) on delete cascade,
  date date not null,
  walk_index integer not null default 0,
  walk_out text,
  walk_in text,
  staff_initials text,
  created_at timestamptz default now(),
  unique (boarding_id, date, walk_index)
);
alter table walk_logs enable row level security;
create policy "allow all" on walk_logs for all using (true) with check (true);

-- Ledger of package days consumed, so usage has dates instead of just the
-- days_used counter on `packages`.
create table package_uses (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  dog_id uuid,
  signin_id uuid,
  dog_name text,
  used_on date not null default current_date,
  created_at timestamptz default now()
);
alter table package_uses enable row level security;
create policy "allow all" on package_uses for all using (true) with check (true);

-- Money taken from a client. Recorded against the phone number, since that's
-- the household that pays — one payment settles charges across their dogs.
create table payments (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  dog_id uuid,
  amount numeric not null,
  method text,
  note text,
  paid_on date not null default current_date,
  created_at timestamptz default now()
);
alter table payments enable row level security;
create policy "allow all" on payments for all using (true) with check (true);
create index if not exists payments_phone_idx on payments (phone);

-- Pick-up window chosen at the kiosk when a bath is booked.
alter table signins add column if not exists pickup_window text;

-- Set by staff when a waiver was signed outside the kiosk (paper, another
-- location), so a dog added from an owner profile isn't flagged forever.
alter table dogs add column if not exists waiver_on_file boolean default false;

-- `/report` records who fed each meal; earlier versions of this README
-- never created the column.
alter table meal_logs add column if not exists fed_by text;

-- What a client paid for a package. This is the revenue event: it counts on
-- the day the package was sold, and the visits it later covers are $0.
alter table packages add column if not exists price numeric;

-- What a package buys. Existing rows are all daycare packages.
alter table packages add column if not exists kind text not null default 'daycare';

-- The dog itself. All optional — kiosk signup only asks for the basics, and
-- these mostly arrive by importing an existing system's export.
alter table dogs add column if not exists breed text;
alter table dogs add column if not exists sex text;            -- male | female
alter table dogs add column if not exists fixed_status text;   -- spayed | neutered | intact | unknown
alter table dogs add column if not exists birthdate date;
alter table dogs add column if not exists weight_lb numeric;
alter table dogs add column if not exists vet text;
alter table dogs add column if not exists authorized_pickup text;
alter table dogs add column if not exists notes text;
alter table dogs add column if not exists waiver_on_file boolean default false;

-- Address split out, since imports carry the parts separately.
alter table owners add column if not exists city text;
alter table owners add column if not exists state text;
alter table owners add column if not exists zip text;

-- App settings — prices, the add-on/service catalogs, and branding. One row,
-- enforced by the check constraint, holding a single JSON blob.
create table settings (
  id integer primary key default 1,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  constraint settings_singleton check (id = 1)
);
alter table settings enable row level security;
create policy "allow all" on settings for all using (true) with check (true);

-- Marks a visit that staff recorded on a client's behalf from the front
-- desk, rather than the client using the lobby kiosk themselves.
alter table signins add column if not exists by_staff boolean default false;

-- Set when staff confirm a waiver was signed somewhere other than the
-- kiosk signup flow (paper, another location), so a dog added from an
-- owner profile can still be marked as covered.
alter table dogs add column if not exists waiver_on_file boolean default false;
```

Finally, run the enrollment migration — it adds the review queue, the uploads table, and every column the enrollment form collects:

```bash
cat enrollment-migration.sql
```

Paste [enrollment-migration.sql](enrollment-migration.sql), then [boarding-requests-migration.sql](boarding-requests-migration.sql), then [two-stage-enrollment-migration.sql](two-stage-enrollment-migration.sql) into the SQL editor and run them. Every statement is idempotent, so re-running is harmless. The last one adds the stage and the details token behind [two-stage enrollment](#two-stage-enrollment); without it the enrollment form and the review queue still work, and only the second stage is unavailable.

> Copy the file **contents**, not the `cat` command — and note the comments in these files deliberately contain no apostrophes. The Supabase SQL editor splits statements on semicolons with a scanner that does not skip comments, so a lone `'` in a comment makes it swallow every following `;` and report one baffling syntax error.

Grab your **Project URL** and **anon public key** from Settings → API.

`allow all` means anyone with the anon key can read/write this table — fine for a lobby kiosk with low-stakes data, but worth knowing. If you want it locked down properly later, that's a good use for Supabase Auth or a server-side API route instead of writing straight from the browser.

## 2. Local setup

```bash
npm install
cp .env.local.example .env.local
```

Fill in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Supabase.
- `NEXT_PUBLIC_STAFF_UNLOCK_MINUTES` — optional, default 30. How long a staff screen stays unlocked with nothing open before it asks for the password again. Not the security boundary — see [Accounts and security](#accounts-and-security).
- `RESEND_API_KEY` — optional. Only needed to email clients; see [Emailing clients](#emailing-clients). Leave it blank and nothing else changes.
- `SUPABASE_SECRET_KEY` — the service key from Supabase → Settings → API. Server-side only, never `NEXT_PUBLIC_`. Needed by the [stage-two details form](#two-stage-enrollment), which has to read one household's submission back on a page with no sign-in. Leave it unset and that link explains itself; nothing else changes.

```bash
npm run dev
```

Open http://localhost:3000 for the kiosk form, http://localhost:3000/signup for the in-lobby enrollment form, http://localhost:3000/enroll for the public enrollment version you'd link from a website, and http://localhost:3000/book for the boarding request form. The staff pages all share one passcode: `/records` for saved sign-ins and the walk log, `/packages` for daycare packages, `/requests` for reviewing new-client and boarding requests, `/boardings` for reservations and the calendar, `/report` for a printable boarding stay report, and `/daily` for the end-of-day totals. Dog profiles (`/dogs/[id]`) and owner profiles (`/owners/[phone]`) aren't in the nav — click a dog's name on any staff page to open one.

## How pre-registration works

1. First-time visitors fill in the **enrollment form** — at the kiosk on `/signup`, or from home on the public `/enroll` link. It is asked in [two stages](#two-stage-enrollment): stage one is what is needed to book a meet & greet safely (owner name, phone and email; each dog's breed, colour, birthday, weight, sex and spay/neuter; vaccination dates with a photo or PDF of the records; the contract and meet & greet policy; one signature; a requested date). The rest — address, vet, emergency contact, and the behaviour and health questions — is collected after the meet & greet passes. **Multiple dogs** go on one submission at either stage: "+ Add another dog" repeats the whole dog section, and each keeps its own answers.
2. From then on, the kiosk home screen only asks for a phone number. Typing one in looks up every dog on file for that number and shows them for confirmation — no re-typing name/last name and no re-signing, since the waiver's already on file.
3. **Multiple dogs, same phone number:** if a phone number matches more than one dog, the kiosk shows a picker where you tap every dog checking in together — both can be signed in (or out) in the same action, one tap on "Sign in" creates a separate record for each selected dog. Nothing auto-selects when there's more than one, so adding a second dog never hides the first.
4. **Already-signed-in indicator:** the kiosk checks today's records for each matched dog — a dog currently dropped off (no pick-up logged yet) shows a "🟢 Signed in" badge in the picker and on their card. If Drop off is selected for a dog that's already signed in, a warning nudges toward Pick up instead — it doesn't hard-block (staff can still correct a mistake), but it catches the common accidental double-drop-off before it happens.
4. Staff/owner still pick drop-off vs. pick-up, service type, and add-ons once per visit — shared across whichever dogs are selected, since those usually match for dogs going in together.
5. If a phone number doesn't match an **approved** client, the kiosk shows a prompt pointing to the enrollment form instead of letting the visit be logged — this keeps every dog on file with a signed waiver. A submitted-but-unapproved household is deliberately invisible to the kiosk.
6. Each saved sign-in links back to the specific dog's client record via `dog_id`, so records can always be traced to the signup that authorized them.

## Enrollment requests and approval

The enrollment form is reachable from three places, all rendering the same component:

| Route | Who it's for |
| --- | --- |
| `/signup` | The lobby kiosk — carries the business logo |
| `/enroll` | The public link to put on the business's website |
| `/enroll?embed=1` | The same form with no heading or navigation, for an `<iframe>` |

Both public form URLs, with ready-made embed snippets and copy buttons, are under **Settings → Online forms**.

**Submitting does not create a client.** Anyone with the link can reach the public form, so a submission is a *request*: the whole thing is written to the `enrollments` table as a pending row and nothing else in the app can see it — the kiosk still won't find that phone number.

Staff review pending requests on **`/requests`** (nav item **Requests**, with a red badge showing how many are waiting across both queues). The review panel lays out every answer, pulls anything safety-relevant into a **"Needs attention"** block at the top (bites, growls, fights, fence climbing, health problems, allergies, touch sensitivity), lists the vaccination dates with anything missing called out, and links to the uploaded records and the signature.

- **Approve** fans the submission out into `owners`, `dogs`, `vaccinations` and `dog_docs`, then marks the row approved. From that moment the household can check in by phone. Records are created *before* the row is marked, so a failure part-way leaves it visibly pending and safe to retry — a re-run updates the dog it already created rather than duplicating it.
- **Decline** records a staff-only note and leaves nothing behind.

A household enrolling a second dog later doesn't produce a duplicate: an existing dog name on that phone number is updated in place.

Required vaccines are set by `REQUIRED_VACCINES` in [lib/enrollment.ts](lib/enrollment.ts) — rabies, DHPP and bordetella by default. Influenza and leptospirosis are collected but optional, since not every dog gets them.

## Two-stage enrollment

Asking somebody twenty-five questions per dog before you have agreed to take their dog is how a form gets abandoned. So the questionnaire is split at the meet & greet.

**Stage one** is the public form above. It asks only what is legally required, safety-critical, or needed to identify the household: names, phone, email, the dog basics, **vaccination dates and the uploaded record** (a dog cannot be on site without them, so they cannot wait), the agreements, the signature, and a requested meet & greet date. Roughly five minutes.

**Stage two** is a link, emailed the moment staff record the meet & greet as **passed** on `/in-house`. It collects the address, the vet, the emergency contact and authorized pick-up, the bite/growl/fence/fight history, health problems, allergies, activity restrictions, touch sensitivity, traits, play style, big-dog response, crate/kennel training, attendance plan and package interest.

| Piece | Where |
| --- | --- |
| The link | `/enroll/details/[token]` — no sign-in, no expiry |
| The token | `enrollments.details_token`, a random uuid written when the enrollment is approved |
| The trigger | `writeMeetGreetResult(row, "pass")` in [app/in-house/page.tsx](app/in-house/page.tsx) — one place, so there is one place to look when a client says it never arrived |
| The wording | **Settings → Email → "Details form, after a meet & greet passes"**, which must contain `{{link}}` |
| The state | **Requests → Details outstanding**, listing approved households that have not sent theirs back |

The form prefills what stage one already collected and never asks for it twice, the same rule the boarding form follows. Submitting **merges into the existing dog records** rather than creating new ones; reopening a completed link shows what was sent instead of a blank form.

Three consequences worth knowing:

- The review checklist ([lib/enrollmentReview.ts](lib/enrollmentReview.ts)) takes a stage. At stage one a missing vet or emergency contact is *not yet asked*, not a gap, and the review panel says so out loud — otherwise a reviewer reads a form with no bite history and concludes the dog has none.
- A dog profile whose household still owes stage two says **"⏳ Details outstanding"** and marks those sections as unasked rather than rendering them blank. Staff can still type the answers in themselves.
- The public page talks to [app/api/enrollment-details/route.ts](app/api/enrollment-details/route.ts), not to the database. The anon key may only *insert* an enrollment (see [Accounts and security](#accounts-and-security)), and no RLS policy can express "the row whose token you supplied" — so the token is matched server-side with `SUPABASE_SECRET_KEY`, and what a link-holder can write is a fixed whitelist of stage-two columns. It cannot touch a vaccination date, a dog's name, the household's email, or the enrollment's status.

Needs `two-stage-enrollment-migration.sql` and `SUPABASE_SECRET_KEY` in the environment. Without the key the details link explains itself and nothing else changes; without the migration the queue and the enrollment form keep working, and only the second stage is unavailable.

## Emailing clients

Three messages, deliberately different in kind:

- **The acknowledgement** is automatic, sent the moment a form is submitted. Off by default; turn it on under **Settings → Email**.
- **The approve / decline message** is always written by hand. Deciding opens a compose box pre-filled from the template, and staff edit it before sending. The decision is already saved by then, so skipping the email is fine.
- **The details form** is automatic, sent when a meet & greet is recorded as passed — see [Two-stage enrollment](#two-stage-enrollment). Its template must keep `{{link}}`; the settings page warns if it is missing, because without it the message asks for something nobody can do.

Templates live in settings (so no deploy is needed to reword them) and support `{{owner}}`, `{{dogs}}`, `{{business}}` and `{{phone}}`.

**Setup**, once per deployment:

1. Create a free account at [resend.com](https://resend.com) and verify your sending domain.
2. Put the key in `.env.local` as `RESEND_API_KEY=re_...` (and in Vercel's environment variables).
3. Set the From address under **Settings → Email**. It has to be on the verified domain or Resend rejects the send.

The key stays server-side in [app/api/email/route.ts](app/api/email/route.ts) and never reaches client JS. Leave `RESEND_API_KEY` unset and the route no-ops with `{ skipped: true }` — enrollment and approval work exactly as before, they just don't email anyone.

## Boarding requests

The second public form, mirroring enrollment. Same three entry points:

| Route | Who it is for |
| --- | --- |
| `/book` | The public link for the website |
| `/book?embed=1` | The same form with no heading, for an `<iframe>` |

It asks what the old paper/Jotform version asked: name, email, phone, whether the dog is already enrolled, one or more dog names, drop-off and pick-up dates, extra services (bath before pick-up, walks, medication, nail trim), feeding instructions, and comments. Choosing medication makes the dosage box required — a stay cannot be run off "yes, medication".

**Submitting does not book anything.** The calendar is untouched and the dates are not held; the request lands in `boarding_requests` as pending. Staff confirm it on **`/requests`** → **Boarding**, which is what writes the real `boardings` rows — one per dog, linked to each dog profile by phone and name.

The form enforces what it can and flags the rest:

- Pick-up cannot precede drop-off; drop-off cannot be in the past. Both are hard blocks.
- Less than `NOTICE_DAYS` (2) days notice is a **warning, not a block** — the policy says "please", so staff keep the final say. The request is badged with the notice given so it can be judged at a glance.

Opening a request runs an **eligibility check** against the database rather than trusting the client's own "already enrolled?" answer: for each dog it shows whether a profile exists, whether a waiver is on file, and the vaccination status, with a link straight to the profile. A dog with no profile can still be booked — sometimes that is the right call — but the reservation is flagged as unlinked in the confirmation message.

Confirming and declining both open the same pre-filled, editable email compose box as enrollment, using the boarding templates on **Settings → Email** (which also accept `{{dropoff}}`, `{{pickup}}` and `{{nights}}`).

The form also quotes a **live estimate** — nights at the boarding rate, plus walks at the per-walk rate once the client says how many a day. It is built from `estimateBoardingTotal`, the same function the front desk bills with, so the quote and the invoice cannot drift. The bath is deliberately left out of the total and shown as a size range instead: it is priced by size, and the form does not ask an owner to size their own dog.

Answering **no** to *is your dog already enrolled?* stops the form there — the dates, services and submit button are replaced by a prompt to complete enrollment first. It is taken on trust rather than looked up, because this form is public and probing it with phone numbers should not reveal who is a client. Staff still get a real database check when they review.

## Meet & greets on the calendar

Approving an enrollment writes the requested date and arrival window onto the dog, and from that moment it appears on the **`/boardings`** calendar alongside reservations, in violet with a ✨.

A three-way toggle above the month switches between **Everything**, **🛏️ Boardings** and **✨ Meet & greets**. Clicking a day lists both, with the arrival window and a link straight to the dog's profile.

Meet & greets run **weekday mornings only**, in two arrival windows (`MEET_GREET_WINDOWS` in [types/index.ts](types/index.ts)). The enrollment form rejects a weekend date inline as it is typed as well as on submit, and requires a window once a date is chosen. Staff can change both on the dog profile.

They are stored as a date on the dog rather than as their own table, which keeps them out of the reservation flow entirely — a meet & greet is not a stay, has no nights and no price. The trade-off is that a past one stays visible on its date rather than being archived; clearing the date on the profile removes it.

## Staff notifications

A request that nobody notices is worse than no request, so there are two channels.

**Email to staff.** Set the addresses under **Settings → Notifications** (comma-separated for a shared inbox plus a manager). Every new enrollment or boarding request sends a short summary with a link straight into the queue; a boarding one is tagged `** SHORT NOTICE **` when it is inside the notice window. This is the channel that matters — it reaches someone who is not looking at the app. It needs email configured; see [Emailing clients](#emailing-clients).

**In-app.** Every staff page polls both queues once a minute (two `COUNT` queries returning no rows) and on tab focus. The nav badge is the running total. When a count *rises*, a toast appears bottom-right with a "Review now" link, and — if enabled — a desktop notification.

Desktop alerts are turned on per device under **Settings → Notifications**, because the browser owns the permission and the front-desk iPad wanting them says nothing about a manager's laptop. There is a "Show a test" button, and the control reports honestly when the browser has blocked notifications rather than silently doing nothing.

The rise detection deliberately stays quiet on a first load, so opening the app with nine pending requests does not announce nine "new" ones, and it never fires when a count *drops* after an approval.

## Naming: dogs vs clients

One row per **dog**, not per client. The table is `dogs`, the type is `Dog`, and every foreign key pointing at it is `dog_id`.

It was originally called `clients`, which was wrong and quietly confusing — a "client" row had a breed and a vaccination history. Renamed in one pass across the schema and the code; see [rename-clients-to-dogs.sql](rename-clients-to-dogs.sql) and its [rollback](rollback-dogs-to-clients.sql).

The word **client** is still correct in the app, and still used, for the *human*: `owners` is the household keyed by phone, client-facing email is email to a person, and "Client phone number" on the front desk means exactly that. The distinction is now load-bearing rather than accidental:

| Thing | Means |
| --- | --- |
| `dogs` / `Dog` / `dog_id` | the animal |
| `owners` | the household, keyed by phone |
| "client" in prose and UI copy | the person paying |

Two known leftovers, both deliberate: `packages.client_name` actually holds the owner name, and `last_name` on a dog row is the owner surname. Renaming those touches three more tables and ~110 call sites, and was left for a separate pass.

## Accounts and security

Staff and the kiosk sign in with a real account. There is no shared passcode any more, and the reason matters:

**The old passcode was not security.** It was compared in the browser against a `NEXT_PUBLIC_` variable, so it shipped inside the JavaScript — readable in dev tools in about ten seconds. And it only ever guarded the UI: every table carried a blanket allow-all policy, so anyone with the anon key (which is in the public website's bundle by design) could read dogs, owners, phone numbers and payments straight from the database without going near a login screen.

Now:

- **Sign-in is a Supabase session.** Every request carries a token, and Row Level Security decides what it may touch. Refusing happens in the database, not the interface.
- **The anon key can do four things**, all of which the public pages need: read `settings`, read `site_photos`, insert into `enrollments`, insert into `boarding_requests`. Note both request tables are insert-only for the public — a visitor can submit a form but cannot read back what anyone else submitted.
- **One public page needs more than that**, and gets it server-side rather than by widening the policy: the [stage-two details form](#two-stage-enrollment) has to read back one household's submission and update its dogs. A policy cannot distinguish "the row whose token you supplied" from "every row with a token", so the token is matched in [app/api/enrollment-details/route.ts](app/api/enrollment-details/route.ts) using `SUPABASE_SECRET_KEY`, which never reaches client JS — the same shape as the Resend key. The route writes a fixed whitelist of stage-two columns and nothing else.
- **The kiosk has its own account.** It reads dogs and packages and writes sign-ins, so it cannot work signed out. It is set up once per tablet and stays signed in; the session refreshes itself. Clients never see that screen.
- **The idle lock stayed**, but it is now a convenience on top of real auth: it re-prompts on an unattended back-office screen without ending the session.

Usernames with no `@` are expanded to `username@staff.local` — a syntactically valid address that never receives mail — so staff type `frontdesk`, not an email.

### Setting it up

Do this in order. **The last step breaks an unauthenticated app the moment it runs**, so create the accounts and deploy the code first.

1. In Supabase → **Authentication → Users → Add user**, create the accounts you need, with **Auto Confirm** on:
   - one per staff member, e.g. `frontdesk@staff.local`
   - one for each lobby tablet, e.g. `kiosk@staff.local`
2. **Public sign-ups.** This instruction changed when client accounts arrived — see [Client accounts](#client-accounts-and-the-portal).

   It used to say turn them off, because *anyone could create themselves an account and inherit staff access*. That was true when RLS granted every authenticated session everything. It is not true any more: an account with no row in `staff_roles` and no household in `owners.user_id` is refused every table, every view and every write — [customer-isolation-test.sql](customer-isolation-test.sql) checks exactly that, on 24 tables and views, and the portal argument depends on it.

   So: leave sign-ups **on** if you want clients to set their own password from the invitation link, which is how the portal is built. Turn them **off** if you are not using the portal. Either way the token in the invitation, not the sign-up gate, is what grants access to a household.
3. Deploy this code.
4. Open the kiosk tablet, go to `/kiosk`, and sign in once with the kiosk account.
5. Run the security migrations **in order** — each one refuses to run before the one above it:
   1. [security-roles-migration.sql](security-roles-migration.sql)
   2. [security-audit-migration.sql](security-audit-migration.sql)
   3. [security-exports-migration.sql](security-exports-migration.sql)
   4. [customer-accounts-migration.sql](customer-accounts-migration.sql)
   5. [rls-lockdown.sql](rls-lockdown.sql)

If something stops loading afterwards, it is almost always a page being used signed-out. Sign in and it returns; nothing is deleted by the lockdown.

### Still worth doing

`NEXT_PUBLIC_SUPABASE_SECRET_KEY` in `.env.local` is a service-role key carrying a `NEXT_PUBLIC_` prefix. Nothing references it, so Next never inlines it into a bundle and it is not currently exposed — but that prefix means any future code that reads it would publish it to every visitor. Rename it to `SUPABASE_SECRET_KEY`, or delete it if unused.

## Client accounts and the portal

Clients sign in at `/account` and see their own dogs, vaccination dates, package days, stays, invoices and what is outstanding. They can update their contact details, send in a replacement vaccination record, and **ask** for boarding dates — the request lands in the same pending queue the public form feeds. They cannot book, cannot pay online, and cannot see anything belonging to another household.

### The household is a key, not a phone number

This is the part worth understanding before changing anything here.

Every child table used to be grouped by a **phone number string** — `dogs.phone`, `packages.phone`, and so on. Nothing in the database said which rows belonged to the same household except that string, and the app already strips non-digits before comparing it, which tells you the stored formats vary.

Isolation built on that would inherit every inconsistency in it. A policy comparing phone numbers fails closed when a format differs — a client silently cannot see their own dog — and that is the *better* failure. The worse one is two households whose numbers normalise to the same digits reading each other.

So [customer-accounts-migration.sql](customer-accounts-migration.sql) adds a real `owner_id` foreign key to `dogs`, `packages`, `boardings`, `signins`, `payments`, `dog_docs` and `boarding_requests`, backfills it once from the old phone grouping, and **refuses to finish** if the grouping turns out to be ambiguous or leaves anything unattached. A `fill_owner_id` trigger keeps it true for rows written afterwards, including by code that has never heard of the column.

### How somebody gets an account

Staff-initiated, always. On an owner profile there is a **Client account** panel: it issues a one-time token and emails a link to the address already on file, which is what makes holding the link proof of controlling that address.

There is deliberately **no** way for a client to claim a household by typing a phone number. Guessing a phone number is trivial, and a portal that hands over a household for a correct guess is the exact failure the requirements are about.

Invitations are good for 14 days and re-sending replaces the old one. An owner (not a manager) can unbind an account afterwards.

### Views, not tables

A client never selects from a base table. RLS answers *which rows*; it cannot answer *which columns*, and several of these tables carry a field staff write for each other — `signins.staff_note` and `meet_greet_note`, `dogs.notes`, `owners.notes`, `boardings.notes`, `payments.note`. A select policy on `signins` would let a client ask the REST API for `select=*` and read every handover note ever written about their dog.

So each read goes through a `my_*` view that names its columns, and each write through a named function. The [matrix in rls-lockdown.sql](rls-lockdown.sql) carries a cell per table saying which — `V` for a view, `F` for a function — so the whole picture is still in one place.

### Testing it

[customer-isolation-test.sql](customer-isolation-test.sql) creates two accounts, binds them to two real households, and then tries to reach across — by id, on the base tables and through the views, reading and writing — before putting everything back and removing itself. Every refusal is paired with the same read against the account's own household, so a test that passes because everything is broken fails instead.

Run it after the migrations. Every line should read PASS.

## How packages work

1. On `/packages`, add a client's package: name, phone number, days it covers, and now an **optional dog name**. Leave the dog name blank for a package shared across every dog on that phone number; set it to tie a package to one specific dog when a family's dogs don't share the same package.
2. On the kiosk, when someone types a phone number that matches, each selected dog shows its own package badge — a dog-specific package takes priority; a phone-only (no dog name) package is used as the shared fallback.
3. If the visit is a **daycare drop-off** and a package is found for that dog, one day is deducted automatically on submit. Pick-ups just display the remaining count, they don't deduct. With multiple dogs selected, each dog's own package (if any) is checked and deducted independently.
   - **A visit only ever consumes a day from one package**, even when a household owns several. Which one is decided by `eligiblePackagesFor()` in [lib/dogs.ts](lib/dogs.ts): packages with days remaining rank above used-up ones, and within that, a package bought for this specific dog ranks above a shared one, newest first.
   - **Choosing between a household's packages is staff-only.** The lobby kiosk always takes the default above and just notes how many packages are on file — parents don't get a picker. To spend a day from a specific package, sign the dog out from the **front desk** panel (see below), whose per-dog **Package to draw from** dropdown lists each one with its remaining days ("Bella · 6 of 10 left", "Shared · 2 of 5 left"); used-up packages appear but can't be selected.
4. Phone numbers are auto-formatted as `(555) 123-4567` everywhere — the kiosk and the packages page both format as-you-type, so matching is reliable without staff needing to type it a specific way.

## Front desk — staff signing dogs in and out

Not every client uses the lobby kiosk. **`/records` → "🚗 Sign a dog in / out"** (also linked from the dashboard as *Front desk*) opens a staff panel that does it for them:

- Look up the client's phone number, then each dog on it shows whether it's currently **In** or **Out**, and the button flips to match — *Sign Buki in* or *Sign Buki out*.
- For a drop-off, staff pick the service and that dog's add-ons, plus the bath pick-up window when a bath is added. A dog with a reservation covering today is forced to boarding, same as the kiosk; picking Boarding without one is refused.
- For a pick-up, the service is locked to however the dog came in, and the panel says up front whether signing out now will spend a package day — and if not, why (under four hours, or not a daycare visit).
- Staff enter their own name, recorded as the drop-off/pick-up person, and the row is tagged `by_staff` so the records list can tell a front-desk entry from a client's own kiosk check-in.

**Both paths write through the same code.** `performSignIn()` in [lib/signin.ts](lib/signin.ts) is the single place a sign-in row is created, and [components/KioskForm.tsx](components/KioskForm.tsx) and [components/StaffCheckIn.tsx](components/StaffCheckIn.tsx) both call it — so package deduction, pricing, and the usage ledger can't drift apart between the lobby and the front desk. The phone lookup is shared the same way via `loadPhoneContext()`.
5. `/packages` lets you edit a package's total day count anytime (Edit button), or manually nudge the used-days count up/down for corrections.

## Service locking and walk-in pricing

- **A dog can only be picked up under the service it was dropped off as** — daycare in means daycare out, boarding in means boarding out. The kiosk locks this automatically: at pick-up, each selected dog's service is read from their most recent open drop-off (see the lookup in `components/KioskForm.tsx` and the pricing math in `lib/pricing.ts`), shown as a badge, and the manual Service selector only reappears as a fallback for a dog with no open drop-off on file (a correction scenario). This lookup isn't limited to "today" — a boarding stay's drop-off can be several days before its pick-up.
- **A package only ever covers a FULL daycare day — never a half day, add-ons, or boarding.** Since a package day can only be decided once the actual visit length is known, package deduction happens at **pick-up**, not drop-off: if the visit turns out to be 4 hours or less, it's billed as a walk-in half day ($50) and no package day is used, even if one's on file. Walk/nail-trim/bath charges apply on top regardless of whether a package covers the base rate. Boarding never uses packages at all, so it always gets its full nightly + late-fee math.
- **A dog that's already signed in can't be dropped off again** — this is a hard block: the kiosk checks every selected dog against who's currently signed in before submitting, and refuses with a clear message (listing which dog(s)) until they're picked up first. The Sign In button itself disables and relabels to "Already signed in" the moment a duplicate is selected.
- **Pricing, defined in `lib/pricing.ts`:**
  - Daycare: **$70 full day**, or **$50 half day** if 4 hours or less between drop-off and pick-up.
  - Boarding: **$90/night** (partial nights round up to a full night), **+$50** if picked up at or after 12:00 PM (an extra half-day daycare fee for the late checkout). This is a **last-day charge only** — it's applied once, against the actual pick-up, so a running mid-stay estimate on `/records` never adds it just because the clock passed noon on an earlier day of the stay.
  - **Walk (+$30) and nail trim (+$25)** are added automatically the moment those add-ons are picked at drop-off.
  - **Bath is priced by size** — S ($60) / M ($80) / L ($100) — and **a bath with no size costs nothing**, so where the size comes from matters:
    - **A boarding reservation books a size**, so it's carried onto the sign-in row automatically at drop-off (both the kiosk and the front desk do this via `bathSize` in [lib/signin.ts](lib/signin.ts)). Nothing for staff to re-enter — the bath prices itself.
    - **A walk-in bath genuinely has no size** until staff pick one, since it depends on the dog. Assign it on `/records` any time, even mid-visit.
    - Until a size is set, `/records` shows a **⚠️ Set bath size to charge it** flag on that row. Without it, the bath is silently worth $0 and the client leaves undercharged — the flag is what makes that visible.
    - Once set, it's included everywhere automatically: the kiosk's pick-up screen picks it up on its next lookup, and it appears in the price breakdown on both the kiosk and `/records`.
  - Meet & greet has no defined price.
- **A 🧾 icon next to any price** (kiosk pick-up screen and `/records`) toggles a line-by-line breakdown — base rate, each add-on, bath if set — instead of just the total.
- **`/records` shows a live estimate before pick-up too**, not just after. A dog still signed in shows its running total (marked "(est.)") using the current time as a stand-in pick-up, recalculated on load — so staff can see roughly what's owed without waiting for the dog to actually leave. Once picked up, the number becomes final (and freely editable for adjustments); the printed report never shows this column either way.
- **Deleting an entry fully clears "signed in" status** — the kiosk's signed-in/locked-service lookup always reads live from the `signins` table with no caching, so once every row for a dog's visit is deleted (or once a normal pick-up is logged), that phone number stops showing the dog as signed in on the very next kiosk lookup.

## Boarding reservations

- `/boardings` (staff, same passcode as `/records`) is where advance boarding stays are created. Add a reservation with the dog's name, owner last name, phone, drop-off/pick-up dates, optional feeding instructions, and optional notes. Reservations can be edited or deleted any time from the same page.
- The page also shows a **month calendar** with every day's reservations as small pills (color-coded per stay) — click a day to see exactly who's booked that day. Below the calendar, an **upcoming & current** list (and a collapsed **past** list) gives the same info without needing to click through the calendar.
- **The kiosk checks this before allowing a boarding drop-off.** When a phone number is looked up and "Boarding" is selected as the service, each selected dog is checked against `boardings` for a reservation whose date range covers today. A dog with no matching reservation shows **"No reservation found"** on its card, and the Sign In button disables and relabels the same way it does for an already-signed-in dog — staff need to add the reservation on `/boardings` first. Daycare and meet & greet drop-offs are unaffected; only boarding requires a reservation on file.
- **Add-ons at the kiosk are chosen per dog**, not once for the whole sign-in — when two dogs from the same family drop off together, each gets its own bath/walk/nail-trim selection instead of both getting whatever was picked once.
- **A dog with a reservation covering today can only sign in as boarding.** The stay is already booked, so that dog's service is forced to Boarding regardless of the service selector — it can't be checked in as a daycare visit. Reserved dogs show a "🛏️ Boarding · reserved" badge.
- **Mixed sign-ins work**: one dog boarding on a reservation and another coming in for daycare can check in together. The service selector only governs the dogs *without* a reservation — when there's a mix it's labelled with their names ("Service for Max"), and the reserved dogs are called out separately above it. The "no reservation found" block only fires for a dog with nothing booked that's explicitly being signed in as boarding, so it never gets in the way of the mixed case.
- **A dog with a reservation covering today gets its add-ons pre-selected at the kiosk** from what staff booked, so the parent doesn't re-pick what was already agreed. They stay editable — tapping any chip changes that dog's selection and the change sticks. Only add-ons the kiosk offers are pre-filled; `medication` is staff-handled and never appears as a kiosk chip.
- **Looking up a phone number shows any reservation on file** for each selected dog — the stay's dates with the pick-up date called out, the add-ons booked (walks/day and bath size included), and the feeding instructions. A stay running today shows as "Boarding reservation on file"; if there's none today but one is booked ahead, the soonest future stay shows as "Upcoming boarding reservation" (information only — it doesn't pre-fill add-ons, since it isn't today's visit).
- Reservations can carry an optional **photo** (resized client-side before upload, stored the same way the signed waiver is) — it shows in the **Stay** section of that dog's `/report`. This is separate from the kiosk sign-in photo (see "Dog report" below) — one's tied to this specific stay, the other to the dog's profile.

## Dog and owner profiles

Two staff-only hub pages, reached by **clicking a dog's name anywhere in the app** (records, packages, the walk log) rather than from the nav. Hovering a dog's name first shows a summary card with their photo, vaccine status, package days left, and next stay.

**`/dogs/[id]` — the dog profile**

- **Photo** — this is where staff set the dog's picture (resized client-side, stored on `clients.photo_data`). Once set it shows on the kiosk sign-in/out card so parents recognize their dog at a glance; parents can see it but can't change it. *(This moved here from `/report`.)*
- **Basic info** — dog name, owner last name, and usual drop-off/pick-up person, editable inline.
- **Vaccines** — a fixed list (Rabies, DHPP, Bordetella, Canine influenza, Leptospirosis) with a date given and an expiry per vaccine. Each row gets a badge — *No record / Expired / Expiring soon (within 30 days) / Up to date* — and the worst status across all five is summarized in the page header. Dates save as you pick them.
- **Packages, boarding stays, visits, and walks** — each in its own capped-height scrollable table so the page stays scannable. Walks pull from both sources: daycare walks logged on the sign-in row, and boarding walks logged per day and slot.

**`/owners/[phone]` — the owner profile**

`dogs` is one row per *dog*, so owner-level details live in their own `owners` table keyed by phone (created the first time you save one).

- Contact details (name, email, address) and a full **emergency contact** (name, phone, relationship) plus staff notes.
- **Every dog on that number**, as photo cards linking to their profiles — and this is where staff **add, edit, or remove a dog** on the account. "+ Add a dog" takes a name, owner surname (pre-filled from the household), and usual drop-off person; Edit changes those three inline; Delete removes the dog.
- A dog added here has **no signed signature** — the `/signup` flow is what captures one. The add/edit form has a **"Waiver signed and on file"** checkbox for waivers signed elsewhere (on paper, or at another location); ticking it clears the flag without fabricating a signature, and the card then reads *Waiver on file (paper)* to keep the two cases distinguishable. Untouched, the dog shows *No waiver on file* on both its card and its profile header. `hasWaiver()` in [lib/dogs.ts](lib/dogs.ts) is the single check — a real signature counts on its own.
- **Renaming a dog carries across to its reservations and packages.** Those are matched by name rather than by id, so a rename that didn't cascade would silently orphan a dog's stays and package days. The update is scoped to that phone number.
- **Deleting a dog** removes its profile, photo, and vaccine records. Past sign-ins and reservations stay in the records for bookkeeping but stop being linked to a profile — the confirmation says so, and names how many reservations are affected, before you commit.
- **Upcoming reservations across all their dogs**, and every package on the number.

## Boarding stay report (printable PDF)

- `/report` (staff, same passcode) is now **exclusively about one boarding stay**. Searching a phone number lists only dogs that have stays; dogs without one are offered as links to their profile instead, which is where their details and daycare history live.
- The page shows: a compact read-only header (photo, name, link to the full profile), the stay's dates/feeding instructions/notes/medication, a **walk log**, a **meal log chart** (breakfast, lunch, dinner, snack — tap to mark fed, records who fed), sign-in/out times scoped to the stay, and the **charges breakdown and total**.
- **The walk log is now saved, not just printed.** It has a row per day and a column per walk (following the reservation's walks/day), each with out / back / initials. Entries save as you type into `walk_logs` and also show on the dog's profile. Anything left blank still prints as a dotted line to fill in by hand.
- **The total always includes the nightly boarding rate**, not just add-ons — it's computed from the reservation itself (`estimateBoardingTotal`), so it's correct mid-stay, before a pick-up has recorded a final price.
- A reservation can carry its own photo (added on `/boardings`), shown in the **Stay** section — separate from the profile photo, since a dog has one current kiosk photo but can have a different photo per stay.
- **Print / Save as PDF** opens the browser's print dialog, same as `/records`.

## Dashboard — what's on today

`/dashboard` is the staff hub. It answers "what does today hold?", deliberately **without showing money** — it's the screen most likely to be open on a shared machine near clients, so revenue lives only on `/daily`.

- Headline counts: **in house**, **still to arrive**, **dropped off**, **picked up**.
- **Services scheduled** — a bar chart of *counts*: walks, baths, nail trims, medications. Walks and medications count for every stay covering today (a stay with 2 walks/day contributes 2); one-off grooming on a boarding stay counts on the day the dog **goes home**, since that's when a dog is bathed before pick-up.
- **Dogs by service** — daycare / boarding / meet & greet. Tap a bar to open that service's sign-in list for the day.
- A **Revenue & printable report →** link is the only route to the money.

**Boarding add-ons are counted from the reservation, never the sign-in row.** The kiosk copies a stay's booked add-ons onto its drop-off row so the parent can see them, so counting both places would tally every boarding walk twice — and price it twice, at two different rates ($30 walk-in vs $25/walk boarding). `computeDailyTotals()` in [lib/daily.ts](lib/daily.ts) skips boarding drop-offs when summing sign-in add-ons for exactly this reason.

## End-of-day report

- `/daily` (staff, same passcode) totals a day's business: **revenue**, dogs dropped off, dogs picked up, and package days used, with a date picker defaulting to today. This is the only page that shows dollar amounts.
- **Revenue by category** — daycare (full vs half day), boarding nights, walks, baths, and nail trims — shown as a bar chart plus a table with counts. Amounts come from the existing prices in `lib/pricing.ts`, so there's no second source of truth: daycare is counted at pick-up (when the visit's length, and so its rate, is known), add-ons from the drop-off row, and boarding as one night per stay covering that date.
- Visits covered by a package are excluded from revenue, since no money changed hands.
- If the total differs from what was actually charged at pick-up, the page says so and explains why — boarding accrues per night rather than at checkout, and staff can hand-edit a price on `/records`.
- The charts are plain inline SVG (no charting library), so they print exactly as they render.

## Running this for another business

The goal is a **new deployment with no code changes** — one Supabase project and one deploy per business, configured entirely from `/settings`.

Everything per-business lives in the `settings` row: business name, tagline, logo, brand colour, printed-report colour, every price, the add-on catalog, service labels, and package tiers.

- **Nothing hardcodes the business any more.** The name used to be baked into the three print headers and the browser tab title, so a second business would set its name in settings and still print the first one's on every report. The print headers now read it from settings, and `SettingsProvider` sets the tab title at runtime — the `<title>` in `app/layout.tsx` is a placeholder only. `lib/business-config.ts`, a dead env-var version of the same idea, has been removed so there's one answer to "where does branding come from".
- **Colours are runtime, not compile-time.** Tailwind's `accent-*` and `paper-*` colours resolve `rgb(var(--…) / <alpha-value>)`, and `SettingsProvider` writes those variables onto `<html>` from the saved settings. The opacity modifiers (`bg-accent-500/40`) keep working because the variables hold raw `R G B` triples rather than hex.
- **Staff pick two colours, not twelve.** A brand colour and a print colour; the lighter/darker steps either side are derived in [lib/theme.ts](lib/theme.ts) by mixing toward white and black. `500` is exactly the colour chosen. Asking a front desk to hand-pick `accent-400` is how off-brand tints creep in.
- **Printed reports theme too.** The old amber palette was 40 hardcoded utility classes and 9 hex literals across five files. They're now role-named (`paper-line`, `paper-rule`, `paper-band`, `paper-tint`, `paper-ink`) so the class names don't lie about the colour when a business prints in blue.
- Defaults live in `app/globals.css`, so the app renders correctly before settings load and a fresh install looks finished.

**Not multi-tenant.** The `settings` table is a singleton (`check (id = 1)`), so one deployment serves one business. Serving many businesses from a single deploy would need a `business_id` on all tables, RLS isolation, and real per-user auth in place of the shared passcode — a much larger change, and only worth it for self-serve signup.

## Dark mode

A **per-device staff preference**, not a business setting — one shop can have a bright front desk and a dim back office. Toggle is in the staff nav (🌙/☀️), stored in `localStorage`, and it follows the OS preference until someone picks explicitly.

- **The lobby kiosk and signup form stay light**, whatever staff chose. They're parent-facing on a device the business doesn't sit at, so a staff preference shouldn't change what a client walks up to. Because client navigation reuses the same document, `ThemeProvider` actively *removes* the class on those routes rather than just skipping it.
- **Printed reports are always light.** `@media print` resets the tokens for `:root` *and* `.dark`, so a dark screen still prints black-on-white instead of a page of ink.
- **It's driven by semantic tokens, not `dark:` variants.** `surface / surface-2 / surface-3`, `line / line-soft`, `ink / ink-2 / ink-3` are CSS variables that components reference by role (`bg-surface`, `text-ink-2`). One `.dark` block in [app/globals.css](app/globals.css) flips the whole app — that's why this was ~700 class replacements across 18 files once, rather than a `dark:` variant on every element forever.
- **The chart follows too.** SVG `fill` can't take a Tailwind class, so [components/BarChart.tsx](components/BarChart.tsx) uses `rgb(var(--surface-3))` and friends directly — otherwise the bar tracks stay frozen in light slate and glare on a dark page.

## Choosing which package a visit draws from

A household can hold several packages of the same kind — two daycare blocks, or a walk block bought before the last ran out. There are three places to control which one gets spent, in increasing order of how permanent the choice is.

**1. Pin a default on the dog's profile.** The packages table has a *Use next* column; pinning one makes every future visit draw from it (`clients.default_package_id` / `default_walk_package_id`, one per kind). An exhausted pin is ignored rather than blocking the visit — staff pinned a block, not a dead end. Click the pinned one again to unpin.

**2. Override for one visit at the front desk** (`/records` → **🚗 Sign a dog in / out**). One picker per kind, each listing only its own packages with the right unit (`8 of 10 days left` vs `9 of 10 walks left`). The two are keyed by `clientId|kind`, so a visit can draw one of each and the selections don't disturb one another. Exhausted packages stay listed but disabled, so a spent block reads as spent rather than missing.

**3. Correct it afterwards on the records row.** Editing a visit shows which package it actually spent, and changing it **re-attributes the day**: refunds the old block, deducts the new one, and repoints the ledger row so history stays truthful. "No package used" removes the deduction entirely.

Precedence is: this visit's front-desk pick → the dog's pinned default → the standard rule (own before shared, remaining before exhausted).

**Uses are tied to a specific visit.** `package_uses.signin_id` now records which sign-in spent the day, so re-attribution is unambiguous even when a dog visits twice in one day. Rows written before that fall back to matching on dog + date.

The kiosk deliberately has no picker — it takes the default and reports which one it landed on. Choosing which of the family's packages to spend isn't a parent's call.

## Balances and payments

- **A balance belongs to the household, not the dog.** One family pays one bill covering every dog on the number, so balances are keyed by phone and a payment settles charges across all of them. The dog profile shows its household's balance as a badge that links to the owner profile — it doesn't invent a per-dog split, because payments aren't taken per dog.
- **The owner profile is where money is handled**: charged / paid / outstanding at the top, a *Record payment* form (amount, method, note — with a one-click "pay full balance"), and an expandable ledger listing every charge and every payment.
- **Charges come from two places, counted once.** A visit's charge is its saved pick-up price; a package sale is its price. But a package sale is *folded into the visit it was paid on* (see `packagesSold` in `estimatePrice`), so `computeBalance()` in [lib/billing.ts](lib/billing.ts) skips it as a separate line rather than billing it twice.
- **A package sale belongs to exactly one visit** — the *earliest priced pick-up at or after the moment it was sold*, resolved by `packageBillingPickUp()` in [lib/dogs.ts](lib/dogs.ts). The looser "any visit that day" rule is wrong three ways, and all three cost real money:
  - a dog that comes back for a **second visit the same day** gets charged for the package again;
  - a **later** visit can steal the charge from the visit that actually paid it, so the package vanishes off the right receipt;
  - a package **sold after the day's last pick-up** looks billed when no saved price could contain it, silently dropping the charge.
  A package bought on an earlier day never re-applies to a later visit — those days are already paid for. If it went unpaid it stays in **outstanding** on the owner profile, which is where an unpaid balance belongs; it is not re-added to the next visit's total.
- **Payments never break a profile.** Reads are wrapped so a missing or unreachable `payments` table means "no payments known" rather than a failed page — the profile still shows its dogs, stays, packages, and vaccines. Billing is additive; it shouldn't be able to take a profile down.
- Balances are rounded to cents, so floating-point noise can't leave a settled account showing a fraction of a penny owed.

## How boarding is billed and counted

- **Nothing is billed until the dog leaves.** A boarding stay's whole total — nights *and* add-ons — lands as revenue on the day of check-out, not spread across the nights. A stay still running shows separately as **projected**, which is a forecast and is deliberately excluded from the revenue total.
- **Add-ons are broken out, not lumped in.** At check-out a stay's total is split across the same categories a daycare visit uses: the **Boarding nights** line is the nightly rate only, and that stay's walks, bath, nail trim, and medication land under **Walks / Baths / Nail trims / Medication**. So grooming and walk revenue is visible wherever it came from, instead of being invisible inside a boarding figure.
- **Boarding add-ons are counted once, from the reservation.** The kiosk copies a stay's add-ons onto its drop-off row so the parent can see them at the door, so `lib/daily.ts` skips boarding drop-offs in the walk-in add-on tally — counting both places would bill each boarding walk twice, and at the walk-in rate rather than the per-walk boarding rate.
- The split comes from `boardingAddonAmounts()` in [lib/pricing.ts](lib/pricing.ts), which is also what builds the line-by-line breakdown on the printed stay report — so the report and the invoice can't drift apart.

## Records and daily PDF

- `/records` shows one row per dog per day, with separate drop-off and pick-up time columns — unchanged from before. The only related update: since packages can now be tied to a specific dog, the package column matches a dog-specific package first and falls back to a shared one, instead of just picking the newest package for that phone number regardless of which dog it was for.
- **Grouped by service** by default: rows are sorted into Daycare, then Boarding, then Meet & greet sections (each with a small header row), instead of one flat list sorted purely by time. This applies on-screen and on the printed report.
- **A Status column shows at a glance who's still here.** A dog with a drop-off and no pick-up after it reads **🟢 In**, and its whole row gets a green left edge and a faint tint so the dogs on site are scannable without reading the times columns. A dog that's gone reads **✓ Left**. A count — *🟢 3 still here* — sits next to the page title. Status is derived from the drop-off/pick-up times rather than stored, so correcting a time on a row updates it automatically.
- **Sortable columns.** Click a column header to sort by it — dog, status, last name, phone, drop-off by, drop-off time, picked-up by, pick-up time, or price. Sorting by **status** puts the dogs still on site first, which is the list staff actually act on. First click sorts ascending, second descending, third returns to the grouped default. The active column is highlighted with ▲/▼, and a *Sorted by …* chip above the table shows the current sort with a one-click way back to grouping.
  - Sorting **replaces the service grouping**, since interleaved rows would fragment the group bands. So the service moves onto each row as a small badge next to the dog's name — the information isn't lost, just relocated.
  - **Blank cells always sort last, in both directions.** A dog still on site has no pick-up time and no final price; treating those as zero would rank them "earliest" or "cheapest" and float them to the top when the column is reversed. `compareBy()` in [app/records/page.tsx](app/records/page.tsx) applies direction only to real values.
  - Sorting by **price** uses whatever the row displays — the final price once set, otherwise the running estimate — so the order matches what's on screen.
  - Headers print as plain text; a print-out has no sort affordance.
- Each row has **Edit** (last name, drop-off-by, picked-up-by, service, add-ons, and the actual drop-off/pick-up times) and **Delete**. Delete removes every underlying record for that dog/day — including any duplicate sign-ins from before the kiosk's "already signed in" warning existed, not just the most recent drop-off/pick-up pair.
- Pick a date with the date picker (defaults to today), then **Print / Save as PDF** opens your browser's print dialog — unchanged. Choose "Save as PDF" as the destination to get a PDF formatted like the on-screen list.
- A **🚶 Walk log** toggle switches the page to a printable list of every walk owed that day, **grouped by daycare and boarding**. Daycare dogs appear once each (their walk saves onto the sign-in row); boarding dogs appear once per walk slot, following their reservation's walks/day, saving into `walk_logs` — the same entries the stay report shows. Walk out/in and staff initials are editable inline and save on blur, so staff can fill it in digitally; anything left blank still prints as a dotted line.
- When a parent books a bath at the kiosk they pick a **pick-up window**, which shows under that dog's add-ons here so grooming knows when the dog is due back out front.

## Packages

- `/packages` uses the same **phone lookup and multi-dog picker** as `/boardings` — type the number, tap which dogs the package is for, and one package is created per dog. A **shared** checkbox instead creates a single package with no dog attached, covering every dog on that number (the original behaviour).
- Packages are split into **active** and a collapsed **used-up** list.
- Each package shows a **usage history** — tap the 🗓️ button to see the dates its days were consumed. The kiosk records a row every time it deducts a day at pick-up, and the manual *Use a day* / *Undo* buttons keep that history in step. Days consumed before this history existed aren't listed, but the remaining-days count is still correct.
- *Use a day* and *Undo* were previously wired backwards (the ➕ button consumed a day); they're now labelled by what they actually do. The "edit total" control, which existed in code but had no button, is now reachable.

### Package pricing

- **Selling a package is the revenue event.** The client pays the package price up front instead of a daycare fee, so `packages.price` is counted as revenue on the day of sale, and the visits it later covers are $0 — the money was already taken. That's why *Packages sold* is its own line on `/daily`.
- **Prices come from configured tiers, not free-hand typing.** The blocks you sell (5 days / $325, 10 / $600, 20 / $1100 by default) are set on **Settings → Package pricing**. Selling is then one tap on a tier, which fills in both the days and the price. A **Custom…** option is still there for one-offs.
- Each tier shows its effective per-day rate, and the settings editor **flags a tier priced at or above the walk-in day rate** — that's a tier a client has no reason to buy, and it's easy to create by accident when the walk-in rate changes.
- Packages sold before prices were recorded show *no price recorded* rather than a misleading $0, so they don't quietly understate revenue.

## Settings

`/settings` (staff, same passcode) is where the app's own configuration lives. Everything here used to be hardcoded and needed a redeploy to change.

- **Business** — name, tagline, and a logo upload. These drive the kiosk header; the logo falls back to the bundled one when empty.
- **Daycare & boarding rates** — full/half day, the half-day cutoff in hours, nightly boarding, and the late pick-up fee and hour.
- **Bath prices** by size, **daycare add-ons** (add your own, with prices), **package tiers**, and **boarding add-on rates**.
- **Services** can be renamed and re-iconed. Adding a genuinely new service type still needs code — daycare, boarding, and meet & greet each have their own pricing and booking rules — and the page says so rather than offering a button that half-works.
- Built-in add-ons can be edited but **not deleted**: bath has sizes, walk feeds the walk log, medication is boarding-only, and code depends on those keys existing. Custom add-ons get a stable key derived from their name at creation, so renaming one later doesn't orphan the values already written into `signins.addons`.
- Edits are a **local draft** — nothing reaches the kiosk until you hit Save.

Implementation note: prices are read through getter objects (`PRICING.daycareFullDay`, `BATH_PRICES[size]`) backed by a settings cache hydrated once at startup by `SettingsProvider`. That kept every call site unchanged and, more importantly, left `estimatePrice()` and the rest of [lib/pricing.ts](lib/pricing.ts) pure and synchronous — making them async would have rippled through every page. If the `settings` table is missing or Supabase is unreachable, `loadSettings()` logs and keeps the shipped defaults, so the kiosk still opens.

## Staff navigation & passcode timeout

- `/records`, `/boardings`, `/report`, `/packages`, and `/daily` share a nav bar at the top of each page — `/records` is the hub staff land on, with links to jump to the others (and back to the kiosk). Dog and owner profiles are deliberately not in the nav; they're reached by clicking a dog's name.
- The passcode unlock is **shared across every staff page** for 30 minutes at a time (`NEXT_PUBLIC_STAFF_UNLOCK_MINUTES` env var to change it) — unlocking once and navigating between pages doesn't re-prompt, but it locks again automatically after that long without a staff page being open.

## 3. Deploy to Vercel

Push to GitHub, import into Vercel, add the three env vars above under Environment Variables, deploy.

## 4. Set up the lobby iPad

Open the Vercel URL in Safari → Share → **Add to Home Screen**. Then:
- Settings → **Guided Access** (Accessibility) lets you lock the iPad into just this app, so customers can't back out to the home screen or other apps. Turn it on, then triple-click the side button to start/stop the lock.
- Consider **Screen → Auto-Lock → Never** on the kiosk device (Settings → Display & Brightness) so it doesn't sleep between customers.

## Customizing

- Styled with Tailwind CSS. Colors live in `tailwind.config.ts` under the `accent` palette — change those hex values to rebrand everything at once, or edit classes directly in `components/KioskForm.tsx` and `app/records/page.tsx`.
- Business name: `app/layout.tsx` (title) and `components/KioskForm.tsx` (heading).
- Swap the 🐾 emoji for a real logo: replace it in `KioskForm.tsx` with an `<img src="/logo.png" className="h-16 w-16 rounded-2xl object-cover" />` and drop your logo file in `/public`.
- Icons in `/public` are placeholders — swap `icon-192.png` / `icon-512.png` for real art, same file names.

## Notes

- Signatures are stored as base64 PNG images directly in the database row. Fine at this volume; if the daycare gets very high traffic, moving signatures to Supabase Storage instead of the table is the next optimization.
- No staff page is linked from the kiosk — bookmark `/records` on a staff device. Every other staff page is reachable from its nav bar once unlocked, so one bookmark is enough.
- Owner profiles are keyed by phone number, which is how the whole app already identifies a client. A client changing their number breaks the link between their dogs, same as it does everywhere else in the app — re-save the dogs under the new number if that happens.
