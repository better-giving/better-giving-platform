import { limit_shared, type Quota } from "#/.server/auth/rate-limit";
import { report_error } from "#/errors/report";
import type { Db } from "../pg/db";
import type { DbOrTx } from "../pg/queries/helpers";
import { find_live_key } from "./keys";
import { problem, provider_error, rate_limited } from "./problem";

export const LIST_WRITE_QUOTA: Quota = { max: 120, window_s: 60 };
export const READ_QUOTA: Quota = { max: 1200, window_s: 60 };

const QUOTA = { list_write: LIST_WRITE_QUOTA, read: READ_QUOTA } as const;

export type Bucket = keyof typeof QUOTA;

/** the key's id and nonprofit — the only source of the tenant a request
 * acts on */
export type LiveKey = { id: string; npo_id: number };

/** one charge against this key's bucket, null when it had room. the shared
 * counter, so the quota holds across instances and the 429 can say when the
 * window ends. `db` is never a transaction (`limit_shared`'s rule) */
export async function charge(
  db: Db,
  key_id: string,
  bucket: Bucket
): Promise<Response | null> {
  const r = await limit_shared(
    `partner:${bucket}:${key_id}`,
    QUOTA[bucket],
    db
  );
  return r.ok ? null : rate_limited(r.retry_after_s);
}

export async function require_live_key(
  db: DbOrTx,
  request: Request
): Promise<LiveKey | Response> {
  const token = bearer_token(request);
  const live = token ? await find_live_key(db, token) : null;
  return live ?? problem("key_invalid");
}

function bearer_token(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  return /^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? null;
}

/** a live key, charged against its list/write bucket */
export async function open_key(
  db: Db,
  request: Request
): Promise<LiveKey | Response> {
  const live = await require_live_key(db, request);
  if (live instanceof Response) return live;
  return (await charge(db, live.id, "list_write")) ?? live;
}

/** a partner route's loader or action: an unexpected throw is reported and
 * answered as problem JSON, never react-router's html 500. the report carries
 * method and path only — never headers, where the key rides */
export function partner_route<A extends { request: Request }>(
  handler: (args: A) => Response | Promise<Response>
): (args: A) => Promise<Response> {
  return async (args) => {
    try {
      return await handler(args);
    } catch (err) {
      const { method, url } = args.request;
      report_error(err, {
        where: "partner",
        method,
        path: new URL(url).pathname,
      });
      return provider_error(500);
    }
  };
}
