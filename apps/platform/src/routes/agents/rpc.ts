export function jsonrpc(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}

/** `data.code` is the stable, machine-readable name; `message` is for people */
export function rpc_error(
  id: unknown,
  code: number,
  message: string,
  data: { code: string; [detail: string]: unknown },
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
