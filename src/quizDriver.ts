import { Page } from "@playwright/test";
import { config } from "./config";
import { CapturedApiEvent, QuizRunResult } from "./types";
import { hasConfirmedEvent } from "./outcomeCapture";

/**
 * Walks the quiz forward without any knowledge of its current step
 * structure. It does not assert anything about individual steps — that is
 * intentional (see STRATEGY.md, "what I deliberately do not fix"). Its only
 * job is to reach a terminal state so the outcome-level assertions in the
 * test can run against something real.
 *
 * Strategy per iteration:
 *  1. If any answerable input is visible (radio/checkbox/combobox/textbox),
 *     pick a valid value generically (first enabled option / sample text).
 *  2. Click the most plausible forward CTA.
 *  3. Wait for either navigation, network idle, or DOM to settle.
 *  4. Stop when a success signal is observed, or when limits are hit.
 */
export async function walkQuizToCompletion(
  page: Page,
  capturedEvents: CapturedApiEvent[],
  testEmail: string
): Promise<QuizRunResult> {
  const start = Date.now();
  let steps = 0;

  while (steps < config.driver.maxSteps && Date.now() - start < config.driver.maxTotalMs) {
    const successByUrl = config.successUrlPatterns.some((p) => p.test(page.url()));
    const successByApi =
      hasConfirmedEvent(capturedEvents, "account-created") &&
      hasConfirmedEvent(capturedEvents, "trial-booked");

    if (successByUrl || successByApi) {
      return {
        reachedSuccess: true,
        successSignal: successByApi ? "api" : "url",
        stepsTaken: steps,
        finalUrl: page.url(),
        capturedEvents,
      };
    }

    await answerVisibleInputsGenerically(page, testEmail);

    const clicked = await clickForwardCta(page);
    if (!clicked) {
      // No known way forward: either we're stuck on an unrecognized screen,
      // or the quiz has genuinely nothing left to do. Either way, this is
      // a real signal, not something to paper over — the test decides what
      // to do with it.
      break;
    }

    steps += 1;
    await settle(page);
  }

  const successByUrl = config.successUrlPatterns.some((p) => p.test(page.url()));
  const successByApi =
    hasConfirmedEvent(capturedEvents, "account-created") &&
    hasConfirmedEvent(capturedEvents, "trial-booked");

  return {
    reachedSuccess: successByUrl || successByApi,
    successSignal: successByApi ? "api" : successByUrl ? "url" : "none",
    stepsTaken: steps,
    finalUrl: page.url(),
    capturedEvents,
  };
}

async function answerVisibleInputsGenerically(page: Page, testEmail: string): Promise<void> {
  // Single/multi choice presented as radio or checkbox: pick the first enabled one.
  const radios = page.locator('input[type="radio"]:visible, [role="radio"]:visible');
  if ((await radios.count()) > 0) {
    const first = radios.first();
    if (await first.isEnabled().catch(() => false)) {
      await first.check({ force: true }).catch(() => first.click({ force: true }).catch(() => {}));
    }
  }

  // Email field: use the tagged test email so the account is identifiable
  // and cleanable, and so the admin-API lookup after the run can find it.
  const emailInputs = page.locator('input[type="email"]:visible');
  const emailCount = await emailInputs.count();
  for (let i = 0; i < emailCount; i++) {
    const el = emailInputs.nth(i);
    const currentValue = await el.inputValue().catch(() => "");
    if (!currentValue) {
      await el.fill(testEmail).catch(() => {});
    }
  }

  // Other free-text fields: fill with the confirmed test-data naming
  // convention ("test"/"тест" in the name auto-excludes the account from
  // analytics — see config.testUser and STRATEGY.md/README).
  const textInputs = page.locator(
    'input[type="text"]:visible, input:not([type]):visible, textarea:visible'
  );
  const textCount = await textInputs.count();
  for (let i = 0; i < textCount; i++) {
    const el = textInputs.nth(i);
    const currentValue = await el.inputValue().catch(() => "");
    if (!currentValue) {
      await el.fill(config.testUser.name).catch(() => {});
    }
  }

  // Dropdown/combobox: open and pick the first option, if present.
  const selects = page.locator("select:visible");
  const selectCount = await selects.count();
  for (let i = 0; i < selectCount; i++) {
    const el = selects.nth(i);
    const options = await el.locator("option").all();
    if (options.length > 1) {
      const value = await options[1].getAttribute("value");
      if (value) await el.selectOption(value).catch(() => {});
    }
  }
}

async function clickForwardCta(page: Page): Promise<boolean> {
  const candidates = page.locator('button:visible, [role="button"]:visible, a:visible');
  const count = await candidates.count();

  for (let i = 0; i < count; i++) {
    const el = candidates.nth(i);
    const text = ((await el.textContent().catch(() => "")) ?? "").trim();
    if (!text) continue;

    const isForbidden = config.forbiddenActionPatterns.some((p) => p.test(text));
    if (isForbidden) continue;

    const isCta = config.ctaPatterns.some((p) => p.test(text));
    if (!isCta) continue;

    const isEnabled = await el.isEnabled().catch(() => false);
    if (!isEnabled) continue;

    await el.click({ timeout: config.driver.perStepTimeoutMs }).catch(() => {});
    return true;
  }

  return false;
}

async function settle(page: Page): Promise<void> {
  await Promise.race([
    page.waitForLoadState("networkidle", { timeout: config.driver.perStepTimeoutMs }),
    page.waitForTimeout(config.driver.perStepTimeoutMs),
  ]).catch(() => {});
}
