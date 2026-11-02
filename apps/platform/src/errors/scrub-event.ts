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
// `access_token`, `apiKey`, `x-vercel-protection-bypass`, an OAuth `code`
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
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((word) => SECRET_PARAM_WORDS.has(word));
};

/** `a=1&token=x` → `a=1&token=[Filtered]`, the rest byte for byte; a leading
 * `?` (how a breadcrumb's `http.query` arrives) is kept */
const scrub_query = (query: string): string => {
  const lead = query.startsWith("?") ? "?" : "";
  return (
    lead +
    query
      .slice(lead.length)
      .split("&")
      .map((pair) => {
        const name = pair.split("=", 1)[0]!;
        return is_secret_param(name) ? `${name}=${FILTERED}` : pair;
      })
      .join("&")
  );
};

/** `url` with every credential-named query parameter's value filtered */
export const scrub_url = (url: string): string => {
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
  if (typeof params === "string") return scrub_query(params);
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

const scrub_headers = (
  headers: Record<string, string>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).map(([k, v]) => {
      const name = k.toLowerCase();
      if (!SAFE_HEADERS.has(name)) return [k, FILTERED];
      // the previous page's full url, query string included
      return [k, name === "referer" ? scrub_url(v) : v];
    })
  );

type RequestData = {
  url?: string;
  query_string?: QueryParams;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  env?: Record<string, string>;
  data?: unknown;
};

type Breadcrumb = { data?: Record<string, unknown> };

// an outgoing fetch's breadcrumb keeps its query apart from its url, raw, and
// an API key can ride in it (finnhub's `?token=`)
const scrub_breadcrumb = <B extends Breadcrumb>(crumb: B): B => {
  const query = crumb.data?.["http.query"];
  if (typeof query !== "string") return crumb;
  return {
    ...crumb,
    data: { ...crumb.data, "http.query": scrub_query(query) },
  };
};

/** `event` with its `request` and breadcrumbs copied so that only allowlisted
 * header values survive, no cookie value, `env` or request body does, and no
 * credential-named query parameter does in the request url, its query string,
 * the referer or an outgoing request's breadcrumb. the original event is not
 * mutated. */
export function scrub_event<
  T extends { request?: RequestData; breadcrumbs?: Breadcrumb[] },
>(event: T): T {
  const out = { ...event };
  if (event.breadcrumbs)
    out.breadcrumbs = event.breadcrumbs.map(scrub_breadcrumb);
  if (!event.request) return out;
  const { env: _env, data: _data, ...request } = event.request;
  if (request.headers) request.headers = scrub_headers(request.headers);
  if (request.cookies) {
    request.cookies = Object.fromEntries(
      Object.keys(request.cookies).map((k) => [k, FILTERED])
    );
  }
  if (typeof request.url === "string") request.url = scrub_url(request.url);
  if (request.query_string !== undefined) {
    request.query_string = scrub_query_params(request.query_string);
  }
  out.request = request;
  return out;
}
