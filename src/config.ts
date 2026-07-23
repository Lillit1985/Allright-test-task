export const config = {
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
  forbiddenActionPatterns: [/pay/i, /оплат/i, /checkout/i, /subscribe/i, /card/i],
  successUrlPatterns: [
    /\/app\/request-gotten/i,
    /\/sign-up\/(success|complete|thank-you)/i,
    /\/app\/dashboard/i,
    /\/app\/lesson/i,
  ],
  apiEvents: {
    accountCreated: {
      name: "account-created",
      urlPattern: /\/api\/v1\/users\/\d+/i,
      methods: ["POST", "PATCH", "PUT"],
      isValid: (body: unknown): boolean => {
        const attrs = (body as any)?.data?.attributes;
        const email = attrs?.email;
        return typeof email === "string" && email.includes("@");
      },
    },
    trialBooked: {
      name: "trial-booked",
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
  excludedHosts: [/\bintercom\.io$/i, /\bgoogle-analytics\.com$/i, /\bgoogletagmanager\.com$/i],
  driver: {
    maxSteps: 25,
    maxTotalMs: 90_000,
    perStepTimeoutMs: 8_000,
  },
  experimentDiagnostics: {
    cookieNamePatterns: [/experiment/i, /variant/i, /^ab[-_]/i],
    headerNamePatterns: [/x-experiment/i, /x-variant/i],
  },
  testUser: {
    name: "Test QA Automation",
    emailFor: (runId: string) => `test-automation+${runId}@example-testing.invalid`,
  },
  adminApi: {
    baseUrl: process.env.ADMIN_API_BASE_URL ?? "https://stage.allright.com",
    bearerTokenEnvVar: "ADMIN_BEARER_TOKEN",
    findUserByEmailPath: (email: string) =>
      `/api/v1/users?filter[email]=${encodeURIComponent(email)}`,
      findBookingsForUserPath: (userId: string) => `/api/v1/users/${userId}/lessons`,
    deleteUserPath: (userId: string) =>
      `/api/v1/users/${userId}/?fields[user]=is_deleted,deletion_reason`,
  },
};
