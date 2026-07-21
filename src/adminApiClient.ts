import { APIRequestContext, request as playwrightRequest } from "@playwright/test";
import { config } from "./config";

export interface AdminUserRecord {
  id: string;
  email: string;
  [key: string]: unknown;
}

export interface AdminBookingRecord {
  id: string;
  userId: string;
  status?: string;
  scheduledAt?: string;
  [key: string]: unknown;
}

/**
 * Creates an authenticated request context against the admin API.
 * Throws early with a clear message if the token isn't set, rather than
 * failing deep inside a fetch with a confusing 401.
 */
export async function createAdminApiContext(): Promise<APIRequestContext> {
  const token = process.env[config.adminApi.bearerTokenEnvVar];
  if (!token) {
    throw new Error(
      `Missing ${config.adminApi.bearerTokenEnvVar}. Grab it from a request in the admin ` +
        `panel (Authorization header) and set it as an env var — never commit it.`
    );
  }

  return playwrightRequest.newContext({
    baseURL: config.adminApi.baseUrl,
    extraHTTPHeaders: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
}

/**
 * Looks up the test user by the tagged email. Returns null if not found
 * (e.g. the account-creation step actually failed) rather than throwing —
 * "not found" is a legitimate, informative test outcome here.
 *
 * NOTE: response shape assumed to be either a single object or a list;
 * TO CONFIRM against the real admin API once reachable.
 */
export async function findUserByEmail(
  ctx: APIRequestContext,
  email: string
): Promise<AdminUserRecord | null> {
  const res = await ctx.get(config.adminApi.findUserByEmailPath(email));
  if (!res.ok()) return null;

  const body = await res.json().catch(() => null);
  if (!body) return null;

  if (Array.isArray(body)) return body[0] ?? null;
  if (Array.isArray(body?.items)) return body.items[0] ?? null;
  return body as AdminUserRecord;
}

export async function findBookingsForUser(
  ctx: APIRequestContext,
  userId: string
): Promise<AdminBookingRecord[]> {
  const res = await ctx.get(config.adminApi.findBookingsForUserPath(userId));
  if (!res.ok()) return [];

  const body = await res.json().catch(() => null);
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  return [];
}

/**
 * Best-effort cleanup. Deliberately never throws — a failed cleanup
 * shouldn't fail the test itself (the test already made its assertions by
 * the time this runs), it should just be visible in the logs so someone can
 * purge stage manually if it keeps happening.
 */
export async function deleteTestUser(ctx: APIRequestContext, userId: string): Promise<boolean> {
  try {
    const res = await ctx.delete(config.adminApi.deleteUserPath(userId));
    if (!res.ok()) {
      console.warn(`[cleanup] failed to delete test user ${userId}: HTTP ${res.status()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[cleanup] error deleting test user ${userId}:`, err);
    return false;
  }
}
