/**
 * Confirmed-vs-guessed status of everything below (as of the latest team
 * answers):
 *   CONFIRMED — the API is JSON:API-style (`/api/v1/...`, kebab-case
 *     attributes, `{"data":{"type":"...","id":"...","attributes":{...}}}`),
 *     both account-creation and trial-booking responses return the created
 *     entity's id, deletion is a soft-delete via PATCH that cascades to
 *     cancel future lessons, and test accounts are auto-excluded from
 *     analytics by having "test"/"тест" in the name.
 *   STILL GUESSED — the exact path segments for account-creation and
 *     trial-booking calls, and the admin "find user by email" path. These
 *     are visible in the Network tab during a real quiz run; that's the
 *     next concrete step (see README).
 * Keeping all of it here, isolated from driver/test logic, means updating
 * a path or adding a new A/B variant's CTA text is a one-line edit.
 */

export const config = {
  /**
   * CTA text patterns the driver treats as "move forward". Deliberately
   * multilingual and loose — matching intent, not exact copy, since exact
   * copy is exactly what A/B testing changes.
   */
  ctaPatterns: [
    /продовжити/i,
    /далі/i,
    /наступн/i,
    /забронювати/i,
    /завершити/i,
    /продолжить/i,
    /далее/i,
    /забронировать/i,
    /continue/i,
    /next/i,
    /book/i,
    /finish/i,
    /submit/i,
    /get started/i,
  ],

  /** Buttons/links the driver must never click, even if text matches a CTA pattern. */
  forbiddenActionPatterns: [/pay/i, /оплат/i, /checkout/i, /subscribe/i, /card/i],

  /** URL the app navigates to once the quiz is fully done (guess — confirm with team). */
  successUrlPatterns: [/\/sign-up\/(success|complete|thank-you)/i, /\/app\/dashboard/i, /\/app\/lesson/i],

  /**
   * API calls that represent the two business facts we actually care about.
   * JSON:API response shape confirmed (both return the created entity's id);
   * exact path segments still need a look at the Network tab during one
   * real quiz run — grep for "sign-up"/"users" and "lesson"/"booking".
   */
  apiEvents: {
    accountCreated: {
      name: "account-created",
      urlPattern: /\/api\/.*(sign-?up|register|users)(?!.*(lesson|booking))/i,
      methods: ["POST", "PUT"],
    },
    trialBooked: {
      name: "trial-booked",
      urlPattern: /\/api\/.*(booking|trial|lesson)/i,
      methods: ["POST", "PUT"],
    },
  },

  /** Safety limits for the generic forward-walker. */
  driver: {
    maxSteps: 25,
    maxTotalMs: 90_000,
    perStepTimeoutMs: 8_000,
  },

  /**
   * Response header/cookie names that might carry the assigned experiment
   * variant. Purely diagnostic — never used to branch test behavior (the
   * whole point of this suite is not needing to know the variant), only to
   * tag failures so "which variant broke" is answerable from the report
   * instead of a re-run-and-guess exercise. Confirm real names with the
   * team; harmless (just won't capture anything) if wrong.
   */
  experimentDiagnostics: {
    cookieNamePatterns: [/experiment/i, /variant/i, /^ab[-_]/i],
    headerNamePatterns: [/x-experiment/i, /x-variant/i],
  },

  /**
   * Test-data conventions. Confirmed with the team: accounts with
   * "test"/"тест" in the NAME are auto-excluded from analytics — so the
   * driver's generic name-field fill (see quizDriver.ts) uses this value,
   * not an arbitrary string. Email is also tagged for a belt-and-suspenders
   * filter and so cleanup can find the right account.
   */
  testUser: {
    name: "Test QA Automation",
    emailFor: (runId: string) => `test-automation+${runId}@example-testing.invalid`,
  },

  /**
   * Admin API. Deletion mechanism CONFIRMED (soft-delete, JSON:API PATCH,
   * cascades to cancel future lessons — so no separate lesson cleanup is
   * needed). Lookup path is still a guess, written in the same JSON:API
   * filter convention as the confirmed delete call.
   */
  adminApi: {
    baseUrl: process.env.ADMIN_API_BASE_URL ?? "https://stage.allright.com",
    bearerTokenEnvVar: "ADMIN_BEARER_TOKEN",
    // GUESS, in JSON:API filter convention — confirm exact path with the team.
    findUserByEmailPath: (email: string) =>
      `/api/v1/users?filter[email]=${encodeURIComponent(email)}`,
    // GUESS — confirm relationship path (could be /lessons instead of /bookings).
    findBookingsForUserPath: (userId: string) => `/api/v1/users/${userId}/lessons`,
    // CONFIRMED by the team, verbatim.
    deleteUserPath: (userId: string) =>
      `/api/v1/users/${userId}/?fields[user]=is_deleted,deletion_reason`,
  },
};
