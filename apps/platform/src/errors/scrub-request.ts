export const FILTERED = "[Filtered]";

// what an error report keeps from the incoming request. everything else on a
// request through Vercel is a credential or proxy secret (`x-vercel-oidc-token`,
// `x-vercel-proxy-signature`, `x-vercel-sc-*`, `x-vercel-firewall-bypass`) or a
// session (`cookie`, `authorization`), so this is an allowlist: a header Vercel
// adds next year is filtered until someone puts it here.
const SAFE_HEADERS = new Set([
  "accept",
  "accept-language",
  "content-type",
  "content-length",
  "user-agent",
  "referer",
  "host",
  "x-vercel-id",
  "x-forwarded-proto",
]);

// a query parameter whose name has one of these words in it is a credential:
// `access_token`, `api_key`, `x-vercel-protection-bypass`, an OAuth `code`
const SECRET_PARAM_WORDS = new Set([
  "token",
  "secret",
  "key",
  "apikey",
  "sig",
  "signature",
  "auth",
  "authorization",
  "password",
  "session",
  "code",
  "jwt",
  "otp",
  "bypass",
  "credential",
  "credentials",
]);

const is_secret_param = (name: string): boolean => {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name.replace(/\+/g, " "));
  } catch {}
  return decoded
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((word) => SECRET_PARAM_WORDS.has(word));
};

/** `a=1&token=x` → `a=1&token=[Filtered]`, the rest byte for byte */
const scrub_query = (query: string): string =>
  query
    .split("&")
    .map((pair) => {
      const name = pair.split("=", 1)[0]!;
      return is_secret_param(name) ? `${name}=${FILTERED}` : pair;
    })
    .join("&");

const scrub_url = (url: string): string => {
  const q = url.indexOf("?");
  if (q === -1) return url;
  const hash = url.indexOf("#", q);
  const end = hash === -1 ? url.length : hash;
  return `${url.slice(0, q + 1)}${scrub_query(url.slice(q + 1, end))}${url.slice(end)}`;
};

type QueryParams =
  | string
  | Record<string, string>
  | Array<[string, string]>
  | undefined;

const scrub_query_params = (params: QueryParams): QueryParams => {
  if (typeof params === "string") {
    return scrub_query(params.startsWith("?") ? params.slice(1) : params);
  }
  if (Array.isArray(params)) {
    return params.map(([k, v]) => [k, is_secret_param(k) ? FILTERED : v]);
  }
  if (params && typeof params === "object") {
    return Object.fromEntries(
      Object.entries(params).map(([k, v]) => [
        k,
        is_secret_param(k) ? FILTERED : v,
      ])
    );
  }
  return params;
};

const filter_values = (
  record: Record<string, string>,
  keep: (name: string) => boolean
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(record).map(([k, v]) => [k, keep(k) ? v : FILTERED])
  );

type RequestData = {
  url?: string;
  query_string?: QueryParams;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  env?: Record<string, string>;
};

/** `event` with its `request` copied so that only allowlisted header values,
 * no cookie value, no `env`, and no credential-named query parameter survive.
 * the original event is not mutated; an event with no `request` is returned as
 * it is. */
export function scrub_request<T extends { request?: RequestData }>(
  event: T
): T {
  if (!event.request) return event;
  const { env: _env, ...request } = event.request;
  if (request.headers) {
    request.headers = filter_values(request.headers, (name) =>
      SAFE_HEADERS.has(name.toLowerCase())
    );
  }
  if (request.cookies) {
    request.cookies = filter_values(request.cookies, () => false);
  }
  if (typeof request.url === "string") request.url = scrub_url(request.url);
  if (request.query_string !== undefined) {
    request.query_string = scrub_query_params(request.query_string);
  }
  return { ...event, request };
}
