/**
 * Every pattern in this file is an ASSUMPTION, not a verified fact — I don't
 * have access to the real stage environment, the API contract, or the
 * current set of A/B variants. In a real onboarding I'd get these confirmed
 * with the team (the task explicitly invites that) before the first run.
 * Keeping them here, isolated from test/driver logic, means a new A/B
 * variant or a renamed endpoint is a one-line edit, not a rewrite.
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
   * TO CONFIRM: real path segments, method, and response shape.
   */
  apiEvents: {
    accountCreated: {
      name: "account-created",
      urlPattern: /\/api\/.*(sign-?up|register|users)(?!.*booking)/i,
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

  /** Test-data tagging so the created account is identifiable/filterable/cleanable. */
  testUser: {
    emailFor: (runId: string) => `qa-automation+${runId}@example-testing.invalid`,
  },
};
