/**
 * Confirmed-vs-guessed status of everything below (as of the latest real
 * Network-tab capture, including the final step):
 *   CONFIRMED — the API is JSON:API-style (`/api/v1/...`, kebab-case
 *     attributes, `Content-Type: application/vnd.api+json`,
 *     `{"data":{"type":"...","id":"...","attributes":{...}}}`). The user
 *     resource lives at `/api/v1/users/:id`. Deletion is a soft-delete PATCH
 *     that cascades to cancel future lessons. Test accounts are
 *     auto-excluded from analytics by having "test"/"тест" in the name. The
 *     "charlie/long" funnel ends at `/uk/app/request-gotten`.
 *   IMPORTANT DESIGN SHIFT #1 — there is no single "sign-up" POST. The quiz
 *     creates the user record early (anonymous/lead), then PATCHes the same
 *     `/api/v1/users/:id` resource after nearly every step, accumulating
 *     `funnel-data`. "Account created" is verified by *content* (a real
 *     email present), not by matching one specific URL.
 *   IMPORTANT DESIGN SHIFT #2 — the final screen for this funnel literally
 *     says "an administrator will contact you and offer a time" — meaning
 *     this funnel does NOT synchronously create a booked lesson with a
 *     teacher/time; it submits a qualified request that a human finalizes
 *     later. There's no separate booking-entity URL to intercept. Modeled,
 *     as a hypothesis pending final confirmation, as the same user resource
 *     picking up non-null schedule "wishes" (lesson-date-wishes /
 *     tutor-id-wishes / permanent-schedule). See README for the open
 *     question this raises about what "trial lesson booked" should even
 *     mean for this specific funnel, worth raising with the team.
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

  /**
   * URL the app navigates to once the quiz is fully done. CONFIRMED for the
   * "charlie/long" funnel: /uk/app/request-gotten ("Дякуємо! Ваш запит
   * отримано"). Kept the other guesses too since other funnels/A-B variants
   * may land elsewhere — see STRATEGY.md for why URL alone still isn't the
   * primary signal.
   */
  successUrlPatterns: [
    /\/app\/request-gotten/i,
    /\/sign-up\/(success|complete|thank-you)/i,
    /\/app\/dashboard/i,
    /\/app\/lesson/i,
  ],

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
      // REVISED based on the confirmed final page (see below): this funnel
      // doesn't create a separate lesson/booking entity synchronously — the
      // final screen ("Дякуємо! Ваш запит отримано") says an admin will
      // pick a teacher and offer a time afterward. So there's no distinct
      // "booking" URL to match; the same /api/v1/users/:id resource is
      // PATCHed, and the real observed fields for this are
      // "lesson-time-start", "lesson-id", "lesson-tutor-type-id" (all seen
      // as null mid-flow in a real capture; "lesson-duration": 30 is set
      // from the start and isn't a useful signal on its own).
      // CORRECTED from an earlier wrong guess ("lesson-date-wishes" doesn't
      // actually appear in the real payload at all).
      urlPattern: /\/api\/v1\/users\/\d+/i,
      methods: ["POST", "PATCH", "PUT"],
      isValid: (body: unknown): boolean => {
        const attrs = (body as any)?.data?.attributes ?? {};
        return (
          attrs["lesson-time-start"] != null ||
          attrs["lesson-id"] != null ||
          attrs["lesson-tutor-type-id"] != null
        );
      },
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
   * CONFIRMED, directly from a real capture: the assigned A/B variant is
   * exposed right in the user resource's attributes as
   * `experiments: [{alias, variant}]` (e.g. `{"alias":"QUIZ_CHARLIE_VS_AIGEN","variant":"A"}`).
   * `extractExperiments()` in outcomeCapture.ts reads this directly — no
   * guessing needed. The cookie/header patterns below are kept only as a
   * secondary fallback in case a future variant isn't reflected in the user
   * resource for some reason; still purely diagnostic either way, never
   * used to branch test behavior.
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
