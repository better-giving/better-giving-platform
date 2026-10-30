import { Client } from "@hubspot/api-client";
import { hubspot as hubspot_env, stage } from "../env";

export const hubspot = new Client({
  accessToken: hubspot_env.access_token,
});

/**
 * a crm call a queued job makes. off production a missing token, or one hubspot
 * answers 401, resolves `null` with a warning, so a preview's crm credential
 * can't fail the job; production keeps every throw.
 */
export async function crm<T>(label: string, call: () => Promise<T>) {
  if (stage === "production") return call();
  if (!hubspot_env.access_token) return skipped(label, "no access token");
  try {
    return await call();
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === 401) {
      return skipped(label, "access token refused");
    }
    throw err;
  }
}

function skipped(label: string, reason: string): null {
  console.warn(`hubspot ${label} skipped (${reason})`);
  return null;
}
