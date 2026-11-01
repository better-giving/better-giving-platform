import { addDays } from "date-fns";
import { data, type LoaderFunctionArgs } from "react-router";
import { reg_cookie } from "#/.server/cookie";
import { getToast } from "#/.server/toast";
import { search } from "@/helpers/https";

// only sets cookie when value changes to allow Vercel CDN caching
async function append_referrer(
  referrer: string,
  cookie_header: string | null
): Promise<string | null> {
  const rc = await reg_cookie.parse(cookie_header).then((x) => x || {});

  // already has this referrer
  if (rc.referrer === referrer) return null;

  // has different unexpired referrer - keep the original
  if (rc.referrer && rc.referrer_expiry) {
    const expiry = new Date(rc.referrer_expiry);
    if (expiry > new Date()) return null;
  }

  // set new referrer
  rc.referrer = referrer;
  rc.referrer_expiry = addDays(new Date(), 90).toISOString();
  return reg_cookie.serialize(rc);
}

export const loader = async ({ request, url }: LoaderFunctionArgs) => {
  const { referrer } = search(url);
  const cookie_header = request.headers.get("cookie");

  // a first-time visitor arriving on a referral link has no cookies at all —
  // gating on cookie_header would drop the referral before it is ever stored
  const rc = referrer ? await append_referrer(referrer, cookie_header) : null;

  // getToast always commits the session (emits Set-Cookie). only call it when
  // an incoming toast cookie exists, so cold requests stay CDN-cacheable.
  const has_toast_cookie = cookie_header?.includes("bg-toast=") ?? false;
  const { toast, headers: toast_headers } = has_toast_cookie
    ? await getToast(request)
    : { toast: undefined, headers: new Headers() };

  const headers = new Headers();
  if (rc) headers.append("set-cookie", rc);
  // forward toast session commit whenever the cookie was present, even if no
  // active toast — otherwise a stale/consumed bg-toast cookie never clears and
  // the user is stuck off-CDN on every request.
  if (has_toast_cookie) {
    for (const v of toast_headers.getSetCookie()) {
      headers.append("set-cookie", v);
    }
  }
  const has_headers = !!rc || has_toast_cookie;
  return data({ toast }, has_headers ? { headers } : undefined);
};
