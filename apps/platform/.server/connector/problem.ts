export type ProblemCode =
  | "unknown_action"
  | "key_refused"
  | "rate_limited"
  | "code_invalid"
  | "idempotency_key_required"
  | "idempotency_conflict"
  | "invalid"
  | "not_found"
  | "write_failed"
  | "campaign_ended"
  | "already_published"
  | "confirm_required";

export type FieldError = { path: string; message: string };

/**
 * RFC 9457 body reduced to the fields an integrator switches on.
 * `detail` and `errors` are omitted when absent so the original codes stay
 * `{code, status}`.
 */
export function problem(
  status: number,
  code: ProblemCode,
  extra?: { detail?: string; errors?: FieldError[] }
): Response {
  const body: {
    code: ProblemCode;
    status: number;
    detail?: string;
    errors?: FieldError[];
  } = { code, status };
  if (extra?.detail) body.detail = extra.detail;
  if (extra?.errors && extra.errors.length > 0) body.errors = extra.errors;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/problem+json",
      "cache-control": "no-store",
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
