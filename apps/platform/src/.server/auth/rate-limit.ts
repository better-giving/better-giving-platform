import * as v from "valibot";
import type { DbOrTx } from "$/pg/queries/helpers";
import {
  type RateWindow,
  rate_limit_release,
  rate_limit_sweep,
  rate_limit_take,
} from "$/pg/queries/rate-limit";

/** Application-level throttling for auth work that runs server-side.
 *
 * better-auth's own limiter lives in its router's `onRequest`, so it only sees
 * traffic that arrives at `/api/auth/*`. Every call this app makes through
 * `auth.api.*` goes straight to the endpoint and is never counted — which is
 * exactly the anonymous lead path. These counters are that missing gate.
 *
 * They are per-process: each serverless instance keeps its own map, so the real
 * ceiling is `max` × live instances, and a cold start resets it. That makes this
 * a blunt cap on a single abusive source rather than an exact quota. The
 * `_shared` variants are the exact quota: one postgres row per key and window,
 * counted by every instance, at a db round trip per call.
 */

export interface Quota {
  max: number;
  /** rolling window, in seconds */
  window_s: number;
}

interface Bucket {
  count: number;
  reset_at: number;
}

const buckets = new Map<string, Bucket>();
/** past this, the oldest entries go — bounds a map nobody ever sweeps */
const MAX_BUCKETS = 10_000;

/** one use already counted against a window, which can be handed back */
export interface Reservation {
  /** returns the use to the window it was taken from. a no-op once that
   * window has rolled over, and on every call after the first. */
  release(): void;
}

/** Counts one use of `key` now, or returns null when `quota` has none left. */
export function reserve(key: string, quota: Quota): Reservation | null {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || now >= bucket.reset_at) {
    if (buckets.size >= MAX_BUCKETS) prune(now);
    bucket = { count: 0, reset_at: now + quota.window_s * 1000 };
    buckets.set(key, bucket);
  }
  if (bucket.count >= quota.max) return null;
  bucket.count += 1;

  // the bucket object is the window: a rollover or eviction replaces it
  const window = bucket;
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      if (buckets.get(key) === window) window.count -= 1;
    },
  };
}

/** Records one use of `key` and reports whether it was within `quota`. */
export function consume(key: string, quota: Quota): boolean {
  return reserve(key, quota) !== null;
}

/** a `Reservation` whose release is a write to the shared store */
export interface SharedReservation extends Reservation {
  release(): Promise<void>;
}

/** `reserve` over the counters every instance shares. a db error propagates. */
export async function reserve_shared(
  key: string,
  quota: Quota,
  conn?: DbOrTx
): Promise<SharedReservation | null> {
  const w = fixed_window(quota);
  if ((await take(key, w, quota.max, conn)) === null) return null;
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      await rate_limit_release(key, w.start, conn);
    },
  };
}

/** `consume` over the shared counters, saying when to come back on a denial.
 * a db error propagates. */
export async function limit_shared(
  key: string,
  quota: Quota,
  conn?: DbOrTx
): Promise<{ ok: true } | { ok: false; retry_after_s: number }> {
  const w = fixed_window(quota);
  if ((await take(key, w, quota.max, conn)) !== null) {
    return { ok: true };
  }
  // `now` is inside the window, so this is at least 1
  return { ok: false, retry_after_s: Math.ceil((w.end_ms - w.now) / 1000) };
}

/** one take in this many also sweeps ended windows */
const SWEEP_ONE_IN = 100;

/** the take, plus — on a sampled call — a sweep of ended windows. the sweep is
 * its own statement so its failure can't fail the take, and it is awaited
 * because work left running after a serverless response can be frozen. */
async function take(
  key: string,
  w: RateWindow & { now: number },
  max: number,
  conn?: DbOrTx
): Promise<number | null> {
  const count = await rate_limit_take(key, w, max, conn);
  if (Math.random() * SWEEP_ONE_IN < 1) {
    try {
      await rate_limit_sweep(new Date(w.now).toISOString(), conn);
    } catch (err) {
      console.error("rate limit sweep failed", err);
    }
  }
  return count;
}

/** the `window_s`-long window holding now, aligned to the epoch so every
 * instance computes the same one */
function fixed_window(
  quota: Quota
): RateWindow & { now: number; end_ms: number } {
  const now = Date.now();
  const span = quota.window_s * 1000;
  const start_ms = Math.floor(now / span) * span;
  const end_ms = start_ms + span;
  return {
    start: new Date(start_ms).toISOString(),
    end: new Date(end_ms).toISOString(),
    now,
    end_ms,
  };
}

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.reset_at) buckets.delete(key);
  }
  // still full: every bucket is live, so drop insertion-oldest to make room
  if (buckets.size < MAX_BUCKETS) return;
  const overflow = buckets.size - MAX_BUCKETS + 1;
  let dropped = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    if (++dropped >= overflow) break;
  }
}

/** also better-auth's `advanced.ipAddress.ipAddressHeaders`, and read the way
 * it reads them, so "who is calling" is one answer whether the request
 * reached better-auth's router or a loader. vercel overwrites
 * `x-forwarded-for` at its edge; nothing documents a client-sent
 * `x-vercel-forwarded-for` being stripped, so that one is never read. */
export const IP_HEADERS: readonly string[] = ["x-forwarded-for"];

const IPV4 = v.pipe(v.string(), v.ipv4());
const IPV6 = v.pipe(v.string(), v.ipv6());

/** the caller's address as a bucket key. an ipv6 client holds a whole /64, so
 * it is keyed by that prefix — per-address keys would hand it a fresh quota
 * per address. */
export function client_ip(headers: Headers): string | null {
  for (const name of IP_HEADERS) {
    const ip = headers.get(name)?.trim();
    // a chain's leftmost entry is client-supplied; better-auth refuses one
    // without `trustedProxies`, so it is an unknown ip here too
    if (!ip || ip.includes(",")) continue;
    if (v.is(IPV4, ip)) return ip;
    if (v.is(IPV6, ip)) return ipv6_key(ip);
  }
  return null;
}

/** `2001:db8::1` → `2001:0db8:0000:0000:0000:0000:0000:0000`, better-auth's
 * own key for the same /64. an ipv4-mapped address is an ipv4 client and keys
 * as one — the /64 they share is `::`, every such client at once. */
function ipv6_key(ip: string): string {
  const g = ipv6_groups(ip);
  const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
  if (mapped) {
    const [hi = 0, lo = 0] = g.slice(6);
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
  }
  const prefix = g.slice(0, 4).map((x) => x.toString(16).padStart(4, "0"));
  return [...prefix, "0000", "0000", "0000", "0000"].join(":");
}

/** the eight 16-bit groups of an address `IPV6` already accepted */
function ipv6_groups(ip: string): number[] {
  const parse = (part: string) =>
    (part ? part.split(":") : []).flatMap((x) => {
      if (!x.includes(".")) return [Number.parseInt(x, 16)];
      const [a = 0, b = 0, c = 0, d = 0] = x.split(".").map(Number);
      return [(a << 8) | b, (c << 8) | d];
    });
  const [head = "", tail] = ip.split("::");
  const left = parse(head);
  if (tail === undefined) return left;
  const right = parse(tail);
  const zeros = Array<number>(8 - left.length - right.length).fill(0);
  return [...left, ...zeros, ...right];
}

/** test seam — the counters outlive a single request by design */
export function reset_rate_limits(): void {
  buckets.clear();
}
