import { type ActionFunction, href, redirect } from "react-router";
import { get_session } from "#/.server/auth";
import { request_login_link } from "#/.server/auth/login-link";
import { search } from "@/helpers/https";
import type { Route } from "./+types/route";

export const loader = async ({ request, url }: Route.LoaderArgs) => {
  const { user } = await get_session(request);
  if (user?.emailVerified) return redirect(href("/marketplace"));

  const { email, redirect: redirect_to, stale } = search(url);
  if (!email) return redirect(href("/signup"));

  return { email, redirect_to: redirect_to ?? "", stale: stale === "1" };
};

export const action: ActionFunction = async ({ request }) => {
  const fv = await request.formData();
  const email = fv.get("email")?.toString();
  if (!email) return redirect(href("/signup"));
  const redirect_to = fv.get("redirect")?.toString() || undefined;

  // resend is an anonymous endpoint — the headers carry the client ip the
  // throttle in `request_login_link` keys on
  await request_login_link({ email, redirect_to, headers: request.headers });

  // the counter resets off this
  return { time_remaining: 30 };
};
