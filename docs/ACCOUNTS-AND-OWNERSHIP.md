# Who owns what, and the order to set it up

A companion to `DEPLOY-NEW-CLIENT.md`, which covers *how* to deploy. This one
covers *whose account everything lands in*, because that is decided once, at
the start, and is painful to change afterwards.

## The principle

**Anything holding their data, their money or their reputation belongs to
them. You are a collaborator on it.**

Not because anything will go wrong, but because the alternative is a business
whose client records, card payments and sending domain all depend on one
person's personal accounts staying alive and staying friendly.

| Thing | Owner | You | Why |
|---|---|---|---|
| **Supabase** | Client | Collaborator | Vaccination records, waivers, payment history. Cannot be rebuilt. |
| **Vercel** | Client | Member | Holds the secret keys as environment variables |
| **Resend** | Client | Collaborator | Their sending domain and its reputation |
| **Square** | Client | — | Their merchant account. Never yours. |
| **Domain** | Client | — | Registered by them, always |
| **GitHub** | Shared org | Owner | Lowest stakes: the code can be rebuilt from `bootstrap.sh` |

The repo is the *least* valuable thing in this list. Source can be
reconstructed; three years of vaccination records cannot.

A GitHub **organisation** rather than either personal account: it is free, it
makes ownership unambiguous, the client can reach their own code without you,
and handover is a permissions change rather than a password handover.

---

## Phase 0 — start the things that have waiting in them

Do these first. Everything else is minutes; these are hours or days.

- [ ] Client registers the **domain**, or confirms who controls its DNS
- [ ] Client creates a **Resend** account and adds a sending subdomain
      (`mail.theirdomain.com`, not the root — see `CLIENT-INTAKE.md`)
- [ ] DNS records added. Verification can take up to 48 hours
- [ ] Client creates a **Supabase** project. Note the region: pick the one
      nearest the daycare, it cannot be changed later
- [ ] If they are taking cards: **Square** account, and the reader ordered

## Phase 1 — accounts the client creates

Send them `CLIENT-INTAKE.md` for the details that go *into* these. This list
is the accounts themselves.

- [ ] **GitHub** account, if they do not have one — needed to be added to the org
- [ ] **Vercel** account. Note the Hobby tier is non-commercial; a business
      running on it needs Pro. Confirm the current terms and price with Vercel
- [ ] Two-factor enrolled on every one of the above, by them
- [ ] Recovery codes saved somewhere that is not the laptop they are on

## Phase 2 — the repository

- [ ] Create a GitHub **organisation** for the client
- [ ] Add the client's GitHub account as an **owner**
- [ ] Run `bash bootstrap.sh` and let it create the repo, or create it in the
      org and point the script at it
- [ ] Confirm the history is **one commit**. Carrying another client's history
      carries their data, including whatever was committed and later deleted

## Phase 3 — the database

Full detail in `NEW-DATABASE.md`. This is the checklist form.

- [ ] `npm run setup` against **their** Supabase project
- [ ] All 18 SQL files reported ok, in order
- [ ] Owner account created, and they set their own password — not you
- [ ] Storage bucket created
- [ ] Run `customer-isolation-test.sql`. Every attempt in it must be refused
- [ ] Enrol the owner account in two-factor. Exports, deletions and permission
      changes are refused until this is done

## Phase 4 — deploy

- [ ] **Client** connects their Vercel account to the org repo
- [ ] They add you to the Vercel project as a member
- [ ] Environment variables set in Vercel, matching `.env.local`
- [ ] Domain pointed at the Vercel deployment
- [ ] Push to `main`, confirm it deploys

## Phase 5 — prove it before you call it done

Not "it loads" — actually walk it through.

- [ ] Submit an enrollment from the public form
- [ ] Confirm **both** emails arrive: the client acknowledgement and the staff
      notification. Check spam
- [ ] Send the acknowledgement to an address that is **not** the Resend
      account's own. That is the only test that proves the domain, because
      `onboarding@resend.dev` can only reach the account owner
- [ ] Approve it, and confirm the dog appears
- [ ] Sign that dog in and out at the kiosk, and check the price
- [ ] Open the day report and confirm the money is right
- [ ] Do all of the above on the actual front-desk device, not your laptop
- [ ] Restore a backup into a scratch project. An untested restore is not a
      backup

## Before you hand over

- [ ] Remove any test data you created
- [ ] Confirm they can sign in without you present
- [ ] Confirm they can reach the GitHub org, Supabase and Vercel themselves
- [ ] One line in the contract on who owns the code and what happens to it if
      the arrangement ends. Worth having someone who does contracts read it

---

## If you keep everything on your own accounts instead

It is the normal contractor model and it is not reckless, but be clear-eyed
about what you are accepting:

- If you are unreachable for a month, they cannot deploy, cannot hire anyone
  else, and cannot get at their own records
- One compromised or suspended account takes every client down at once
- "Who owns this" becomes a conversation you have when the relationship is
  already going badly, which is the worst time to have it

The org costs nothing and removes most of that. The Supabase project being
theirs removes the rest.
