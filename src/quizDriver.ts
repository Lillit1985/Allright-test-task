import { Page } from "@playwright/test";
import { config } from "./config";
import { CapturedApiEvent, QuizRunResult } from "./types";
import { hasConfirmedEvent } from "./outcomeCapture";
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
  const radios = page.locator('input[type="radio"]:visible, [role="radio"]:visible');
  if ((await radios.count()) > 0) {
    const first = radios.first();
    if (await first.isEnabled().catch(() => false)) {
      await first.check({ force: true }).catch(() => first.click({ force: true }).catch(() => {}));
    }
  }
  const emailInputs = page.locator('input[type="email"]:visible');
  const emailCount = await emailInputs.count();
  for (let i = 0; i < emailCount; i++) {
    const el = emailInputs.nth(i);
    const currentValue = await el.inputValue().catch(() => "");
    if (!currentValue) {
      await el.fill(testEmail).catch(() => {});
    }
  }
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
