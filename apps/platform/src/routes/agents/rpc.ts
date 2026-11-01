export function jsonrpc(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}

/** every `data.code` a JSON-RPC error here can carry; the guide's Errors
 * section lists them and the agents test holds it to this list */
export const RPC_ERROR_CODES = [
  "parse_error",
  "invalid_request",
  "method_not_found",
  "method_not_allowed",
  "tool_not_found",
  "invalid_params",
  "rate_limited",
  "internal_error",
] as const;

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number];

/** `data.code` is the stable, machine-readable name; `message` is for people */
export function rpc_error(
  id: unknown,
  code: number,
  message: string,
  data: { code: RpcErrorCode; [detail: string]: unknown },
  init?: ResponseInit
) {
  return Response.json(
    { jsonrpc: "2.0", id, error: { code, message, data } },
    init
  );
}

/** `allow` is the mount's own: `/agents` also serves its guide on GET */
export function method_not_allowed(method: string, allow: string) {
  return rpc_error(
    null,
    -32600,
    `Method ${method} not allowed. Send JSON-RPC requests with POST.`,
    { code: "method_not_allowed" },
    { status: 405, headers: { allow } }
  );
}
