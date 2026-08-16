# Roles, two-factor sign-in and the audit log

What this covers, and how to put it in place without locking the business out
of its own application.

This is items 1 to 3 of the list at the end of `SECURITY-REVIEW.md`: roles
enforced in the database, MFA for the accounts that need it, and an audit log.
Items 4 to 7 — a development project separate from production, customer
accounts, verified backups, and the testing checklist — are untouched and
still outstanding.

---

## The short version

Before this, every account that could sign in could do everything: read every
client record, read every payment, and download the whole customer database as
a spreadsheet. There was one class of signed-in user and the database granted
it everything.

Now there are four roles, the database refuses what each one is not entitled
to, Owner/Admin and Manager accounts carry a second factor, and sign-ins,
permission changes, edits to client records and every export are recorded in a
table nobody can edit.

---

## Run these four files, in this order

In the Supabase SQL editor, one at a time, checking the output of each before
starting the next.

| # | File | What it does | Can it lock anyone out? |
|---|---|---|---|
| 1 | `security-roles-migration.sql` | Creates `staff_roles` and the functions the policies call. Assigns roles to the accounts that already exist. | No |
| 2 | `security-audit-migration.sql` | Creates `audit_log`, the redaction and append-only triggers, and the triggers that record edits. | No |
| 3 | `security-exports-migration.sql` | Creates the two export functions that authorise and record a download. | No |
| 4 | `rls-lockdown.sql` | Replaces the blanket policy with the per-role matrix. | **Yes** |

**Before running file 1, edit the seed list at the top of it.** It assigns
`cesar@staff.local` as the owner and `kiosk@staff.local` as the lobby iPad.
Any account not listed gets no role, and an account with no role can sign in
and do nothing. File 1 prints the accounts it has left unassigned, and refuses
to finish at all if the result would leave no owner.

Only file 4 changes who can do what, and it refuses to run if files 1 and 2
have not been run — without roles to find, every policy it writes would
evaluate false for everybody. It is one `do` block, which is one statement,
which is one transaction: the old policy and the new ones swap atomically, so
there is no moment where a table has lost its old policy and not yet got its
new one, and a failure part way through leaves the database exactly as it was.

Have `security-rollback.sql` open in another tab while you run file 4.

---

## The roles

| | Owner/Admin | Manager | Employee | Kiosk |
|---|---|---|---|---|
| Look up a dog, read its record | ✓ | ✓ | ✓ | ✓ |
| Sign dogs in and out, meals, walks | ✓ | ✓ | ✓ | ✓ |
| Read the owner record (address, emergency contact, vet) | ✓ | ✓ | ✓ | — |
| Edit a dog or owner record | ✓ | ✓ | ✓ | — |
| See a household balance, take a payment | ✓ | ✓ | ✓ | ✓ |
| Add a dog, process an enrolment | ✓ | ✓ | ✓ | — |
| Sell or edit a package | ✓ | ✓ | — | — |
| Delete a dog, owner, reservation, document, vaccination | ✓ | ✓ | — | — |
| Business-wide money: receivables and ageing | ✓ | ✓ | — | — |
| **Export the client database as CSV** | ✓ | ✓ | — | — |
| Read the audit log | ✓ | ✓ | — | — |
| Change prices, branding, email templates | ✓ | — | — | — |
| Delete a payment record | ✓ | — | — | — |
| Change anybody's role | ✓ | — | — | — |

The matrix in `rls-lockdown.sql` is the authority; this table is a reading of
it. Each cell there is one of `OA`, `M`, `E`, `EK`, `ANY` or `-`, and changing
who may do something is changing one cell.

Three choices in it worth knowing about, because each could reasonably have
gone the other way:

**Employees can read the owner record.** It holds the address and email, which
they do not need. It also holds the emergency contact and the vet, which they
very much do when a dog is hurt at four on a Sunday. Animal welfare won.

**Employees cannot delete.** They correct today — a meal marked given by
mistake, a package day taken in error — and do not remove dogs, owners,
reservations, documents or vaccination records. Cancelling a booking is
therefore a manager job. If that turns out to be a nuisance at the front desk,
it is one cell.

**Deleting a payment is owner-only, not manager.** It is the one deletion that
destroys a money trail rather than a record of care.

### The kiosk role

The requirements document names three roles. There are four, because the lobby
iPad is a real account and it is a screen in a public room with nobody standing
next to it. As an employee it would have held the entire customer database.
Instead it can find a dog by phone, sign it in and out, spend a package day,
take a payment and accept a signup form — and it cannot read the owners table
at all, so there are no addresses, emails or emergency contacts on it.

---

## Two-factor sign-in

Supabase Auth does the work: it generates the secret, renders the QR code,
checks the code, and raises the session to `aal2`. Nothing about TOTP is
implemented in this application.

The database is what enforces it. `mfa_ok()` reads the `aal` claim out of the
session token, and every Manager and Owner capability is written in terms of
it. A session that has not presented a code cannot export, cannot delete and
cannot change a permission, whatever the interface allows.

**An account that has not enrolled is never blocked.** This is the rule the
whole thing is built on, and it is structural rather than incidental. In the
database, `mfa_ok()` passes for an account with no verified factor that is not
marked `require_mfa`. In the app, the enrolment prompt is a dismissible banner
sitting above a fully usable screen, not a wall. Being unable to sign in to a
working application because of a security feature that has not been set up yet
is a worse failure than not having the feature.

Enforcement is therefore switched on per account, two ways: enrolling sets
`require_mfa` on that account, or an owner sets it in Settings → Security.
Switching it on cannot strand somebody who has not enrolled, because they are
the person it is being switched on for.

There are exactly two places the app does block, and both can be got out of:

- **A code prompt** for an account that has enrolled and whose session is still
  at `aal1`. It can always be completed — the account that enrolled has the app
  in its hand.
- **The enrolment screen** for an account an owner has deliberately required MFA
  on that still has no authenticator.

So the rollout is: run the migrations, and each manager and owner enrols when
they are next at a computer. Until they do they can do employee-level work, the
manager side is refused by the database, and a banner says so.

**If somebody loses the phone their authenticator was on**, another owner lifts
the requirement in Settings → Security and they enrol again on the new phone —
recorded in the audit log as the permission change it is. If nobody can get in
to do that, the break-glass SQL is at the bottom of `security-rollback.sql`.

**If enrolment itself will not start** — the project has MFA switched off, the
network is out — the setup panel offers "Try again" and "Skip for now and carry
on" rather than trapping somebody behind a feature that is not working.

---

## The audit log

Recorded:

- **Sign-ins and sign-outs**, written by the app when the session exists.
- **Permission changes**, by a trigger on `staff_roles`. Every grant, change,
  revocation and MFA change, in a sentence.
- **Edits to client records**, by triggers on `dogs`, `owners`, `vaccinations`,
  `dog_docs`, `packages`, `payments` and `boardings`, plus staff decisions on
  `enrollments`, `boarding_requests` and `settings`.
- **Every export**, inside the export functions, with the row count.
- **Refused exports**, written by the app.

Not recorded, on purpose: sign-ins, walk logs, meal logs and package uses.
They are the operational record of a day rather than edits to a client file,
they change many times per dog per day, and they would bury the entries that
matter. The rows themselves already carry who and when.

Four things make it worth trusting:

1. **The actor is stamped by the database** from the session. There is no
   insert policy on the table at all — the only ways in are `audit_write()`
   and the triggers. An employee can write an entry about themselves and
   cannot write one about anybody else.
2. **Edits are recorded by the tables themselves**, so a code path that
   forgets to log still gets logged.
3. **No values, only which columns changed.** The log says who touched a
   record and when; it is not a second copy of the client database sitting
   behind different policies. It also keeps the rows small, which matters when
   a dog record carries a photo.
4. **Nothing can be edited or deleted**, including with the secret key,
   because append-only is a trigger and not a policy. Removing old entries is
   possible only through `prune_audit_log()`, which an owner has to call and
   which records that it ran.

**No passwords, tokens or payment data**, enforced on the way in rather than
promised. A trigger walks the detail of every entry and replaces anything named
like a secret, anything shaped like a token, and anything that passes a Luhn
check as a card number — inside a sentence as well as as a whole value. The
checks at the bottom of `security-audit-migration.sql` demonstrate it.

---

## Testing it

### Automatically, before you run anything

```bash
npm install --no-save @electric-sql/pglite
node security-tests/policy-matrix.test.mjs
```

This runs all four migration files, unmodified, against a Postgres inside the
Node process, and then tries about a hundred things as each role: the public
website with only the anon key, an employee, the kiosk, an account with no
role, a manager before and after enrolling and before and after presenting a
code, and the owner. It checks the audit log is complete, attributed, redacted
and append-only; that no policy was left granting everything; that re-running
every migration changes nothing; and that the rollback restores access and the
lockdown can be re-applied afterwards.

It exits non-zero if anything fails. Add a case whenever the matrix changes —
the cheapest place to discover that employees can no longer sign a dog in is
that file.

### By hand, with a real non-admin account

The harness proves the policies. It cannot prove that the front desk can get
through a shift, because it does not run the application. After the migrations
are in:

1. In the Supabase dashboard, under Authentication, create
   `test@staff.local`.
2. In the app, as the owner, Settings → Security → give it **Employee**.
3. Sign in as it in a private window and walk a normal shift: sign a dog in
   at the kiosk, add a note on a dog, look up a household, take a payment,
   sign the dog out.
4. Then check the refusals: Settings → Reports should offer the printable
   reports and explain that money and spreadsheets need a manager. There
   should be no CSV buttons.
5. As the owner again, Settings → Security → Activity. Everything the test
   account did to a client record should be there, and so should its sign-in.
6. Give the test account **Manager**, sign in again, and it should ask for a
   two-factor setup before the manager side works.
7. Delete the test account when you are done.

---

## If it goes wrong

Run **stage 1** of `security-rollback.sql`. It restores the previous policies —
any signed-in account may do anything, plus the four narrow public grants — so
the app works for everybody again within seconds. It keeps `staff_roles` and
the audit log, so no role assignment and no history is lost, and
`rls-lockdown.sql` can be run again once whatever happened is understood.

Stage 2, which removes the machinery entirely, is commented out on purpose:
running it destroys the audit log.

Enrolled authenticators are not touched by either stage. They live in the
`auth` schema and are managed by Supabase Auth. With the policies back to
blanket access nothing asks about assurance level, so an enrolled factor is
just an extra prompt.

---

## What this does not fix

Worth stating plainly, because a control that is oversold is worse than one
that is understood.

**An employee can still page through the dog and owner tables using the API
directly.** The front desk has to be able to look up any dog that walks in and
reach an emergency contact, so employees keep `SELECT` on those two tables, and
no row-level rule can tell "read one dog" from "read them all". What an
employee cannot do is press a button and get a spreadsheet: the export
functions refuse them, the buttons are not there, and the export path is the
only authorised bulk path and is logged. Deliberate scraping is possible and
would be visible.

Closing that properly means one of two things, both larger than this work:
narrowing staff reads to scoped functions instead of table access, or customer
accounts — item 5 — which is what makes "customers cannot see each other's
data" a testable statement rather than a vacuous one.

**A refused delete is silent, not an error.** This is the one rough edge worth
fixing next, and it is a Postgres fact rather than a mistake: RLS refuses a
`DELETE` by matching no rows, not by raising. So an employee who presses
Delete on a dog gets no error and no deletion — the record simply reappears on
the next load. The interface hides the exports, the money and the security
screens from employees, but the delete buttons on the household, dog, in-house,
packages and stay-report pages are still shown to everybody.

Two ways to close it, either cheap: hide those buttons behind
`isManagerOrAbove` from `lib/roles.ts`, or pass `{ count: "exact" }` on the
delete and say "only a manager can delete this" when the count comes back
zero. The second is better — it tells the truth even if the role check in the
interface is ever wrong. Nothing is being let through in the meantime: the
database is refusing exactly what it should, and the defect is that it does so
without saying anything.

**Exports are paged, and they have to be.** PostgREST returns at most 1,000
rows per request however many are asked for, and the cap applies to a function
returning a set exactly as it does to a table — the live database has 2,640
vaccination records and hands back 1,000 of them. So `export_dataset` takes an
offset and a limit and the browser walks the pages, and every dataset is
ordered to its primary key as a tiebreak, because an order that is not total
can shuffle rows between pages and produce a file with one row twice and
another missing. In an export of the client database that is the worst kind of
bug: the spreadsheet looks complete. `security-tests/policy-matrix.test.mjs`
pages a 2,500 row table and checks that nothing is duplicated or dropped.

Note that `loadReportData` on `main` still has the older capped version, which
means the money figures and the three browser-composed exports are truncated
to 1,000 rows per table until the `image-budgets-and-site-storage` branch
merges. That fix is on that branch, not this one.

**`vaccinations_staging`.** The live database has this table, left over from
importing vaccination records. No migration had ever named it, so whatever
policy it had was never chosen. It is empty, so nothing is exposed, but it is
now in the matrix at manager level rather than sitting outside it. If it is
finished with, drop it.

**One Supabase project.** Local development still points at production data.
That is item 4 and nothing here changes it.

**Requirement 12 is still not done.** The testing checklist has not been run
and recorded. Several of its items now can be, which was not true before.
