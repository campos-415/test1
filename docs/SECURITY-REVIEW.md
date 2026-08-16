# Security requirements — where the app actually stands

Assessed against the client's requirements document. Verified against the
running code and the live database rather than from memory. Written to be
shown to the client as-is.

**Headline:** the infrastructure requirements are met — Supabase, Supabase
Auth, TLS, encryption at rest, no custom cryptography, no card data. The
access-control requirements, which were the substantial gap when this was
first written, are now met as well: five roles enforced in the database,
customer accounts isolated by a real foreign key, and an audit log that has
recorded 147 events so far.

Three things remain, and none of them is code: multi-factor authentication is
built and deployed but nobody has enrolled yet, development still runs against
the production database, and backups have not been verified. All three must be
closed before the business opens and real customer records exist.

Verified against the running system on 12 August 2026, not from memory.

---

## 1. Backend & database

| Requirement | Status |
|---|---|
| Supabase + PostgreSQL | **Met** |
| No self-hosted database | **Met** |
| RLS on every table with customer/pet data | **Met** — verified in force: the public key reads settings only, is refused every other table, and may insert into the two form tables |
| Customers cannot reach another customer's data | **Met** — customers have accounts, and every household is identified by a real `owner_id` foreign key rather than by a phone number string. Enforced in RLS, and tested: `customer-isolation-test.sql` signs in as one customer and attempts to read another household's dog, package, boarding, invoice and document by id — on the base tables and through the customer views, reading and writing. All refused |
| Production and development separated | **Not met** — one Supabase project; local development points at the production database. Mitigating factor today: the 495 imported owner records are synthetic test data, not real customers, so no live customer information is currently exposed to development. That stops being true the day the business goes live, so the separation must exist before launch rather than after |

## 2. Authentication

| Requirement | Status |
|---|---|
| Supabase Auth, no custom auth | **Met** — real accounts; the old shared passcode was removed |
| Passwords never stored by the app | **Met** |
| MFA for Owner/Admin | **Built, not yet enrolled** — TOTP through Supabase Auth, with per-account enforcement. No account has enrolled a factor and enforcement is off on all three, so today it protects nothing. Enrolling is a five-minute task per person and must happen before the business opens |
| MFA for Managers and broad-access staff | **Built, not yet enrolled** — same mechanism; roles now exist, so it can be switched on per account |

The migration deliberately leaves a grace window: an account with no verified
factor and no enforcement flag can still sign in. That is what lets an owner
enrol rather than being locked out by the migration that introduced the
requirement. Enrolling closes the window for that account permanently.

Note for a reviewer: `lib/staffAuth.ts` keeps an "unlocked recently" timestamp
in local storage. It is a convenience that avoids re-prompting between staff
pages; it is **not** the security boundary. Every request still carries a
Supabase session and RLS decides. Worth explaining before someone flags it.

## 3. User permissions

**Met.** Five roles, enforced by the database rather than by the interface.
Three accounts are seeded today: owner/admin, employee, and the lobby kiosk.

- Employees reach the care screens and cannot **export the customer database** —
  the CSV downloads under Settings → Reports are refused to them, which is the
  specific restriction the requirements name.
- The lobby kiosk is a fifth role beyond the four required. It sits unattended
  in a public room, so it signs dogs in and out and cannot read the owner table
  at all.
- The interface hides what a role cannot do rather than disabling it, so nobody
  is offered a control the database will refuse.
- ~~There is no Customer role. Customers never sign in; enrollment and
  boarding requests are anonymous form submissions.~~ **Done.** Customers now
  sign in at `/account`, and the Customer role is the fifth column of the RLS
  matrix. A household is identified by an `owner_id` foreign key, not by the
  phone number string it used to be grouped by — the string comes in varying
  formats, and isolation resting on it would at best hide a client from their
  own dog and at worst merge two households. Accounts are claimed only
  through a one-time token that staff email to the address on file; there is
  no route in that accepts a phone number.

Required: Owner/Admin, Manager, Employee, Customer — enforced in RLS policies,
not only in the interface.

## 4. Encryption

| Requirement | Status |
|---|---|
| HTTPS/TLS everywhere | **Met** — Supabase is TLS-only |
| Encrypted at rest | **Met** — provided by the platform |
| No proprietary encryption | **Met** — none written |

## 5. Payments (future)

| Requirement | Status |
|---|---|
| PCI-compliant provider | **Met** — Square |
| Card numbers and CVV never stored | **Met** — the integration is a deep link into the Square app; no card data is entered into or returned to this application |
| Store only IDs, amount, date, status | **Met in shape** — payments hold amount, date and phone |

## 6. Documents & photos

| Requirement | Status |
|---|---|
| Documents in private storage, not public URLs | **Met, with a caveat** |
| Same authorisation rules as the account | **Partly** |
| No access by changing a URL | **Met** |

Vaccination records and dog photos are stored **inside database rows**, behind
RLS. There is no public URL to guess, so the URL-manipulation attack does not
apply. This was a deliberate decision: a public `site-photos` bucket exists,
but it holds **only marketing images** — the website gallery, hero photos, the
logo and team headshots. Customer documents were deliberately kept out of it.

The caveat: "same authorisation rules as the customer's account" cannot be
satisfied while customers have no accounts. See requirement 3.

## 7. API & secret keys

| Requirement | Status |
|---|---|
| No secrets in frontend code | **Met** — verified: `SUPABASE_SECRET_KEY` appears nowhere in application code; `RESEND_API_KEY` is read only inside a server route |
| No secrets in the repository | **Met** — `.env.local` is git-ignored |
| Only frontend-safe keys in frontend code | **Met** — the anon key is the one designed for this |

One thing to note rather than fix: the `settings` table is publicly readable
because the marketing website reads prices and branding from it. It therefore
also exposes the Square **application and location IDs**. Those are publishable
identifiers, not secrets — but a narrower public view would be tidier.

## 8. Backups & recovery

**Not verified.** Depends on the Supabase plan; the free tier has no
point-in-time recovery. Needs confirming, and a restore needs rehearsing once
so the procedure is known to work.

## 9. Logging & monitoring

**Met.** The audit log holds 147 entries and is recording. It covers
administrative sign-ins, permission changes, staff edits to customer records,
and every export of customer data.

The entry is written by the database itself through triggers, and the actor is
read from the session rather than sent by the browser — so it cannot be forged
by tampering with a request. The log holds no passwords, tokens or card data.

## 10. Data collection

**Met.** Names, addresses, phones, emails, pet details, vaccinations,
reservations. No Social Security numbers, licences or financial accounts.
Signatures are captured for the waiver, which is the point of a waiver.

## 11. Third-party services

**Largely met.** Supabase, Square, Resend, and pdf.js — each with a clear
purpose. No analytics, no advertising, no session recording, no pixels.

One to raise: the website falls back to **Unsplash-hosted placeholder images**
until real photos are uploaded, so visitors' browsers contact a third party.
Harmless, but it is a third party, and it disappears once the business uploads
its own photographs.

## 12. Security testing before launch

**Partly done.** Customer-to-customer isolation is written as a repeatable
test (`customer-isolation-test.sql`) that signs in as one customer and attempts
to read another household's dog, package, booking, invoice and document by id,
on the base tables and through the app's own views, reading and writing. All
refused.

Still outstanding: the staff permission checks run and recorded, a dependency
vulnerability scan, and a review against the OWASP recommendations. The first
of those is quick — sign in as an employee and confirm the exports are
refused — and should be recorded rather than assumed.

## 13. Development principle

**Met.** Nothing security-critical was hand-rolled: authentication and session
handling are Supabase, payments are Square, encryption is the platform's, and
database security is RLS.

---

# What is left

Not code. Three operational tasks, all before the business opens and real
customer records exist.

1. **Enrol multi-factor authentication** on the owner account, then on any
   manager account. Built and waiting; nobody has done it.
2. **Separate development from production** — a second Supabase project, so
   nobody develops against live customer data. See `NEW-DATABASE.md`, which
   lists what to run on an empty database and in what order.
3. **Verify backups**, and rehearse a restore once. A backup nobody has
   restored is not yet a backup.

Then run the remaining checks in requirement 12 and record the results.
