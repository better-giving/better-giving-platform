export type ProblemCode =
  | "unknown_action"
  | "key_refused"
  | "rate_limited"
  | "code_invalid"
  | "idempotency_key_required"
  | "idempotency_conflict"
  | "idempotency_in_progress"
  | "internal_error"
  | "invalid"
  | "not_found"
  | "write_failed"
  | "campaign_ended"
  | "already_published"
  | "confirm_required"
  | "stale_read";

export type FieldError = { path: string; message: string };

/** `error.message` when a problem carries no `detail` */
const DEFAULT_MESSAGE: Record<ProblemCode, string> = {
  unknown_action: "This connector action does not exist.",
  key_refused: "The API key is missing or no longer valid.",
  rate_limited: "Too many requests. Wait a moment, then retry.",
  code_invalid: "The authorization code is invalid, expired or already used.",
  idempotency_key_required: "This request needs an Idempotency-Key header.",
  idempotency_conflict:
    "This Idempotency-Key was already used with a different request.",
  idempotency_in_progress:
    "A request with this Idempotency-Key is still running.",
  internal_error:
    "Better Giving hit an error and could not complete this request.",
  invalid: "The request is invalid.",
  not_found: "The requested resource was not found.",
  write_failed: "The change could not be saved.",
  campaign_ended: "This campaign has ended.",
  already_published: "This campaign is already published.",
  confirm_required: "This change needs confirmation before it is made.",
  stale_read: "This resource changed after it was read. Read it again.",
};

/**
 * RFC 9457 body reduced to the fields an integrator switches on.
 * `detail` and `errors` are omitted when absent so the original codes stay
 * `{code, status}`. `error` repeats the code beside a message in the public
 * api's `{error: {code, message}}` shape, so one parser reads both surfaces.
 */
export function problem(
  status: number,
  code: ProblemCode,
  extra?: {
    detail?: string;
    errors?: FieldError[];
    headers?: Record<string, string>;
  }
): Response {
  const body: {
    code: ProblemCode;
    status: number;
    detail?: string;
    errors?: FieldError[];
    error: { code: ProblemCode; message: string };
  } = {
    code,
    status,
    error: { code, message: extra?.detail || DEFAULT_MESSAGE[code] },
  };
  if (extra?.detail) body.detail = extra.detail;
  if (extra?.errors && extra.errors.length > 0) body.errors = extra.errors;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/problem+json",
      "cache-control": "no-store",
      ...extra?.headers,
    },
  });
}

export function invalid(
  errors: FieldError[],
  detail = "The request is invalid."
): Response {
  return problem(422, "invalid", { detail, errors });
}

export function not_found(detail: string): Response {
  return problem(404, "not_found", { detail });
}

export function campaign_ended(): Response {
  return problem(409, "campaign_ended", {
    detail: "This campaign has ended, and an ended campaign stays ended.",
  });
}

export function stale_read(): Response {
  return problem(409, "stale_read", {
    detail:
      "This campaign changed after it was read. Read it again with get_campaign, then send the change against that version.",
  });
}
