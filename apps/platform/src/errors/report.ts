import * as Sentry from "@sentry/react-router";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { HttpError } from "@/helpers/https";
import { redact } from "./redact";

// user errors (4xx Responses, thrown data() with 4xx status, a refused
// HttpError) are expected and must not page the team. everything else reaches
// sentry — an unrefused HttpError at any status included.
function is_user_error(err: unknown): boolean {
  if (err instanceof HttpError) return err.refused;
  if (err instanceof Response) return err.status >= 400 && err.status < 500;
  if (err && typeof err === "object" && "status" in err) {
    const s = (err as { status: unknown }).status;
    return typeof s === "number" && s >= 400 && s < 500;
  }
  return false;
}

/**
 * a rejection reason is whatever the rejecting code passed, and a plain object
 * that references itself throws here rather than serialising. the client sink
 * is the only capture path — sentry's own capturing integrations are removed
 * in `integrations.ts` — so a throw inside it loses the event outright.
 */
function describe(err: object): string {
  try {
    return JSON.stringify(err) ?? "";
  } catch {
    return Object.prototype.toString.call(err);
  }
}

// a thrown redirect has no url — react-router builds it — so its Location is
// what names it. either keeps only its path: the query can carry input.
function response_error(res: Response): Error {
  const target = res.headers.get("Location") ?? res.url;
  const where = target ? path_of(target) : "";
  return new Error(`Response ${res.status}${where ? ` ${where}` : ""}`);
}

// try, not URL.parse: this runs in donors' browsers, and safari has it from 18.
// an unparseable target leaves the status alone — a throw here loses the report
function path_of(target: string): string {
  try {
    return new URL(target, "https://x").pathname;
  } catch {
    return "";
  }
}

// wrap non-Error throws so sentry gets a stack from the report site.
// handles cross-realm Error objects (instanceof fails across iframes/workers).
function normalize(err: unknown): unknown {
  if (err instanceof Error) return err;
  if (err instanceof Response) return response_error(err);
  if (typeof err === "string") return new Error(err);
  if (err && typeof err === "object") {
    const msg =
      "message" in err &&
      typeof (err as { message: unknown }).message === "string"
        ? (err as { message: string }).message
        : describe(err);
    const wrapped = new Error(msg || "(no message)");
    if (
      "stack" in err &&
      typeof (err as { stack: unknown }).stack === "string"
    ) {
      wrapped.stack = (err as { stack: string }).stack;
    }
    return wrapped;
  }
  return new Error(err === undefined ? "(undefined error)" : String(err));
}

/**
 * safari refuses `ApplePaySession` when a third party embeds `/forms/:id` over
 * plain http, and stripe's availability probe throws it inside a promise nobody
 * owns — so it lands in the unhandled-rejection sink. nothing of ours is broken:
 * apple pay simply doesn't render and every other method works, and http
 * embedders are not a supported configuration. webkit refuses the same way, in
 * other words, when the https embedder is a different origin from the form.
 *
 * both halves are required. the name alone is a generic dom error and keying on
 * it would bury real defects. read as plain properties rather than
 * `instanceof DOMException` because the rejection crosses the embedder's realm,
 * where instanceof fails — the same reasoning `normalize` already carries.
 */
function is_apple_pay_embed_refusal(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  return (
    name === "InvalidAccessError" &&
    typeof message === "string" &&
    /apple pay session from a document with an? (insecure parent frame|different security origin than its top-level frame)/i.test(
      message
    )
  );
}

// pg/neon error fields that name schema, never row values. `detail` and
// `message` are left behind: `Key (email)=(…) already exists` echoes the row.
const PG_FIELDS = ["code", "constraint", "table", "column", "routine"] as const;

/**
 * a failed drizzle query's message ends in `params: …` — every bound value, a
 * donor's email, name and address included — and its stack header repeats it.
 * swapped for the query text plus the pg error's schema-only fields before
 * anything reaches the console or sentry.
 */
function scrub_query_error(err: DrizzleQueryError): Error {
  const scrubbed = new Error(`Failed query: ${err.query}`);
  const header = `${err.name}: ${err.message}`;
  if (err.stack?.startsWith(header)) {
    scrubbed.stack = `Error: ${scrubbed.message}${err.stack.slice(header.length)}`;
  }
  const pg: unknown = err.cause;
  if (pg && typeof pg === "object") {
    for (const f of PG_FIELDS) {
      if (f in pg)
        Object.assign(scrubbed, { [f]: (pg as Record<string, unknown>)[f] });
    }
  }
  return scrubbed;
}

// callers wrap: `new Error("…", { cause })`. the chain is copied down to the
// query error rather than mutated — the caller may still rethrow its error.
function scrub(error: unknown, seen = new Set<unknown>()): unknown {
  if (error instanceof DrizzleQueryError) return scrub_query_error(error);
  if (!(error instanceof Error) || seen.has(error)) return error;
  seen.add(error);
  const cause = scrub(error.cause, seen);
  if (cause === error.cause) return error;
  const copy: Error = Object.create(
    Object.getPrototypeOf(error),
    Object.getOwnPropertyDescriptors(error)
  );
  copy.cause = cause;
  // the copied stack accessor reads the original's internals and comes back
  // undefined on v8, so the copy carries the string itself
  Object.defineProperty(copy, "stack", {
    value: error.stack,
    writable: true,
    configurable: true,
  });
  return copy;
}

function capture(
  raw: unknown,
  level: "error" | "warning",
  raw_context?: Record<string, unknown>
): void {
  const error = redact(scrub(raw));
  const context = redact(raw_context);
  if (level === "error") console.error(error, context);
  else console.warn(error, context);
  if (is_user_error(error)) return;
  // preserve the original non-Error value as extra context so opaque objects aren't lost.
  const extra =
    error instanceof Error || error instanceof Response
      ? context
      : { ...context, original_error: error };
  // bugsink stores and displays level but deliberately does not index it as a
  // searchable tag, so the error/degraded split is carried by a tag of our own.
  Sentry.captureException(normalize(error), {
    level,
    tags: { report: level === "error" ? "bug" : "degraded" },
    ...(extra ? { extra } : {}),
  });
}

export function report_error(
  error: unknown,
  context?: Record<string, unknown>
): void {
  capture(error, "error", context);
}

/**
 * a third party we don't control was unreachable from the visitor's browser —
 * a blocked script, a dropped fetch, an sdk that never came up — or from our
 * server, a provider's host down. nothing in this repo is broken when one
 * fires, and they outnumber real defects by orders of magnitude, so they're
 * kept at warning level and tagged `report:degraded`: `report:bug` stays a
 * queryable list of our own bugs, while a provider outage is still visible as
 * a rate change.
 *
 * only for failures already handled — the caller must have degraded the ui, or
 * answered so the provider retries.
 */
export function report_degraded(
  error: unknown,
  context?: Record<string, unknown>
): void {
  capture(error, "warning", context);
}

/**
 * the `unhandledrejection` sink: a rejection nobody owns, classified before it
 * is levelled. everything unrecognised is still an error — this is a list of
 * known third-party noise, not a filter over our own bugs.
 */
export function report_unhandled(reason: unknown): void {
  if (is_apple_pay_embed_refusal(reason)) {
    report_degraded(reason);
    return;
  }
  report_error(reason);
}

// .catch-friendly variants that report + return a value.

export function report_null(error: unknown): null {
  report_error(error);
  return null;
}

export function report_degraded_null(error: unknown): null {
  report_degraded(error);
  return null;
}

export function report_undefined(error: unknown): undefined {
  report_error(error);
  return undefined;
}

export function report_msg(error: unknown, msg: string): string {
  report_error(error);
  return msg;
}

export function report_obj<T>(error: unknown, value: T): T {
  report_error(error);
  return value;
}

function extract_msg(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "Server Error";
}

export function report_resp(
  error: unknown,
  message?: string,
  status = 500
): Response {
  report_error(error);
  return new Response(message ?? extract_msg(error), { status });
}
