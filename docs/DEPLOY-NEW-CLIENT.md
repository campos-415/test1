# Deploying this app for a new client

Every step, from an empty account to a daycare taking bookings. One
deployment per location — the app holds one business, and separate
deployments are what keep two clients' data physically unable to mix.

Budget about half a day, most of it waiting for a domain to verify.

---

**`CLIENT-INTAKE.md` is the long version of the list below** — every price,
every field, and the decisions to put to the owner. Take that one to the
meeting; this one is the deployment.

## Before you start, collect from the client

- Business name, street address, phone, email
- Opening hours: weekday, weekend, and whether they board overnight
- Prices: daycare full day and half day, boarding per night, bath by size,
  walk, and any add-ons
- Their logo as an image file
- Their domain name, if they have one, and who controls its DNS
- Whether they already have a website they want to keep

That last one decides whether you serve the built-in marketing site or point
it at theirs.

---

## 1. The repository

`scripts/bootstrap.sh` does this section and the next one for you, from an
empty folder. The commands below are what it runs, for when you would rather
do it by hand.

```bash
git clone <this repo> daycare-<client>
cd daycare-<client>
rm -rf .git && git init && git add -A && git commit -m "Initial commit"
```

Push it to a new private repository. **Whose account it goes in is decided
once and is painful to change later — see `ACCOUNTS-AND-OWNERSHIP.md`.** The
short version: a free GitHub organisation for the client, you as owner, them
as owner too.

Starting a fresh history matters: the old one contains another business's
commits and, in this repo, their PDFs.

```bash
npm install
```

`postinstall` copies the PDF worker used to turn uploaded vaccination
certificates into images. If it does not run, PDF uploads fail at the point a
client is filling in the form.

---

## 2. The database

Create a new project at supabase.com. Choose a region near the daycare.
**Save the database password** — it is shown once.

Then get a personal access token from
<https://supabase.com/dashboard/account/tokens> and run:

```bash
npm run setup
```

That does steps 2, 3, 4 and 8 of this guide: all eighteen SQL files in the
right order, the staff sign-ins, the storage bucket, the branding, and
`.env.local`. It asks before it writes anything, and it refuses to run against
a project that already has dogs in it.

Skip ahead to step 5 if it finishes cleanly.

### If you would rather do it by hand

Follow **`NEW-DATABASE.md`**, which lists the 18 SQL files, in order, and the
six not to run. Do not run them alphabetically, and do not reorder them —
several stop with an error naming the file that should have run first.

Two things in that runbook that are easy to miss:

- **Create the staff accounts first**, under Authentication, with *Auto
  Confirm User* ticked. Addresses ending `@staff.local` display in the app as
  just the username.
- **Edit the seed list** in section 4 of `security-roles-migration.sql`
  (step 11) before running it. An account not listed gets no role and
  therefore no access.

---

## 3. The storage bucket

Website images live in a bucket, not in the database. Create it under Storage:

- Name: `site-photos`
- **Public: yes** — these are the images on the public website
- File size limit: 5 MB
- Allowed types: `image/jpeg`, `image/png`, `image/webp`, `image/avif`

Then run `site-storage-migration.sql` if you have not already; it grants staff
the right to upload and everyone the right to look.

Customer documents deliberately do **not** go here. Vaccination records stay
in database rows behind row-level security, so there is no public URL to
guess.

---

## 4. Environment variables

Six variables. Create `.env.local` in the project root for local work:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SECRET_KEY=<service role key>
RESEND_API_KEY=<optional, see step 6>
EMAIL_FROM=<optional, an address on a domain you verified>
NEXT_PUBLIC_STAFF_UNLOCK_MINUTES=30
```

Both Supabase keys are under Project Settings → API.

`.env.local` is git-ignored and must stay that way. The anon key is designed
to be public and ships in the browser; the secret key must never leave the
server or your machine.

Check it runs before going further:

```bash
npm run dev
```

---

## 5. Hosting

Deploy to Vercel: import the repository, framework detects as Next.js, no
build settings to change.

Add the same six variables under Settings → Environment Variables, for
Production. **Do not paste the secret key anywhere marked as exposed to the
browser.**

If the client has a domain, add it under Domains and follow the DNS
instructions. Verification usually takes minutes but can take hours, which is
why it is worth starting early.

---

## 6. Email (optional, but do it)

Without this the app never emails anybody — enrollment approvals, booking
confirmations and the second-stage enrollment link all go unsent, silently.

1. Create a Resend account and verify the client's sending domain
2. Put the API key in `RESEND_API_KEY` and an address on that domain in
   `EMAIL_FROM`, both locally and in Vercel
3. Set the reply-to address and the message wording under Settings → Email

A key without a verified domain sends nothing.

---

## 7. Card payments (optional)

Square, through the Square Point of Sale app on the tablet at the desk. Card
details never touch this application.

1. In the Square developer dashboard, create an application
2. Copy the **Application ID** and **Location ID** into Settings → Pricing →
   Square in the app
3. **Register the deployed site's URL as a web callback URL** in the Square
   dashboard

Step 3 is the one that gets missed. Without it Square returns *"this
application is not configured for making web calls"* at the moment a client is
standing there paying. A `localhost` address will not be accepted, so this can
only be done once the site is deployed.

Leave test mode on until a real card has been through it successfully.

---

## 8. Make it theirs

All of this is in the app, under Settings. No code changes.

| Tab | What to set |
|---|---|
| Brand | Business name, address, phone, email, hours, logo, accent colour |
| Pricing | Every rate, add-on, bath size and package tier |
| Content | Every word on the public website, page by page |
| Website | Whether to serve the built-in site at all, and the photos |
| Reviews | Their real reviews, or turn the section off |
| Staff | The names that appear in the walk log |

If the client already has a website, turn **Serve the built-in marketing
website** off and put their address in the field beneath. The marketing pages
then redirect there and the deployment is purely the back office.

---

## 9. Before handing it over

Do these in order. Each catches something the previous one cannot.

1. **Sign in as the owner account.** Settings open.
2. **Sign in as a plain employee account.** The care screens work, and the CSV
   exports under Settings → Reports are refused. This is the one that proves
   the roles are real rather than decorative.
3. **Enrol multi-factor authentication** on the owner account, then confirm
   you can still sign in afterwards.
4. **Run `customer-isolation-fixtures.sql`, then
   `customer-isolation-test.sql`.** Every attempt in the test should be
   refused. The fixtures come first because a daycare that has not opened has
   no clients, and the test refuses to run against empty tables rather than
   report a pass that proves nothing. Delete the two check households
   afterwards — the statement is in `NEW-DATABASE.md`.
5. **Submit the enrollment form** as a member of the public would, approve it
   from the Requests queue, and confirm the dog appears.
6. **Sign a dog in and out at the kiosk**, and confirm the visit is priced.
7. **Upload a photo** in Settings, and confirm it appears on the website.
8. **Check the backup settings** in Supabase, and restore one once so you know
   the procedure works. A backup nobody has restored is not yet a backup.

---

## What does not carry over

Starting fresh means starting empty. There are no dogs, no owners, no history.
That is correct for a new daycare and a problem for an established one — an
existing business needs its client list imported, which is its own project and
not part of this guide. The `owners.external_id` column exists for exactly
that: it holds the identifier from whatever system they are coming from, so
the import can be reconciled and re-run.
