# Documentation rebuild — 8 PDFs

Four subjects, each in a short sales edition and a long reference edition.
Written down because the build is a long job and should start from a plan
rather than from memory.

## The toolchain (survives from an earlier session)

```
/private/tmp/claude-501/-Users-cesar-Downloads-dog-daycare-kiosk-1/
  c3eac45e-3d6b-435f-a685-12c9e2d4a1a1/scratchpad/
    shotapp/            a copy of the app wired to fixture data
    fixture-supabase.ts a real query engine over fixtures (eq/in/ilike/order/limit)
    patch_shotapp.py    re-applies the fixture wiring after a re-copy
    shooter/shoot.mjs   Chrome DevTools Protocol screenshot harness
    docs/*.py           one builder per document, plus build_docs.py
```

**First step every time: re-copy the app into `shotapp` and re-run
`patch_shotapp.py`.** The fixture app is a snapshot, and it currently predates
everything below.

## What changed since the last build

Screens that must be re-shot, because the existing PDFs show the old design:

- **Calendar** — stays are continuous bars, not one pill per day. Density
  control, month totals, month-scoped lists that the view pills filter, and
  the lists are collapsible.
- **Packages** — grouped by household, meter rows, corrections behind the
  row expansion, search by name, age and staleness.
- **Settings → Reports** — the Money owed section now carries package
  revenue and unredeemed value.
- **Settings → Content** — the whole website-copy editor. Did not exist.
- **Settings → Reviews** — the manual reviews editor. Did not exist.
- **Requests** — the review checklist (blockers and warnings) on an
  enrollment.
- **In-house** — per-dog staff notes, meals, and prices coloured by whether
  they have actually been paid.
- **Walk log** — restyled dropdowns; every select in the app now has a
  custom control rather than the browser's.
- **Website** — header and footer now honour an uploaded logo.

## Avoiding overlap between the short and long editions

The failure mode is the long one reading as the short one with padding. The
split is by **question**, not by depth:

- **Short (10–12pp)** answers *should I buy this?* Outcomes, before/after,
  what a day looks like. Screenshots are hero-sized, one per spread. No
  configuration, no schema, no troubleshooting.
- **Long (30–50pp)** answers *how does this work and how do I run it?*
  Every field, every setting, every edge case. Screenshots are inline and
  annotated.

A sentence should not appear in both. Where the long edition needs to set up
context the short one also covers, it cross-references rather than repeats.

## The eight documents

### 1. Product overview
**Short** — the problem, the four services, kiosk sign-in, the calendar,
what the owner sees, pricing and packages, reviews and website, one page on
what it replaces.
**Long** — adds every screen in the staff app, the full enrollment and
boarding request flow, meet & greets, walk logs, meals and notes, reports and
exports, payments and balances, the marketing site and how it is edited.

### 2. Technical deep-dive
**Short** — architecture on a page, the data model, why Supabase and RLS,
what runs where, the cost model.
**Long** — every table and column, the RLS policy set and why each grant
exists, pricing and package maths (including the four-hour rule, opt-out
precedence, and how a package sale is billed exactly once), the balance and
oldest-first payment allocation, the calendar lane-packing algorithm, the
settings and content merge strategy, and the test suites.

### 3. Setup and deployment
**Short** — what you need, the five steps, first-run checklist.
**Long** — where the project comes from (repository vs folder, both spelled
out), environment variables, every migration in the order it must run,
creating staff accounts, running the RLS lockdown, Square setup including the
web callback registration, email via Resend, custom domain, backups, and a
troubleshooting section keyed to the real error messages.

### 4. Staff guide
**Short** — the daily loop: sign a dog in, sign it out, take payment. One
page each, large screenshots.
**Long** — every task including boarding, walks, meals, notes, meet & greet
verdicts, package corrections, requests review, refunds and balance
corrections, printing, and what to do when something looks wrong.

## Requirements for every document

- Buki (415) 483-6511 as the worked example; she has a photo.
- Every fixture dog has a real photo, not an emoji.
- Screenshots in both light and dark theme across the set.
- Dog profile screenshots must include the photo and the vaccination records.
- No overlapping page content — check every page break.
- Spell-check pass over the generated HTML before rendering, and a read-back
  of the rendered PDF text layer to catch anything the builder mangled.

## Build order

1. Re-copy app to `shotapp`, run `patch_shotapp.py`, start it.
2. Re-shoot every screen listed above, both themes.
3. Update the four builders; add a `-short` and `-long` variant to each.
4. Render, then extract the text layer of each PDF and spell-check it.
5. Check page breaks on every document before shipping.
