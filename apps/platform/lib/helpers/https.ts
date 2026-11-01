/** marks a 4xx body as written for the person on the other end */
const REFUSAL_HEADER = "x-refusal";

class Resp {
  json(x: object, status = 200, headers?: Record<string, string>) {
    return new Response(JSON.stringify(x), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  }
  status(status: number, text?: string): Response {
    text && console.info(`[resp] ${status} - ${text}`);
    return new Response(text, { status, statusText: text });
  }
  /** a failure the client reads off `fetcher.data`. json, so the status
   * survives the boundary — react-router hands a bare `Response` body to the
   * client as text only, and `is_user_error` needs the status to keep a 4xx
   * off sentry. */
  fail(status: number, message: string) {
    return this.json({ status, message }, status);
  }
  txt(x: string, status = 200): Response {
    return new Response(x, {
      status,
      headers: { "content-type": "text/plain" },
    });
  }
  /** a refusal `json_ok` surfaces verbatim — word it for the donor */
  refuse(message: string, status = 400): Response {
    return new Response(message, {
      status,
      headers: { "content-type": "text/plain", [REFUSAL_HEADER]: "1" },
    });
  }
  err(status: number, x: string): Response {
    return this.txt(x, status);
  }
}

export const resp = new Resp();

/**
 * a non-ok response. `refused` — the route's own donor-worded refusal, which
 * is then the message and stays off sentry; any other carries `HTTP <status>`,
 * never for a donor's eyes.
 */
export class HttpError extends Error {
  override name = "HttpError";
  readonly refused: boolean;
  constructor(
    readonly status: number,
    refusal?: string
  ) {
    super(refusal || `HTTP ${status}`);
    this.refused = !!refusal;
  }
}

/**
 * parsed body of an ok response; otherwise throws `HttpError`. only a 4xx
 * built by `resp.refuse` with a non-empty body is `refused` — any other body
 * (an internal `resp.status` string, an edge/firewall page, a 5xx) is left
 * out, and the caller decides what to show when it isn't.
 */
export async function json_ok<T>(res: Response): Promise<T> {
  if (res.ok) return res.json();
  const is_refusal = res.status < 500 && res.headers.has(REFUSAL_HEADER);
  const txt = is_refusal ? (await res.text().catch(() => "")).trim() : "";
  throw new HttpError(res.status, txt);
}

type R = { [k: string]: string | undefined };

export function search<T extends { [k: string]: string }>(
  search: URLSearchParams
): T;
export function search<T extends R>(url: URL): T;
export function search<T extends R>(search: URLSearchParams): T;
export function search<T extends R>(url_str: string): T;
export function search<T extends R>(input: URLSearchParams | URL | string): T {
  let x: URLSearchParams;
  if (input instanceof URLSearchParams) {
    x = input;
  } else if (input instanceof URL) {
    x = input.searchParams;
  } else {
    x = new URL(input).searchParams;
  }
  return Object.fromEntries(x.entries()) as T;
}

export const sans_https = (x: string | null | undefined) =>
  x?.replace(/^https:\/\//, "");
