# Charlie sign-up quiz — outcome verification (Variant 1)

Written approach: see [`STRATEGY.md`](./STRATEGY.md) (Part A).

This repo implements **Variant 1**: an AB/step-agnostic check that the quiz's
business outcome actually happens — an account gets created and a trial
lesson gets booked — regardless of which A/B variant or step sequence the
run happened to hit.

## What it does, in one sentence

It never looks at quiz step text or count. It walks the quiz forward using
generic "find a plausible next action" heuristics, and verifies success from
three layered signals: network-captured API responses (with their returned
entity ids), the final URL, and — if a token is available — an independent
admin API lookup against the system of record.

## Structure

```
src/config.ts            all patterns (CTA text, API URL regexes, success
                          URLs, admin API paths, test-data conventions) —
                          isolated here so a new A/B variant or a renamed
                          endpoint is a one-line edit. Comments mark what's
                          confirmed vs still guessed.
src/outcomeCapture.ts    network-level capture of the two business facts,
                          entity-id extraction, experiment diagnostics
src/quizDriver.ts        generic forward-walker (no per-step knowledge)
src/adminApiClient.ts    admin API: independent verification + cleanup
src/types.ts             shared types
tests/quiz-signup-outcome.spec.ts   the actual test
```

## How to run

```bash
npm install
npx playwright install chromium
cp .env.example .env   # fill in ADMIN_BEARER_TOKEN (see below), then:
npm test
```

Artifacts (screenshot, captured API events, experiment diagnostics,
trace/video on failure) land in `playwright-report/` and `test-results/`.

### Admin API token (optional but recommended)

The test verifies the outcome in two independent, layered ways:

1. **Network capture** (always on) — did the browser see successful
   account-creation and trial-booking API responses, and do they contain the
   created entity's id (both are confirmed to return one).
2. **Admin API lookup** (on if `ADMIN_BEARER_TOKEN` is set) — does the
   *system of record* actually have that user and that lesson booking.

To enable it: open the admin panel, grab the token from the
`Authorization: Bearer …` header of any request in the Network tab, and put
it in `.env` as `ADMIN_BEARER_TOKEN`. Without it, the admin-API assertions
are skipped (not failed) and you still get signal 1.

The same token drives **cleanup**: after each run, `afterEach` looks up the
account by its tagged email and soft-deletes it via
`PATCH /api/v1/users/:id/?fields[user]=is_deleted,deletion_reason`
(confirmed with the team — this cascades to cancel the account's future
lessons, so no separate lesson-cancellation call is needed). Cleanup is
best-effort and never fails the test itself; a failed cleanup is logged as a
warning.

**Note:** stage bookings are real, not mocked — they consume actual teacher
availability from a shared, limited stage pool. See STRATEGY.md for why I'd
keep scheduled-run frequency conservative because of this.

## Confirmed vs. still-guessed (from the team's answers)

**Confirmed:**
- The API is JSON:API-style (`/api/v1/...`, kebab-case attributes,
  `{"data":{"type":"...","id":"...","attributes":{...}}}`).
- Both account-creation and trial-booking responses return the created
  entity's id — `entityIdFor()` in `outcomeCapture.ts` extracts it, and the
  test asserts on its presence, not just the status code.
- Accounts with `test`/`тест` in the **name** are auto-excluded from
  analytics — the driver's generic text-fill uses `config.testUser.name`
  (`"Test QA Automation"`) for exactly this reason, not an arbitrary string.
- Deletion is `PATCH /api/v1/users/:id/?fields[user]=is_deleted,deletion_reason`
  with a JSON:API body setting `is-deleted: true`, and cascades to cancel
  future lessons. Implemented verbatim in `deleteTestUser()`.
- Scheduling on stage is **not** mocked — real teacher matching against a
  shared, limited pool. Bookings can accumulate if runs are too frequent.
- A/B variants are assigned per-user via an experiments mechanism; which
  variant a given run got is left to my design (see below and STRATEGY.md).

**Still guessed** (need one real quiz run in DevTools' Network tab to nail
down — the team confirmed these paths are visible there):
- Exact path segments for the account-creation and trial-booking calls
  (`config.apiEvents.*.urlPattern` — currently a loose regex matching
  `sign-up`/`register`/`users` and `booking`/`trial`/`lesson`).
- The admin "find user by email" path (`config.adminApi.findUserByEmailPath`
  — guessed in the same JSON:API filter convention as the confirmed delete
  call, but not verified).
- The relationship path for a user's lessons/bookings
  (`config.adminApi.findBookingsForUserPath`).

## How the experiment/variant question is handled

The team left "how to identify which variant a run got, and how to make the
design resilient to variant changes" to my design. The resilience part is
the whole point of Variant 1 — the test never needs to know the variant,
because it only checks the outcome. For the "which variant did this run
get" part (useful for debugging a failure, not for the test's own logic),
`captureExperimentDiagnostics()` records any cookie or response header whose
*name* looks experiment-related and attaches it to the test report. It's
purely diagnostic and never gates an assertion — if the team confirms the
real cookie/header name, that's a one-line change in
`config.experimentDiagnostics`.

## What I'd do with more time

- Nail down the three still-guessed paths above from one real DevTools run,
  and add zod schema validation on the two response payloads (not just "has
  an id", but the expected shape of the account/booking objects).
- Add a small **Variant 2 layer on top of this**, not instead of it: when the
  generic driver hits `clickForwardCta` returning `false` (unrecognized
  screen), fall back to an LLM call with the page's accessibility tree and
  the goal "get one step closer to finishing sign-up", so a genuinely novel
  A/B variant degrades gracefully into "slower" instead of "red build every
  time marketing ships something new."
- Add the scheduled-run CI wiring described in STRATEGY.md, tuned to a
  conservative frequency given the shared/limited stage teacher pool, with
  Slack alerting on the second consecutive failure only.
- Store `ADMIN_BEARER_TOKEN` as a CI secret rather than a local `.env` once
  this moves into the scheduled pipeline, and add explicit token-expiry
  handling (clear failure message, not a silent skip) since scheduled runs
  won't have a human around to notice a stale token.
- Raise with the team whether a dedicated, isolated pool of test teachers
  could be set up for automated runs, separate from the pool used by real
  stage/QA traffic.
