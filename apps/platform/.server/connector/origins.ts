type Env = {
  BASE_URL?: string;
  CONNECTOR_ORIGINS?: string;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_BRANCH_URL?: string;
};

/**
 * `origin` equals the origin of `BASE_URL`, or one of the comma-separated
 * origins in `CONNECTOR_ORIGINS`. Paths are not origins and never match.
 * A preview deploy also accepts this deployment's own `VERCEL_URL` and
 * `VERCEL_BRANCH_URL`, https only. Production ignores those hosts.
 */
export function origin_allowed(
  origin: string,
  env: Env = process.env
): boolean {
  const base = base_origin(env.BASE_URL);
  if (base && origin === base) return true;
  for (const allowed of listed_origins(env.CONNECTOR_ORIGINS)) {
    if (origin === allowed) return true;
  }
  if (env.VERCEL_ENV === "preview") {
    for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
      const own = https_origin(host);
      if (own && origin === own) return true;
    }
  }
  return false;
}

function https_origin(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const with_scheme = raw.includes("://") ? raw : `https://${raw}`;
  try {
    const url = new URL(with_scheme);
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function base_origin(base_url: string | undefined): string | null {
  const raw = base_url?.replace(/\/+$/, "");
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function listed_origins(list: string | undefined): string[] {
  if (!list) return [];
  return list
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
