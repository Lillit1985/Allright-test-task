import { Page } from "@playwright/test";
import { config } from "./config";
import { CapturedApiEvent } from "./types";

/**
 * Attaches a response listener BEFORE navigation starts and records any
 * response matching the two business-critical API patterns. This is the
 * core of the "AB-agnostic" verification: it never looks at the DOM/UI at
 * all, only at whether the two facts we care about actually happened on
 * the wire, with a successful status code.
 */
export function captureOutcomeEvents(page: Page): CapturedApiEvent[] {
  const captured: CapturedApiEvent[] = [];

  page.on("response", async (response) => {
    const url = response.url();
    const request = response.request();

    for (const [, def] of Object.entries(config.apiEvents)) {
      if (!def.urlPattern.test(url)) continue;
      if (!def.methods.includes(request.method())) continue;

      let body: unknown = undefined;
      try {
        body = await response.json();
      } catch {
        // non-JSON or empty body — still record status, that's enough signal
      }

      captured.push({
        name: def.name,
        url,
        status: response.status(),
        body,
      });
    }
  });

  return captured;
}

export function hasSuccessfulEvent(events: CapturedApiEvent[], name: string): boolean {
  return events.some((e) => e.name === name && e.status >= 200 && e.status < 300);
}
