import { Page } from "@playwright/test";
import { config } from "./config";
import { extractEntityId } from "./adminApiClient";
import { CapturedApiEvent } from "./types";
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

function defFor(name: string) {
  return Object.values(config.apiEvents).find((d) => d.name === name);
}
export function hasSuccessfulEvent(events: CapturedApiEvent[], name: string): boolean {
  return events.some((e) => e.name === name && e.status >= 200 && e.status < 300);
}
export function hasConfirmedEvent(events: CapturedApiEvent[], name: string): boolean {
  const def = defFor(name);
  return events.some((e) => {
    if (e.name !== name) return false;
    if (e.status < 200 || e.status >= 300) return false;
    if (def && "isValid" in def && typeof (def as any).isValid === "function") {
      return Boolean((def as any).isValid(e.body));
    }
    return true;
  });
}
export function entityIdFor(events: CapturedApiEvent[], name: string): string | null {
  const def = defFor(name);
  const event = events.find((e) => {
    if (e.name !== name || e.status < 200 || e.status >= 300) return false;
    if (def && "isValid" in def && typeof (def as any).isValid === "function") {
      return Boolean((def as any).isValid(e.body));
    }
    return true;
  });
  return event ? extractEntityId(event.body) : null;
}

export interface ExperimentDiagnostics {
  fromResponseBody: Array<{ alias: string; variant: string }>;
  cookies: Record<string, string>;
  headers: Record<string, string>;
}
export function extractExperiments(
  events: CapturedApiEvent[]
): Array<{ alias: string; variant: string }> {
  for (const e of events) {
    const experiments = ((e.body as any)?.data?.attributes?.experiments ?? null) as
      | Array<{ alias: string; variant: string }>
      | null;
    if (Array.isArray(experiments) && experiments.length > 0) return experiments;
  }
  return [];
}
export async function captureExperimentDiagnostics(page: Page): Promise<ExperimentDiagnostics> {
  const diagnostics: ExperimentDiagnostics = { fromResponseBody: [], cookies: {}, headers: {} };

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
