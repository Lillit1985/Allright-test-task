import { test, expect, APIRequestContext } from "@playwright/test";
import {
  captureOutcomeEvents,
  captureExperimentDiagnostics,
  entityIdFor,
  extractExperiments,
  hasConfirmedEvent,
} from "../src/outcomeCapture";
import { walkQuizToCompletion } from "../src/quizDriver";
import { config } from "../src/config";
import {
  createAdminApiContext,
  deleteTestUser,
  findBookingsForUser,
  findUserByEmail,
} from "../src/adminApiClient";

/**
 * Variant 1: robust business-outcome check.
 *
 * What this test asserts, deliberately, is ONLY:
 *   1. an account was created (real email present, with an id), and
 *   2. a qualified trial-lesson request was submitted for that account
 *      (schedule "wishes" present on the same user resource).
 *
 * Point 2 is a deliberate, confirmed reinterpretation of "trial lesson
 * booked": for this funnel, the final screen states an administrator will
 * pick a teacher and offer a time afterward — there's no synchronous
 * booking-with-a-real-teacher happening inside the quiz itself. See
 * STRATEGY.md and README for the open question this raises for the team.
 *
 * It never asserts on step count, step order, specific screen copy, or
 * which A/B variant was served — the active experiment variant is captured
 * only as a diagnostic annotation, so a failure can be correlated with a
 * specific variant without the test ever branching on it. See STRATEGY.md.
 *
 * Verification is layered, in order of trust:
 *   - network capture (what the browser actually sent/received) — always available
 *   - admin API lookup (what the system of record actually has) — skipped
 *     gracefully if ADMIN_BEARER_TOKEN isn't set
 *
 * Side effects: this creates a real account and submits a real trial-lesson
 * request on stage (a human admin may act on it later — worth flagging to
 * the team so QA-tagged requests aren't picked up as if from a real lead).
 * The email/name are tagged so the account is auto-excluded from analytics
 * and can be found for cleanup in afterEach.
 */

let adminCtx: APIRequestContext | undefined;
let createdTestEmail: string | undefined;

test.afterEach(async () => {
  // Best-effort cleanup regardless of pass/fail — a failing assertion
  // doesn't mean the account wasn't actually created. Soft-delete cascades
  // to cancel future lessons (confirmed), so one call is enough.
  if (!adminCtx || !createdTestEmail) return;

  const user = await findUserByEmail(adminCtx, createdTestEmail);
  if (user) {
    await deleteTestUser(adminCtx, user.id);
  }
  await adminCtx.dispose();
  adminCtx = undefined;
  createdTestEmail = undefined;
});

test("completing the Charlie sign-up quiz creates an account and books a trial lesson", async ({
  page,
}, testInfo) => {
  const runId = `${Date.now()}-${testInfo.workerIndex}`;
  const testEmail = config.testUser.emailFor(runId);
  createdTestEmail = testEmail;
  test.info().annotations.push({ type: "test-user-email", description: testEmail });

  const capturedEvents = captureOutcomeEvents(page);
  const experimentDiagnostics = await captureExperimentDiagnostics(page);

  await page.goto("/uk/app/sign-up/long/charlie/age-range");

  const result = await walkQuizToCompletion(page, capturedEvents, testEmail);

  // Confirmed mechanism: the assigned variant(s) live right in the user
  // resource's response body — pull them out now that we have the events.
  experimentDiagnostics.fromResponseBody = extractExperiments(capturedEvents);

  await testInfo.attach("captured-api-events.json", {
    body: JSON.stringify(result.capturedEvents, null, 2),
    contentType: "application/json",
  });
  await testInfo.attach("experiment-diagnostics.json", {
    body: JSON.stringify(experimentDiagnostics, null, 2),
    contentType: "application/json",
  });
  await testInfo.attach("final-screenshot.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  expect(
    result.reachedSuccess,
    `Quiz did not reach a success state after ${result.stepsTaken} steps. ` +
      `Final URL: ${result.finalUrl}. Experiment context: ${JSON.stringify(experimentDiagnostics)}. ` +
      `This likely means either the driver hit an unrecognized screen (new A/B variant / ` +
      `new input type) or the flow is genuinely broken — check the attached screenshot and events.`
  ).toBe(true);

  // --- Signal 1: network capture ---
  // "account-created" is confirmed to be the user resource carrying a real
  // email, not a specific URL — see config.ts. hasConfirmedEvent checks the
  // content, not just a 2xx status.
  expect(
    hasConfirmedEvent(capturedEvents, "account-created"),
    "Expected a user PATCH/POST response with a real email set, got: " +
      JSON.stringify(capturedEvents.filter((e) => e.name === "account-created"))
  ).toBe(true);

  expect(
    hasConfirmedEvent(capturedEvents, "trial-booked"),
    "Expected a user PATCH response with schedule wishes set (lesson-date-wishes / " +
      "tutor-id-wishes / permanent-schedule), got: " +
      JSON.stringify(capturedEvents.filter((e) => e.name === "trial-booked"))
  ).toBe(true);

  // Both are confirmed/expected to return the entity's id — assert on that
  // rather than just the status code, since a 2xx with no id would indicate
  // the response shape changed under us.
  const createdUserId = entityIdFor(capturedEvents, "account-created");
  expect(createdUserId, "account-created response had no extractable id").not.toBeNull();

  const createdBookingId = entityIdFor(capturedEvents, "trial-booked");
  expect(createdBookingId, "trial-booked response had no extractable id").not.toBeNull();

  // --- Signal 2: admin API (system of record), only if a token is configured ---
  const hasAdminToken = Boolean(process.env[config.adminApi.bearerTokenEnvVar]);
  test.skip(!hasAdminToken, `Set ${config.adminApi.bearerTokenEnvVar} to enable admin-API verification.`);

  adminCtx = await createAdminApiContext();

  const adminUser = await findUserByEmail(adminCtx, testEmail);
  expect(
    adminUser,
    `Admin API has no user for ${testEmail}. The quiz reported success and the browser ` +
      `saw a successful API response, but the system of record disagrees — this is exactly ` +
      `the kind of discrepancy this check exists to catch.`
  ).not.toBeNull();

  if (adminUser) {
    const bookings = await findBookingsForUser(adminCtx, adminUser.id);
    expect(
      bookings.length,
      `Admin API shows user ${adminUser.id} exists but has no lessons/requests — ` +
        `account creation succeeded, the schedule request did not actually persist. ` +
        `Note: for this funnel a "lesson" may not exist yet if an admin hasn't finalized ` +
        `it — confirm with the team what the admin API actually returns for a pending request.`
    ).toBeGreaterThan(0);
  }
});
