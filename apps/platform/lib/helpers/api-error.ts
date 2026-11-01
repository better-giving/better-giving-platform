/** the public api's error codes, each with the one status it answers with */
export const API_ERROR_STATUS = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  rate_limited: 429,
  internal_error: 500,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

export type ApiErrorBody = { error: { code: ApiErrorCode; message: string } };

/** the public api's error response. `no-store` unless `headers` says otherwise */
export function api_error(
  code: ApiErrorCode,
  message: string,
  headers?: Record<string, string>
): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return new Response(JSON.stringify(body), {
    status: API_ERROR_STATUS[code],
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    },
  });
}
