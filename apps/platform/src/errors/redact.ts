// a photo upload link's token is its whole credential (`/photo-upload/:token`
// needs no sign-in), so no log line or error report of ours may carry it.
// Vercel's own request log records the path before any of this code runs.
const PHOTO_TOKEN = /(\/photo-upload\/)[^/?#\s"'<>\\]+/g;

export const redact_text = (text: string): string =>
  text.replace(PHOTO_TOKEN, "$1[redacted]");

/** `value` with every string in it redacted. Plain objects, arrays and errors
 * that held a token are copied, never mutated, and anything that held none is
 * returned as it is; any other object, and a cycle, passes untouched. */
export function redact<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value === "string") return redact_text(value) as T;
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => redact(item, seen));
    return items.some((item, i) => item !== value[i]) ? (items as T) : value;
  }
  if (value instanceof Error) {
    const message = redact_text(value.message);
    const stack = value.stack && redact_text(value.stack);
    const cause = redact(value.cause, seen);
    if (
      message === value.message &&
      stack === value.stack &&
      cause === value.cause
    ) {
      return value;
    }
    const copy: Error = Object.create(
      Object.getPrototypeOf(value),
      Object.getOwnPropertyDescriptors(value)
    );
    copy.message = message;
    // v8's stack is an accessor bound to the original: assigning through the
    // copy reads back undefined, so the copy gets a value of its own
    Object.defineProperty(copy, "stack", {
      value: stack,
      writable: true,
      configurable: true,
    });
    if (cause !== undefined) copy.cause = cause;
    return copy as T;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = redact(v, seen);
    if (out[k] !== v) changed = true;
  }
  return changed ? (out as T) : value;
}
