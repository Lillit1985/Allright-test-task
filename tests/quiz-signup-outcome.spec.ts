import { test, expect, APIRequestContext } from "@playwright/test";
import { captureOutcomeEvents, hasSuccessfulEvent } from "../src/outcomeCapture";
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
 *   1. an account was created, and
 *   2. a trial lesson was booked for that account.
 *
 * It never asserts on step count, step order, specific screen copy, or
 * which A/B variant was served. See STRATEGY.md for the reasoning.
 *
 * Verification is layered, in order of trust:
 *   - network capture (what the browser actually sent/received) — always available
 *   - admin API lookup (what the system of record actually has) — skipped
 *     gracefully if ADMIN_BEARER_TOKEN isn't set, so the suite still runs
 *     without admin access, just with one less independent signal
 *
 * Side effects: this creates a real account and a real booking on the
 * target stage environment. The email is tagged so it can be filtered out
 * of analytics, and cleaned up via the admin API in afterEach — see README.
 */

let adminCtx: APIRequestContext | undefined;
let createdTestEmail: string | undefined;

test.afterEach(async () => {
  // Best-effort cleanup regardless of pass/fail — a failing assertion
  // doesn't mean the account wasn't actually created.
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

  await page.goto("/uk/app/sign-up/long/charlie/age-range");

  const result = await walkQuizToCompletion(page, capturedEvents);

  await testInfo.attach("captured-api-events.json", {
    body: JSON.stringify(result.capturedEvents, null, 2),
    contentType: "application/json",
  });
  await testInfo.attach("final-screenshot.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  expect(
    result.reachedSuccess,
    `Quiz did not reach a success state after ${result.stepsTaken} steps. ` +
      `Final URL: ${result.finalUrl}. This likely means either the driver hit an ` +
      `unrecognized screen (new A/B variant / new input type) or the flow is ` +
      `genuinely broken — check the attached screenshot and captured events.`
  ).toBe(true);

  // --- Signal 1: network capture ---
  expect(
    hasSuccessfulEvent(capturedEvents, "account-created"),
    "Expected a successful account-creation API response, got: " +
      JSON.stringify(capturedEvents.filter((e) => e.name === "account-created"))
  ).toBe(true);

  expect(
    hasSuccessfulEvent(capturedEvents, "trial-booked"),
    "Expected a successful trial-booking API response, got: " +
      JSON.stringify(capturedEvents.filter((e) => e.name === "trial-booked"))
  ).toBe(true);

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
      `Admin API shows user ${adminUser.id} exists but has no bookings — ` +
        `account creation succeeded, trial booking did not actually persist.`
    ).toBeGreaterThan(0);
  }
});
