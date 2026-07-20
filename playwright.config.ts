import { defineConfig, devices } from "@playwright/test";

/**
 * NOTE: this suite talks to a LIVE stage environment with real side effects
 * (it creates an account and books a trial lesson). Keep concurrency low,
 * keep the run infrequent (see STRATEGY.md, section 3), and never point
 * BASE_URL at production.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 120_000, // the quiz walk itself can legitimately take a while
  expect: { timeout: 10_000 },
  fullyParallel: false, // one live account/booking per run is enough; avoid piling up test data
  retries: 1, // one retry only, to absorb transient stage flakiness — not to mask real breakage
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.QUIZ_BASE_URL ?? "https://stage.allright.com",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
