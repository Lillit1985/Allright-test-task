/**
 * Confirmed-vs-guessed status of everything below (as of the latest real
 * Network-tab capture):
 *   CONFIRMED — the API is JSON:API-style (`/api/v1/...`, kebab-case
 *     attributes, `Content-Type: application/vnd.api+json`,
 *     `{"data":{"type":"...","id":"...","attributes":{...}}}`). The user
 *     resource lives at `/api/v1/users/:id`. Deletion is a soft-delete PATCH
 *     that cascades to cancel future lessons. Test accounts are
 *     auto-excluded from analytics by having "test"/"тест" in the name.
 *   IMPORTANT DESIGN SHIFT — there is no single "sign-up" POST. The quiz
 *     creates the user record early (anonymous/lead), then PATCHes the same
 *     `/api/v1/users/:id` resource after nearly every step, accumulating
 *     `funnel-data` (goals, child info, schedule preferences, etc.). So
 *     "account created" can't be pinned to one specific call by URL alone —
 *     it's better verified by *content*: does the user resource carry a
 *     real email (the point at which a lead becomes a contactable account).
 *     `apiEvents.accountCreated.isValid` encodes exactly that, instead of
 *     relying on a URL pattern to mean something the API doesn't guarantee.
 *   STILL GUESSED — the exact call that books the trial lesson (not seen
 *     yet — the captures so far show fetching available-timeslots, not the
 *     confirmation step itself), and the admin "find user by email" path.
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
   */
  apiEvents: {
    accountCreated: {
      name: "account-created",
      // CONFIRMED path: the user resource is PATCHed repeatedly through the
      // quiz. Matching on the resource path, not a verb like "sign-up".
      urlPattern: /\/api\/v1\/users\/\d+/i,
      methods: ["POST", "PATCH", "PUT"],
      // The business fact isn't "this specific call happened" — it's "the
      // user resource now has a real email". Any of the many PATCH calls
      // through the quiz can be the one that first sets it.
      isValid: (body: unknown): boolean => {
        const attrs = (body as any)?.data?.attributes;
        const email = attrs?.email;
        return typeof email === "string" && email.includes("@");
      },
    },
    trialBooked: {
      name: "trial-booked",
      // GUESSED — not yet observed. The confirmed relationship name on the
      // user resource is "lessons" (see STRATEGY.md/README), so matching on
      // that plus common synonyms until the real confirmation-step call is
      // captured.
      urlPattern: /\/api\/v1\/.*(lessons?|trial|booking)/i,
      methods: ["POST", "PATCH", "PUT"],
    },
  },

  /**
   * Third-party hosts CONFIRMED (from a real Network-tab capture) to be
   * analytics/tracking noise — Intercom launcher/metrics/identify/ping
   * calls, GA4 collect calls, GTM. Belt-and-suspenders on top of the
   * `/api/` requirement already in apiEvents patterns: GA4 collect calls
   * embed the page's own URL (which legitimately contains "sign-up") in an
   * encoded referrer query param, so relying on urlPattern alone was a
   * latent false-positive risk. This list is checked first and
   * short-circuits capture regardless of urlPattern.
   */
  excludedHosts: [/\bintercom\.io$/i, /\bgoogle-analytics\.com$/i, /\bgoogletagmanager\.com$/i],

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
   * filter and so cleanup can find the right account. (A real captured
   * example used "test231@gmail.com" — our tagged format follows the same
   * "test" convention, just namespaced per run.)
   */
  testUser: {
    name: "Test QA Automation",
    emailFor: (runId: string) => `test-automation+${runId}@example-testing.invalid`,
  },

  /**
   * Admin API. Deletion mechanism and base resource path are now CONFIRMED
   * to match `/api/v1/users/:id` exactly (soft-delete via PATCH, cascades
   * to cancel future lessons — so no separate lesson cleanup is needed).
   * The email-filter lookup path is still a guess, but is now much more
   * likely correct since it follows the same confirmed `/api/v1/users`
   * base and JSON:API filter convention.
   */
  adminApi: {
    baseUrl: process.env.ADMIN_API_BASE_URL ?? "https://stage.allright.com",
    bearerTokenEnvVar: "ADMIN_BEARER_TOKEN",
    // GUESS, in the confirmed JSON:API filter convention.
    findUserByEmailPath: (email: string) =>
      `/api/v1/users?filter[email]=${encodeURIComponent(email)}`,
    // GUESS — the relationship is confirmed to be named "lessons" on the
    // user resource; exact full path (direct vs. /relationships/lessons) unconfirmed.
    findBookingsForUserPath: (userId: string) => `/api/v1/users/${userId}/lessons`,
    // CONFIRMED by the team and by direct observation, verbatim.
    deleteUserPath: (userId: string) =>
      `/api/v1/users/${userId}/?fields[user]=is_deleted,deletion_reason`,
  },
};
