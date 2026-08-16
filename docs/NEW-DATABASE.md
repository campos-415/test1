# Standing up a database from nothing

## The short way

```bash
npm run setup
```

Create the Supabase project first, and get a personal access token from
<https://supabase.com/dashboard/account/tokens>. The command asks for the
token, which staff sign-ins to make, and the business name and hours — then
runs everything below in the right order, creates the accounts, makes the
storage bucket and writes `.env.local`.

It exists because ordering these by hand is where every failure in this project
has come from. `scripts/setup.mjs` holds the same order this page documents,
and a test checks the two against each other.

If the setup command cannot reach the management API, this gets you the whole
thing in one paste-able file, in the right order:

```bash
npm run setup -- --print-sql > all.sql
```

The rest of this page is the manual route, and what each file is for.

## The long way

Run these in the Supabase SQL editor, in this order, on a project with no
tables in it. Needed twice: once for a development database, and once for each
new location.

**There are 24 SQL files in the repository and only 18 belong in this run.**
Two are rollbacks, one renames a table that will not exist on a fresh database,
one starts a broken run over, and two are the isolation test and its fixtures,
which come after. Running everything in alphabetical order does not work — that
is what this file exists to prevent.

The order below is not a matter of taste. Several files open with a preflight
check that stops the run if what they depend on is missing, and the message
names the file to run first. If you hit one of those, you are out of order —
follow the message rather than working around it.

## Order

| # | File | What it does |
|---|---|---|
| 0 | `00-base-schema.sql` | **First.** The twelve core tables. Without it every migration below fails with relation dogs does not exist |
| 1 | `enrollment-migration.sql` | The enrollments table, and the dogs and owners it approves into |
| 2 | `boarding-requests-migration.sql` | Boarding requests from the website |
| 3 | `walk-log-per-dog-migration.sql` | Walk logs, one row per dog rather than per stay |
| 4 | `walk-package-boarding-migration.sql` | Walk packages, and keeping boarding walks out of them |
| 5 | `meet-greet-result-migration.sql` | Pass or fail on an assessment |
| 6 | `signin-notes-migration.sql` | Staff notes on a visit |
| 7 | `signin-meals-migration.sql` | Meals, and the package opt-out |
| 8 | `site-photos-migration.sql` | Website images |
| 9 | `site-storage-migration.sql` | Storage bucket permissions for those images |
| 10 | `two-stage-enrollment-migration.sql` | Splits enrollment into two stages |
| 11 | `security-roles-migration.sql` | **Stop and read "Before step 11" below before running this one** |
| 12 | `security-audit-migration.sql` | The audit log and its triggers |
| 13 | `security-exports-migration.sql` | Who may export the customer database |
| 14 | `customer-accounts-migration.sql` | `owner_id` on every table, and customer accounts. Needs `staff_roles` from step 11 |
| 15 | `customer-details-handover-migration.sql` | Stage two behind the customer account |
| 16 | `customer-second-dog-migration.sql` | Adding a dog to an existing household |
| 17 | `rls-lockdown.sql` | **Last.** The policy matrix, which needs every table and column above to exist |

Steps 1 to 10 create tables and columns. Steps 11 to 17 decide who may read
them, and every one of those needs the tables to be there already — which is
why the whole security block sits at the end and `rls-lockdown.sql` sits at the
very end of that.

Within the security block the two customer files (15, 16) come **after**
`customer-accounts-migration.sql`, not before it: they call
`customer_owner_id()`, which step 14 creates. Step 16 must also come before
step 17, because it adds the `owner_id` column that the lockdown matrix
compares against on the enrollments table.

**The app will not work until step 17 has run.** Step 0 creates the tables with
row-level security switched on and no policies on them, so they are closed
until the lockdown grants access deliberately. A deployment abandoned half way
is then shut rather than wide open. If you point the app at the database before
finishing and every screen is empty, that is this and not a fault — finish the
run.

## Not in the list, and why

| File | Why not |
|---|---|
| `rename-clients-to-dogs.sql` | Renames a table that a fresh database never had |
| `rollback-dogs-to-clients.sql` | Undoes the above |
| `security-rollback.sql` | Undoes 11 to 13. Keep it open in a tab while running them |
| `customer-isolation-test.sql` | A test, not a migration. Run it after 17 to prove isolation works |
| `customer-isolation-fixtures.sql` | Two throwaway households so that test has something to test. See below |
| `00-reset-empty-database.sql` | Starts a half-built database over. See below |

## If a run goes wrong part way through

Re-running the file that failed is usually enough — every file here is safe to
run twice. What re-running does **not** fix is a table that got created with
something missing, because `create table if not exists` skips a table that
already exists and never adds the missing piece.

For that, run `00-reset-empty-database.sql` and start again from step 0. It
drops every table these files create, and it **refuses to run if the database
has any rows in it** — so it stops rather than destroys if it is ever pasted
into the wrong project by mistake. That guard is the point of the file; forcing
it through by deleting the guard is how a production database gets lost.

## Before step 11

`security-roles-migration.sql` opens with a seed list setting who gets which
role. **Every account that exists must be in it** — an account not listed gets
no role and therefore no access.

Create the staff accounts in the Supabase dashboard first, under
Authentication, with **Auto Confirm User** ticked. Addresses ending
`@staff.local` display in the app as just the username.

The migration refuses to finish if the list would leave the business with no
`owner_admin`, so a typo fails loudly rather than locking everybody out.

## After step 17

1. **Seed two check households**, then run the isolation test. See below —
   on a database with no clients yet, the test cannot run without this.
2. Run `customer-isolation-test.sql`. Every attempt in it should be refused.
3. Sign in as the owner account. Confirm settings open.
4. Sign in as a plain employee account. Confirm the care screens work and the
   CSV exports are refused.

Step 4 is the one worth doing deliberately. It is the only check that proves
the roles are real rather than decorative, and it is what the client asked for
in writing.

### The isolation test needs two households

`customer-isolation-test.sql` signs in as one client and tries to reach
another client dog, package, stay, invoice and document. On a database for a
daycare that has not opened, there are no clients, and the test stops with:

> Need two unclaimed households that each have a dog, a package, a stay and a
> visit. This database does not have them.

That is the test refusing to pass on empty tables, which is correct — every
probe would come back with no rows whether the policies worked or not, and it
would report a clean pass that meant nothing.

Run `customer-isolation-fixtures.sql` first. It creates two obviously fake
households on 555 numbers, each with a dog, a package, a stay, a visit and a
vaccination record. Then run the test.

**Remove them once the test has passed.** The test cleans up its own rows but
not these:

```sql
delete from public.signins   where staff_note  = 'isolation-check-household';
delete from public.boardings where notes       = 'isolation-check-household';
delete from public.packages  where client_name = 'isolation-check-household';
delete from public.dogs      where notes       = 'isolation-check-household';
delete from public.owners    where notes       = 'isolation-check-household';
```

Run them in that order — the child rows first. Vaccination records go with the
dogs automatically. On a database that already has real clients, skip all of
this: two genuine households satisfy the test on their own.

## Pointing the app at it

`.env.local` holds the development database. Production credentials belong in
the hosting platform's environment settings and nowhere else.

```
NEXT_PUBLIC_SUPABASE_URL=https://<dev-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<dev anon key>
SUPABASE_SECRET_KEY=<dev service key>
```

Keep the production values somewhere safe before overwriting them — they are
not recoverable from this file once replaced, only from the Supabase
dashboard.
