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

export function extractEntityId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;

  const data = obj["data"];
  if (Array.isArray(data)) {
    const first = data[0] as Record<string, unknown> | undefined;
    return (first?.["id"] as string) ?? null;
  }
  if (data && typeof data === "object") {
    return ((data as Record<string, unknown>)["id"] as string) ?? null;
  }
  return (obj["id"] as string) ?? null;
}
export async function findUserByEmail(
  ctx: APIRequestContext,
  email: string
): Promise<AdminUserRecord | null> {
  const res = await ctx.get(config.adminApi.findUserByEmailPath(email));
  if (!res.ok()) return null;

  const body = await res.json().catch(() => null);
  if (!body) return null;

  const id = extractEntityId(body);
  if (!id) return null;

  const attributes =
    (Array.isArray(body?.data) ? body.data[0]?.attributes : body?.data?.attributes) ?? {};

  return { id, email, ...attributes } as AdminUserRecord;
}

export async function findBookingsForUser(
  ctx: APIRequestContext,
  userId: string
): Promise<AdminBookingRecord[]> {
  const res = await ctx.get(config.adminApi.findBookingsForUserPath(userId));
  if (!res.ok()) return [];

  const body = await res.json().catch(() => null);
  const data = (body as Record<string, unknown> | null)?.["data"];
  if (!Array.isArray(data)) return [];

  return data.map((item) => {
    const entry = item as Record<string, unknown>;
    return {
      id: entry["id"] as string,
      userId,
      ...((entry["attributes"] as Record<string, unknown>) ?? {}),
    };
  });
}
export async function deleteTestUser(ctx: APIRequestContext, userId: string): Promise<boolean> {
  try {
    const res = await ctx.patch(config.adminApi.deleteUserPath(userId), {
      data: {
        data: {
          type: "users",
          id: userId,
          attributes: { "is-deleted": true },
        },
      },
    });
    if (!res.ok()) {
      console.warn(`[cleanup] failed to soft-delete test user ${userId}: HTTP ${res.status()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[cleanup] error soft-deleting test user ${userId}:`, err);
    return false;
  }
}
