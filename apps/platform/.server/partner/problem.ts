export const PROBLEM_CODES = [
  "key_invalid",
  "invalid_request",
  "not_found",
  "idempotency_conflict",
  "fee_not_ready",
  "authorization_expired",
  "unsupported",
  "coin_not_accepted",
  "below_minimum",
  "above_maximum",
  "rate_limited",
  "provider_error",
] as const;

export type ProblemCode = (typeof PROBLEM_CODES)[number];

/** the codes whose answer needs a value of its own go through their own
 * constructor below, so a caller can't send one without it */
type PlainCode = Exclude<
  ProblemCode,
  "below_minimum" | "rate_limited" | "provider_error"
>;

export type FieldError = { path: string; message: string };

const STATUS: Record<PlainCode, number> = {
  key_invalid: 401,
  invalid_request: 400,
  not_found: 404,
  idempotency_conflict: 409,
  fee_not_ready: 409,
  authorization_expired: 410,
  unsupported: 422,
  coin_not_accepted: 422,
  above_maximum: 422,
};

/** `error.message` when a problem carries no `detail` */
const DEFAULT_MESSAGE: Record<ProblemCode, string> = {
  key_invalid: "The API key is missing, malformed or revoked.",
  invalid_request: "The request is invalid. Fix the listed fields and retry.",
  not_found: "The requested resource was not found.",
  idempotency_conflict:
    "This Idempotency-Key was already used with a different request.",
  fee_not_ready: "The fee for this payment is not ready yet. Retry shortly.",
  authorization_expired:
    "This authorization has expired. Start a new one and retry.",
  unsupported: "This request is not supported for this nonprofit.",
  coin_not_accepted: "This coin is not accepted.",
  below_minimum: "The amount is below the minimum.",
  above_maximum: "The amount is above the maximum.",
  rate_limited: "Too many requests. Wait for retry-after seconds, then retry.",
  provider_error:
    "Better Giving or its payment provider hit an error. Retry later.",
};

interface Extra {
  detail?: string;
  errors?: FieldError[];
}

/**
 * RFC 9457 body reduced to the fields an integrator switches on, in the
 * connector's shape (`.server/connector/problem.ts`): `code` and `status`,
 * with `error: {code, message}` beside them so one parser reads both surfaces.
 * `detail` and `errors` are omitted when absent.
 */
function build(
  status: number,
  code: ProblemCode,
  extra: Extra & { minimum_minor?: number } = {},
  headers?: Record<string, string>
): Response {
  const body: Record<string, unknown> = {
    code,
    status,
    error: { code, message: extra.detail || DEFAULT_MESSAGE[code] },
  };
  if (extra.detail) body.detail = extra.detail;
  if (extra.errors && extra.errors.length > 0) body.errors = extra.errors;
  if (extra.minimum_minor !== undefined) {
    body.minimum_minor = extra.minimum_minor;
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/problem+json",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

/** RFC 9110 §11.6.1: a 401 carries the challenge for the scheme it wants */
const HEADERS: Partial<Record<PlainCode, Record<string, string>>> = {
  key_invalid: { "www-authenticate": "Bearer" },
};

export function problem(code: PlainCode, extra?: Extra): Response {
  return build(STATUS[code], code, extra, HEADERS[code]);
}

export function below_minimum(minimum_minor: number, detail?: string) {
  return build(422, "below_minimum", { detail, minimum_minor });
}

export function rate_limited(retry_after_s: number): Response {
  return build(
    429,
    "rate_limited",
    {},
    {
      "retry-after": String(retry_after_s),
    }
  );
}

export function provider_error(
  status: 500 | 502 | 503 | 504,
  detail?: string
): Response {
  return build(status, "provider_error", { detail });
}
