import { type ActionFunction, href, redirect } from "react-router";
import { auth } from "#/.server/auth";
import { login_url } from "#/helpers/login-url";
import { safe_redirect } from "@/helpers/safe-redirect";

/** `redirect` from the form, else the query: where to sign back in to */
const asked_return = async (request: Request) => {
  const form = await request.formData().catch(() => null);
  const field = form?.get("redirect");
  if (typeof field === "string") return field;
  return new URL(request.url).searchParams.get("redirect");
};

export const action: ActionFunction = async ({ request }) => {
  const back = safe_redirect(await asked_return(request), null);
  const to = back ? login_url(back) : href("/marketplace");
  const session = await auth.api.getSession({ headers: request.headers });
  // already signed out (another tab): same destination, no cookie to clear
  // not to_auth: its sign-in returns to /logout, which has no loader
  if (!session) return redirect(to);

  const res = await auth.api.signOut({
    headers: request.headers,
    asResponse: true,
  });

  const headers = new Headers();
  const cookie = res.headers.get("set-cookie");
  if (cookie) headers.set("set-cookie", cookie);
  return redirect(to, { headers });
};
