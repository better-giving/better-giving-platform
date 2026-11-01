import { valibotResolver } from "@hookform/resolvers/valibot";
import { type ActionFunction, href, redirect } from "react-router";
import { getValidatedFormData } from "remix-hook-form";
import { auth, create_unverified_user, get_session } from "#/.server/auth";
import { check_email_url, request_login_link } from "#/.server/auth/login-link";
import { report_undefined } from "#/errors/report";
import { login_url } from "#/helpers/login-url";
import type { IFormInvalid } from "#/types/action";
import { type ISignUp, sign_up } from "#/types/auth";
import { resp } from "@/helpers/https";
import { safe_redirect } from "@/helpers/safe-redirect";
import { evaluate } from "./evaluate";

export const action: ActionFunction = async ({ request, url }) => {
  const fv = await request.formData();
  const redirect_to = safe_redirect(
    url.searchParams.get("redirect"),
    href("/marketplace")
  );

  const { user } = await get_session(request);
  if (user) return redirect(redirect_to);

  if (fv.get("intent") === "oauth") {
    const res = await auth.api.signInSocial({
      body: {
        provider: "google",
        callbackURL: redirect_to,
        // better-auth appends `error`, which the login page explains
        errorCallbackURL: login_url(redirect_to),
      },
      headers: request.headers,
      asResponse: true,
    });
    // must forward set-cookie so browser receives state/pkce cookie
    // https://www.better-auth.com/docs/reference/errors/state_mismatch
    const location = res.headers.get("location");
    if (location) {
      const headers = new Headers();
      const cookie = res.headers.get("set-cookie");
      if (cookie) headers.set("set-cookie", cookie);
      return redirect(location, { headers });
    }
    return redirect(redirect_to);
  }

  const p = await getValidatedFormData<ISignUp>(fv, valibotResolver(sign_up));
  if (p.errors) return p;

  // honeypot validation - reject if the honeypot field is filled
  if (p.data.middle_name && p.data.middle_name !== "") {
    console.warn("Honeypot triggered - potential bot submission detected");
    // a bare 400 rather than a field message, to avoid revealing the honeypot
    throw resp.status(400);
  }

  const evl = await evaluate({
    first_name: p.data.first_name,
    last_name: p.data.last_name,
    email: p.data.email,
  }).catch(report_undefined);

  console.info(evl);

  if (evl?.is_spam) {
    if (evl.field === "first_name") {
      return {
        receivedValues: p.receivedValues,
        errors: { first_name: { type: "value", message: evl.explanation } },
      } satisfies IFormInvalid<ISignUp>;
    }
    if (evl.field === "last_name") {
      return {
        receivedValues: p.receivedValues,
        errors: { last_name: { type: "value", message: evl.explanation } },
      } satisfies IFormInvalid<ISignUp>;
    }
    return {
      receivedValues: p.receivedValues,
      errors: { email: { type: "value", message: evl.explanation } },
    } satisfies IFormInvalid<ISignUp>;
  }

  const email = p.data.email.toLowerCase();
  // same door the public lead form uses. a verified owner falls through to the
  // link below, which signs them in — so the screen never differs and the form
  // is not an account-enumeration oracle.
  // an anonymous form: the headers carry the client ip both throttles key on,
  // and both refuse silently so this screen stays the same either way
  await create_unverified_user({
    email,
    first_name: p.data.first_name,
    last_name: p.data.last_name,
    headers: request.headers,
  });

  await request_login_link({ email, redirect_to, headers: request.headers });
  return redirect(check_email_url({ email, redirect_to }));
};
