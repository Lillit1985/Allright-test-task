import { test, expect } from "@playwright/test";
import { captureOutcomeEvents, hasSuccessfulEvent } from "../src/outcomeCapture";
import { walkQuizToCompletion } from "../src/quizDriver";
import { config } from "../src/config";

/**
 * Variant 1: robust business-outcome check.
 *
 * What this test asserts, deliberately, is ONLY:
 *   1. an account was created (successful API response), and
 *   2. a trial lesson was booked for that account (successful API response).
 *
 * It never asserts on step count, step order, specific screen copy, or
 * which A/B variant was served. See STRATEGY.md for the reasoning.
 *
 * Side effects: this creates a real account and a real booking on the
 * target stage environment. The email is tagged so it can be filtered out
 * of analytics and cleaned up — see README "Assumptions / cleanup".
 */
test("completing the Charlie sign-up quiz creates an account and books a trial lesson", async ({
  page,
}, testInfo) => {
  const runId = `${Date.now()}-${testInfo.workerIndex}`;
  const testEmail = config.testUser.emailFor(runId);
  test.info().annotations.push({ type: "test-user-email", description: testEmail });

  const capturedEvents = captureOutcomeEvents(page);

  await page.goto("/uk/app/sign-up/long/charlie/age-range");

  const result = await walkQuizToCompletion(page, capturedEvents);

  // Attach diagnostics regardless of outcome — cheap, and this is exactly
  // what you want when an A/B variant introduces an unrecognized screen.
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
});
