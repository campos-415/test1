# End-to-end tests

A real browser, driving the real app, against a real database. They enrol a
household, approve it, check the dog in at the kiosk, retire it, and confirm
it can no longer check in — the spine of the whole product in one run.

## Before you run them

**Point `.env.local` at the sandbox, not at a client's project.** These tests
write: they approve enrollments, sign dogs in and retire dogs. Running them
against a daycare that is open would put fictional dogs on the day report and
retire one that is standing in the lobby.

The sandbox is the Supabase project on your own account. A client's project is
the one you create for them before they go live.

## Setting up, once

```bash
cp .env.e2e.example .env.e2e
```

Fill in four values: a staff account that can approve enrollments, and the
lobby iPad's kiosk account. `.env.e2e` is gitignored, and so is the `.auth/`
directory the signed-in sessions are cached in. Nothing writes either to a
report or a log.

Then install the browser, once per machine:

```bash
npx playwright install chromium
```

## Running them

Start the dev server and note the port it prints — it picks its own when 3000
is taken. Put that in `E2E_BASE_URL` in `.env.e2e`, or pass it inline:

```bash
E2E_BASE_URL=http://localhost:61936 npm run test:e2e
```

`npm run test:e2e:ui` opens Playwright's runner, which is the better way to
watch a failure: it shows the browser at each step with the DOM alongside.

Only the public specs run without credentials:

```bash
npx playwright test --project=public
```

## What they cover

| Spec | Needs a sign-in | What it proves |
| --- | --- | --- |
| `public.enrollment.spec.ts` | no | A stranger can enrol, and a half-filled form is refused |
| `staff.journey.spec.ts` | staff + kiosk | Enrol → approve → check in → retire → cannot check in |

The journey is deliberately one long test rather than four short ones. The
steps are not independent — there is no approving without an enrollment — and
four tests sharing that setup would either repeat the whole chain or leave
each other's data lying around.

## Why they are not part of `npm test`

`npm test` is the gate: typecheck, unit tests, policy tests. It runs offline,
needs no credentials and no server, and finishes in about twenty seconds, so
it can go in front of every commit.

These need a running server, a database and a password. They are worth running
before a deploy and after any change to the enrollment, kiosk or review
screens — not on every save.

## The data they leave behind

Each run creates a household on a unique `(555) …` number, so runs never
collide and nothing existing is touched. The rows stay afterwards, which is
the right trade in a sandbox: when a test fails, the half-finished household
is the evidence.

To clear them out:

```sql
delete from public.enrollments where phone like '(555)%';
delete from public.dogs where phone like '(555)%';
```

## When one fails

Playwright keeps a trace, a screenshot and a video for the failing test only.

```bash
npx playwright show-report
```

The trace is the useful one: it replays the run step by step with the DOM at
each point, which usually shows a selector that stopped matching because a
label changed rather than anything actually broken.

If a selector does need updating, prefer a `data-testid` over a class name —
`enrollment-card` in `components/EnrollmentQueue.tsx` is the pattern. Tying a
test to a Tailwind class ties it to the design rather than the behaviour.
