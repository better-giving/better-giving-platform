/** a request carrying every secret Vercel and the auth layer put on one, as
 * Sentry's request data integration copies it onto `event.request` */
export const vercel_request = () => ({
  url: "https://www.better.giving/api/x?page=2&access_token=zz-tok1-zz&x-vercel-protection-bypass=zz-byp1-zz#top",
  method: "POST",
  query_string:
    "page=2&access_token=zz-tok1-zz&x-vercel-protection-bypass=zz-byp1-zz",
  headers: {
    accept: "text/html",
    "accept-language": "en-US",
    "content-type": "application/json",
    "content-length": "42",
    "user-agent": "Mozilla/5.0",
    referer: "https://www.better.giving/",
    host: "www.better.giving",
    "x-vercel-id": "iad1::abc-123",
    "x-forwarded-proto": "https",
    authorization: "Bearer zz-secret-bearer-zz",
    cookie: "__Secure-better-auth.session_token=zz-sess1-zz",
    "set-cookie": "a=b",
    "x-vercel-oidc-token": "zz-oidc-secret-zz",
    "x-vercel-proxy-signature": "Bearer zz-proxy-sig-zz",
    "x-vercel-proxy-signature-ts": "zz-1700000000-zz",
    "x-vercel-sc-headers": "zz-sc-secret-zz",
    "x-vercel-sc-host": "zz-sc-host-secret-zz",
    "X-Vercel-Firewall-Bypass": "zz-fw-secret-zz",
    "x-real-ip": "203.0.113.7",
  },
  cookies: {
    "__Secure-better-auth.session_token": "zz-sess1-zz",
    theme: "light",
  },
  env: { REMOTE_ADDR: "203.0.113.7" },
});

export const SAFE = [
  "accept",
  "accept-language",
  "content-type",
  "content-length",
  "user-agent",
  "referer",
  "host",
  "x-vercel-id",
  "x-forwarded-proto",
];

export const SECRETS = [
  "zz-tok1-zz",
  "zz-byp1-zz",
  "zz-secret-bearer-zz",
  "zz-sess1-zz",
  "zz-oidc-secret-zz",
  "zz-proxy-sig-zz",
  "zz-1700000000-zz",
  "zz-sc-secret-zz",
  "zz-sc-host-secret-zz",
  "zz-fw-secret-zz",
  "203.0.113.7",
];
