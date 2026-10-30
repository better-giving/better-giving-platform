import { type ActionFunction, href, redirect } from "react-router";
import { auth, to_auth } from "#/.server/auth";
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
  const session = await auth.api.getSession({ headers: request.headers });
  // already signed out (another tab): the sign-in it was headed for still holds
  if (!session) return back ? redirect(login_url(back)) : to_auth(request);

  const res = await auth.api.signOut({
    headers: request.headers,
    asResponse: true,
  });

  const headers = new Headers();
  const cookie = res.headers.get("set-cookie");
  if (cookie) headers.set("set-cookie", cookie);
  return redirect(back ? login_url(back) : href("/marketplace"), { headers });
};
