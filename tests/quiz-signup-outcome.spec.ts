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

let adminCtx: APIRequestContext | undefined;
let createdTestEmail: string | undefined;

test.afterEach(async () => {
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
  const createdUserId = entityIdFor(capturedEvents, "account-created");
  expect(createdUserId, "account-created response had no extractable id").not.toBeNull();

  const createdBookingId = entityIdFor(capturedEvents, "trial-booked");
  expect(createdBookingId, "trial-booked response had no extractable id").not.toBeNull();

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
