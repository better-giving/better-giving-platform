import {
  client_ip,
  type Quota,
  type Reservation,
  reserve,
} from "#/.server/auth/rate-limit";
import { photo_upload_quota } from "@/constants/upload";
import type { DbOrTx } from "../pg/queries/helpers";
import { find_live_key } from "./keys";
import { problem } from "./problem";

const IP_QUOTA = {
  hello: { max: 120, window_s: 60 },
  exchange: { max: 30, window_s: 60 },
  photo_upload: photo_upload_quota,
} as const satisfies Record<string, Quota>;

const KEY_QUOTA: Quota = { max: 120, window_s: 60 };

type IpAction = keyof typeof IP_QUOTA;

/** One charge against the per-address bucket for an unauthenticated action.
 * No address shares one bucket — skipping the limit would be unlimited. */
export function reserve_ip(
  action: IpAction,
  request: Request
): Reservation | null {
  const ip = client_ip(request.headers) ?? "unknown";
  return reserve(`connector-ip:${action}:${ip}`, IP_QUOTA[action]);
}

/** One charge against this key. The address is not part of the bucket. */
export function reserve_keyed(key_id: string): Reservation | null {
  return reserve(`connector:${key_id}`, KEY_QUOTA);
}

export async function require_live_key(
  db: DbOrTx,
  request: Request
): Promise<{ id: string; npo_id: number; allowed_by: string } | Response> {
  const token = bearer_token(request);
  if (!token) return problem(401, "key_refused");
  const live = await find_live_key(db, token);
  if (!live) return problem(401, "key_refused");
  return live;
}

function bearer_token(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}
