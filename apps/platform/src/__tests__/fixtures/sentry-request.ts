/** a server event whose request carries every secret Vercel and the auth layer
 * put on one, as Sentry's request data integration copies it onto
 * `event.request`, plus an outgoing fetch breadcrumb with an API key in its
 * query */
export const vercel_event = () => ({
  request: {
    url: "https://www.better.giving/api/x?page=2&access_token=zz-tok1-zz&x-vercel-protection-bypass=zz-byp1-zz#top",
    method: "POST",
    query_string:
      "page=2&access_token=zz-tok1-zz&x-vercel-protection-bypass=zz-byp1-zz",
    headers: {
      accept: "text/html",
      "accept-language": "en-US",
      "content-type": "application/json",
      "content-length": "42",
      "User-Agent": "Mozilla/5.0",
      referer: "https://www.better.giving/sign-in?callbackCode=zz-ref-zz&a=1",
      host: "www.better.giving",
      "x-vercel-id": "iad1::abc-123",
      "x-forwarded-proto": "https",
      authorization: "Bearer zz-secret-bearer-zz",
      cookie: "__Secure-better-auth.session_token=zz-sess1-zz",
      "set-cookie": "zz-set-cookie-zz",
      "x-vercel-oidc-token": "zz-oidc-secret-zz",
      "x-vercel-proxy-signature": "Bearer zz-proxy-sig-zz",
      "x-vercel-proxy-signature-ts": "zz-1700000000-zz",
      "x-vercel-sc-headers": "zz-sc-secret-zz",
      "x-vercel-sc-host": "zz-sc-host-secret-zz",
      "X-Vercel-Firewall-Bypass": "zz-fw-secret-zz",
      "x-real-ip": "zz-real-ip-zz",
    },
    cookies: {
      "__Secure-better-auth.session_token": "zz-sess1-zz",
      theme: "zz-theme-zz",
    },
    env: { REMOTE_ADDR: "zz-env-ip-zz" },
    data: { email: "a@b.test", password: "zz-password-zz" },
  },
  breadcrumbs: [
    {
      category: "http",
      type: "http",
      data: {
        url: "https://finnhub.io/api/v1/quote",
        "http.method": "GET",
        "http.query": "?symbol=AAPL&token=zz-finnhub-zz",
      },
    },
  ],
});

/** `vercel_event().request.headers` as it must leave: allowlisted values kept
 * (the referer's credential param filtered), every other value filtered */
export const FILTERED_HEADERS = {
  accept: "text/html",
  "accept-language": "en-US",
  "content-type": "application/json",
  "content-length": "42",
  "User-Agent": "Mozilla/5.0",
  referer: "https://www.better.giving/sign-in?callbackCode=[Filtered]&a=1",
  host: "www.better.giving",
  "x-vercel-id": "iad1::abc-123",
  "x-forwarded-proto": "https",
  authorization: "[Filtered]",
  cookie: "[Filtered]",
  "set-cookie": "[Filtered]",
  "x-vercel-oidc-token": "[Filtered]",
  "x-vercel-proxy-signature": "[Filtered]",
  "x-vercel-proxy-signature-ts": "[Filtered]",
  "x-vercel-sc-headers": "[Filtered]",
  "x-vercel-sc-host": "[Filtered]",
  "X-Vercel-Firewall-Bypass": "[Filtered]",
  "x-real-ip": "[Filtered]",
};

/** every secret value in `vercel_event()`; none may appear in what leaves */
export const SECRETS = [
  "zz-tok1-zz",
  "zz-byp1-zz",
  "zz-ref-zz",
  "zz-secret-bearer-zz",
  "zz-sess1-zz",
  "zz-set-cookie-zz",
  "zz-oidc-secret-zz",
  "zz-proxy-sig-zz",
  "zz-1700000000-zz",
  "zz-sc-secret-zz",
  "zz-sc-host-secret-zz",
  "zz-fw-secret-zz",
  "zz-real-ip-zz",
  "zz-theme-zz",
  "zz-env-ip-zz",
  "zz-password-zz",
  "zz-finnhub-zz",
];
