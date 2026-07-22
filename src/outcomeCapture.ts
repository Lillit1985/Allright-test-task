import { Page } from "@playwright/test";
import { config } from "./config";
import { extractEntityId } from "./adminApiClient";
import { CapturedApiEvent } from "./types";

/**
 * Attaches a response listener BEFORE navigation starts and records any
 * response matching the two business-critical API patterns. This is the
 * core of the "AB-agnostic" verification: it never looks at the DOM/UI at
 * all, only at whether the two facts we care about actually happened on
 * the wire, with a successful status code — and now also the created
 * entity's id, since the team confirmed both responses return one.
 */
export function captureOutcomeEvents(page: Page): CapturedApiEvent[] {
  const captured: CapturedApiEvent[] = [];

  page.on("response", async (response) => {
    const url = response.url();
    const request = response.request();

    if (config.excludedHosts.some((p) => p.test(new URL(url).hostname))) return;

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

/** The id the API returned for a given captured event, if any (JSON:API `data.id`). */
export function entityIdFor(events: CapturedApiEvent[], name: string): string | null {
  const event = events.find((e) => e.name === name && e.status >= 200 && e.status < 300);
  return event ? extractEntityId(event.body) : null;
}

export interface ExperimentDiagnostics {
  cookies: Record<string, string>;
  headers: Record<string, string>;
}

/**
 * Purely diagnostic: records any cookie/header that looks like it carries
 * an experiment/variant assignment, so a failure can be correlated with
 * "which A/B variant was this run served" without the test ever branching
 * its behavior on that value. See STRATEGY.md, section 2.
 */
export async function captureExperimentDiagnostics(page: Page): Promise<ExperimentDiagnostics> {
  const diagnostics: ExperimentDiagnostics = { cookies: {}, headers: {} };

  const cookies = await page.context().cookies();
  for (const cookie of cookies) {
    if (config.experimentDiagnostics.cookieNamePatterns.some((p) => p.test(cookie.name))) {
      diagnostics.cookies[cookie.name] = cookie.value;
    }
  }

  page.on("response", (response) => {
    const headers = response.headers();
    for (const [name, value] of Object.entries(headers)) {
      if (config.experimentDiagnostics.headerNamePatterns.some((p) => p.test(name))) {
        diagnostics.headers[name] = value;
      }
    }
  });

  return diagnostics;
}
