# Charlie sign-up quiz — outcome verification (Variant 1)

Written approach: see [`STRATEGY.md`](./STRATEGY.md) (Part A).

This repo implements **Variant 1**: an AB/step-agnostic check that the quiz's
business outcome actually happens — an account gets created and a trial
lesson gets booked — regardless of which A/B variant or step sequence the
run happened to hit.

## What it does, in one sentence

It never looks at quiz step text or count. It walks the quiz forward using
generic "find a plausible next action" heuristics, and asserts success purely
from two things: the final URL/network state, and — primarily — whether the
two business-critical API calls (account creation, trial booking) came back
with a success status.

## Structure

```
src/config.ts          all the guessed patterns (CTA text, API URL regexes,
                        success URLs) — isolated here so a new A/B variant
                        or renamed endpoint is a one-line edit
src/outcomeCapture.ts  network-level capture of the two business facts
src/quizDriver.ts      generic forward-walker (no per-step knowledge)
src/types.ts           shared types
tests/quiz-signup-outcome.spec.ts   the actual test
```

## How to run

```bash
npm install
npx playwright install chromium
QUIZ_BASE_URL=https://stage.allright.com npm test
```

Artifacts (screenshot, captured API events, trace/video on failure) land in
`playwright-report/` and `test-results/`.

## Assumptions I made (no access to the real stage env / API docs)

- **API URL patterns and success-URL patterns in `src/config.ts` are guesses**,
  based on the public help-center description of the flow (quiz → child info
  → teacher/time selection → "Book a lesson" → confirmation), not on the real
  network calls. Before this runs for real, these need five minutes with
  someone from the team, watching one real run in DevTools' Network tab.
- Assumed the account-creation and trial-booking calls are two **separate**
  API calls. If they're actually one combined call, `config.apiEvents`
  collapses to one entry — the driver/test logic doesn't change.
- Assumed input types in the quiz are limited to radio/checkbox/text/select.
  If there's something more exotic (date picker, slider, drag-and-drop), the
  generic `answerVisibleInputsGenerically` needs a branch for it — isolated
  to that one function.
- Assumed the environment doesn't require auth/captcha before the quiz start
  URL given in the task.
- Tagged the test account's email as `qa-automation+<timestamp>-<worker>@…`
  so backend/analytics can filter it out. **No cleanup endpoint assumed to
  exist** — if one does, add a `test.afterEach` that calls it; if not, this
  needs a scheduled cleanup job on the backend side, which is worth raising
  with the team explicitly (real bookings consume real teacher time-slots on
  stage).

## What I'd do with more time

- Get the real API contract and tighten `apiEvents` patterns + add response
  schema validation (zod) on the two payloads (user id present, booking id +
  future timestamp present) instead of just checking status code.
- Add a small **Variant 2 layer on top of this**, not instead of it: when the
  generic driver hits `clickForwardCta` returning `false` (unrecognized
  screen), fall back to an LLM call with the page's accessibility tree and
  the goal "get one step closer to finishing sign-up", so a genuinely novel
  A/B variant degrades gracefully into "slower" instead of "red build every
  time marketing ships something new."
- Add the scheduled-run CI wiring described in STRATEGY.md (cron trigger +
  path-filtered PR trigger + post-deploy smoke), with Slack alerting on the
  second consecutive failure only.
- Add a cleanup job / confirm a delete endpoint so canary runs don't
  accumulate stage data indefinitely.
- Add one or two narrowly-scoped, genuinely deterministic UI checks for
  screens the team confirms are *not* under active A/B testing (if any),
  as a complement — not a replacement — for the outcome-level check.

## Open questions for the team (would send before starting, per the task)

1. What are the actual endpoint paths/methods for account creation and trial
   booking, and do they return the entities' ids in the response body?
2. Is there a way to purge or exclude `qa-automation+*` tagged accounts and
   bookings from analytics/reporting, or a delete endpoint to clean up after
   test runs?
3. Do trial bookings on stage consume real teacher availability, or is
   scheduling mocked there?
4. Is there an existing list/flag of currently-live A/B variants on this
   quiz, so CTA/success patterns can be validated against all of them up
   front rather than discovered by trial and error?
