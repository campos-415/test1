# What to get from the client before launch

Everything the app needs that only the business can answer, in the order it
is worth asking. Take this to the meeting; every field here has somewhere to
go in Settings, and nothing here needs a developer.

Budget one sitting of about an hour with the owner, plus whatever DNS takes.

---

## 1. Accounts — get these started first, they have waiting in them

| Account | Who creates it | Why | Blocks |
|---|---|---|---|
| **Supabase** | The client, ideally in their own name | Holds every record. It must outlive your involvement | Everything |
| **Vercel** (or other host) | Either | Serves the app | Launch |
| **Domain** | The client already has one, usually | Their web address | DNS can take hours — start day one |
| **Resend** | Either | Sends approvals, confirmations, invites | Emails, silently |
| **Square** | The client, if taking cards | Card payments at the desk | Payments only |

**The Supabase account should be in the client's name, not yours.** It is
their customer database. Put it in your own and you become a single point of
failure for a business that boards animals.

---

## 2. Business identity

All of it goes in Settings → Brand.

- Business name, and a tagline if they want one
- **Logo** as an image file — PNG or SVG with a transparent background
- Brand colour, as a hex code if their designer has one
- Phone, public email address
- Street, city, state, ZIP
- Instagram handle, if they have one
- Their domain

Ask for the logo early. It is the thing that always takes a week.

---

## 3. Prices — every one of these is a field

Nothing here has a sensible default. A wrong number bills a real client.

**Daycare**

- Full day
- Half day, and **how many hours counts as a half day** (the app decides by
  time on site, so this is a number of hours, not a judgement)

**Boarding**

- Per night
- Per night for a second dog from the same household
- Late pick-up: the hour it starts, and the fee

**Add-ons, daycare**

- Walk
- Nail trim
- Bath, at three sizes: small, medium, large

**Add-ons, boarding** (these are charged differently from daycare)

- Walk, per walk
- Medication, per day
- Nail trim

**Packages** — how many, and what each costs

- Daycare packages: days and price for each tier
- Walk packages: same

Ask whether they sell anything the list above does not cover. The add-on and
service lists are editable, so a new one is a Settings change, not a deploy.

---

## 4. Hours and the meet & greet

- Weekday hours
- Weekend hours
- Boarding hours, or "overnight, seven days"
- **Which days and times they will do meet & greets.** The app only offers
  weekday mornings out of the box; if they run them on Saturdays, say so now.

---

## 5. Words and pictures

Only if they are using the built-in website. If they already have one, turn
the website off in Settings and skip this whole section.

- Photos: the building, the play area, dogs at daycare. Real ones.
  **Until these are uploaded the site shows stock photography**, which is
  fine for a demo and wrong for a launch.
- Team: name, role, one line, and a photo per person
- Reviews: their real ones, copied across, or leave the section off.
  It ships empty on purpose — a business that has not opened has no reviews,
  and inventing them is a lie told to the people choosing where to leave
  their dog.
- Anything they want reworded. Every sentence on the public site is editable.

---

## 6. Who works there

For each person: **name, email address, and role.**

| Role | Can do |
|---|---|
| Owner / Admin | Everything, including permissions and deleting payment records |
| Manager | Money, reservations, packages, deletions, exports |
| Employee | Day-to-day care. No exports, no deletions, no settings |
| Lobby kiosk | Signs dogs in and out. Cannot read the owner list at all |

Notes worth raising with them:

- Addresses ending `@staff.local` are not real mailboxes. They work fine and
  display as just the name — good for a shared front-desk login.
- Staff are added in the app, under Settings → Security. Nobody needs the
  Supabase dashboard for this.
- The owner should enrol two-factor **before** real client records exist.
  Until they do, the database refuses exports and permission changes from
  that account.

Also: the names that appear in the walk-log dropdown, which can be first
names only.

---

## 7. Email

- The address emails should come from — on a domain they control
- The address replies should go to
- Whether they want to be notified when a request comes in, and at which
  address

The sending domain has to be verified with DNS records at their registrar.
**A key without a verified domain sends nothing, and says nothing about it.**

---

## 8. Payments, if they are taking cards

- Square application ID and location ID
- **The deployed URL registered as a web callback in the Square dashboard.**

That last one gets missed and cannot be done before the site is deployed.
Without it, Square refuses at the moment a client is standing there paying.

---

## 9. Decisions to put to them, not settings to collect

- **Client accounts on or off?** Off by default. A daycare that has not
  opened has no clients, and it can be switched on any time.
- **Built-in website, or back office only?**
- **Existing client list?** A new location starts empty, which is correct. An
  established one needs importing, and that is a separate project.

---

## Before handing over

Not the client's job — yours.

1. Sign in as an employee account and confirm the exports are refused. It is
   the only check that proves the roles are real rather than decorative.
2. Enrol two-factor on the owner account, then sign in again.
3. Run `customer-isolation-fixtures.sql`, then `customer-isolation-test.sql`,
   then delete the check households.
4. Submit the enrollment form as a client would, approve it, confirm the dog
   appears.
5. Sign a dog in and out at the kiosk; confirm the visit is priced.
6. Check the backup settings in Supabase and restore one once. A backup
   nobody has restored is not yet a backup.
7. Point development at a second Supabase project, so nobody develops against
   live customer records.

See `DEPLOY-NEW-CLIENT.md` for the deployment itself and `NEW-DATABASE.md`
for the database.
