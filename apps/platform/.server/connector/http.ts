import { report_error } from "#/errors/report";
import type { DbOrTx } from "../pg/queries/helpers";
import { decode_list_cursor, type ListCursor } from "./cursor";
import { require_live_key, reserve_keyed } from "./gate";
import { type FieldError, invalid, problem } from "./problem";

export const NO_STORE = { "cache-control": "no-store" };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** a connector route's loader or action: an unexpected throw is reported and
 * answered as problem JSON, never react-router's html 500 */
export function connector_route<A extends { request: Request }>(
  handler: (args: A) => Response | Promise<Response>
): (args: A) => Promise<Response> {
  return async (args) => {
    try {
      return await handler(args);
    } catch (err) {
      const { method, url } = args.request;
      report_error(err, {
        where: "connector",
        method,
        path: new URL(url).pathname,
      });
      return problem(500, "internal_error", {
        detail:
          "Better Giving hit an error and could not complete this request.",
      });
    }
  };
}

export type LiveKey = { id: string; npo_id: number; allowed_by: string };

/** A live key, charged against its own 120/min bucket. */
export async function open_key(
  db: DbOrTx,
  request: Request
): Promise<LiveKey | Response> {
  const live = await require_live_key(db, request);
  if (live instanceof Response) return live;
  if (!reserve_keyed(live.id)) return problem(429, "rate_limited");
  return live;
}

const LIMIT_MSG = "is a whole number from 1 to 100";
const CURSOR_MSG =
  "is a next_cursor this list issued, or left out for the first page";

export function stray_params(
  url: URL,
  allowed: readonly string[],
  issues: FieldError[]
) {
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (seen.has(key)) {
      issues.push({ path: key, message: "is sent once" });
    }
    seen.add(key);
    if (!allowed.includes(key)) {
      issues.push({
        path: key,
        message: "is not a parameter of this action",
      });
    }
  }
}

export function read_limit(url: URL, issues: FieldError[]): number {
  const raw = url.searchParams.get("limit");
  if (raw === null) return 25;
  if (!/^(?:[1-9]\d?|100)$/.test(raw)) {
    issues.push({ path: "limit", message: LIMIT_MSG });
    return 25;
  }
  return Number(raw);
}

export function read_cursor(
  url: URL,
  order: string,
  issues: FieldError[]
): ListCursor | null {
  const raw = url.searchParams.get("cursor");
  if (raw === null) return null;
  const decoded = raw ? decode_list_cursor(raw, order) : null;
  if (!decoded) issues.push({ path: "cursor", message: CURSOR_MSG });
  return decoded;
}

export function refuse(issues: FieldError[]): Response | null {
  return issues.length > 0 ? invalid(issues) : null;
}

export function valid_day(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function read_day(
  url: URL,
  name: "from" | "to",
  issues: FieldError[]
): string | null {
  const raw = url.searchParams.get(name);
  if (raw === null) return null;
  if (!valid_day(raw)) {
    issues.push({ path: name, message: "is a day written YYYY-MM-DD" });
    return null;
  }
  return raw;
}

/** `to` is inclusive: the bound is the start of the next UTC day. */
export function day_window(
  from: string | null,
  to: string | null
): { start: string | null; end: string | null } {
  const start = from ? `${from}T00:00:00.000Z` : null;
  if (!to) return { start, end: null };
  const [y, m, d] = to.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return { start, end: next.toISOString() };
}

export function read_window(url: URL, issues: FieldError[]) {
  const from = read_day(url, "from", issues);
  const to = read_day(url, "to", issues);
  if (from && to && from > to) {
    issues.push({ path: "to", message: "is a day on or after from" });
  }
  return day_window(from, to);
}
