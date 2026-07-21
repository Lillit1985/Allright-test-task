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
src/config.ts            all the guessed patterns (CTA text, API URL regexes,
                          success URLs, admin API paths) — isolated here so a
                          new A/B variant or renamed endpoint is a one-line edit
src/outcomeCapture.ts    network-level capture of the two business facts
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

Artifacts (screenshot, captured API events, trace/video on failure) land in
`playwright-report/` and `test-results/`.

### Admin API token (optional but recommended)

The test verifies the outcome in two independent, layered ways:

1. **Network capture** (always on) — did the browser see successful
   account-creation and trial-booking API responses.
2. **Admin API lookup** (on if `ADMIN_BEARER_TOKEN` is set) — does the
   *system of record* actually have that user and that booking. This is a
   stronger signal: it catches cases where the browser saw a "successful"
   response that didn't actually persist, or where a retried request
   half-succeeded.

To enable it: open the admin panel, do any action, grab the token from the
`Authorization: Bearer …` header of a request in the Network tab, and put it
in `.env` as `ADMIN_BEARER_TOKEN`. Without it, the admin-API assertions are
skipped (not failed) and you still get signal 1.

The same token drives **cleanup**: after each run, the test looks up the
account it just created (by its tagged email) via the admin API and deletes
it, so canary/scheduled runs don't pile up accounts on stage. Cleanup is
best-effort and never fails the test itself — a failed cleanup is logged
as a warning so it can be handled manually if it keeps happening.

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
  so backend/analytics can filter it out, and so the admin-API cleanup step
  can find exactly the account this run created.
- **Admin API paths in `src/config.ts` (`adminApi.*`) are guesses** —
  `GET /admin/api/users?email=…`, `GET /admin/api/users/{id}/bookings`,
  `DELETE /admin/api/users/{id}` — based on typical admin-panel REST
  conventions, not confirmed against the real admin API. First real run
  will likely need these adjusted; the response-shape parsing in
  `adminApiClient.ts` tries to handle both a bare object and a
  `{ items: [...] }` list shape, but that's also a guess.
- Assumed deleting the user via admin API is enough cleanup, i.e. that
  deleting the user cascades to their booking. If bookings need to be
  deleted separately, `deleteTestUser` needs a sibling call before it.
- Assumed the admin API and the app share the same host
  (`stage.allright.com`); overridable via `ADMIN_API_BASE_URL` if not.

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
- Confirm the real admin API paths/response shape and adjust
  `src/config.ts` + `src/adminApiClient.ts` accordingly (currently guessed).
- Store `ADMIN_BEARER_TOKEN` as a CI secret rather than a local `.env` once
  this moves into the scheduled pipeline described in STRATEGY.md, and add
  token-expiry handling (clear failure message, not a silent skip) since
  scheduled runs won't have a human around to notice a stale token.
- Add one or two narrowly-scoped, genuinely deterministic UI checks for
  screens the team confirms are *not* under active A/B testing (if any),
  as a complement — not a replacement — for the outcome-level check.

## Open questions for the team (would send before starting, per the task)

1. What are the actual endpoint paths/methods for account creation and trial
   booking, and do they return the entities' ids in the response body?
2. Is there a way to purge or exclude `qa-automation+*` tagged accounts and
   bookings from analytics/reporting? (Cleanup via admin API is wired up,
   but confirming the real endpoint shapes would help — see Assumptions.)
   Also: does deleting a user via the admin API cascade to their bookings,
   or is a separate call needed?
3. Do trial bookings on stage consume real teacher availability, or is
   scheduling mocked there?
4. Is there an existing list/flag of currently-live A/B variants on this
   quiz, so CTA/success patterns can be validated against all of them up
   front rather than discovered by trial and error?
