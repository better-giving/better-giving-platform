import { valibotResolver } from "@hookform/resolvers/valibot";
import { redirect } from "react-router";
import { getValidatedFormData } from "remix-hook-form";
import { get_session, to_auth } from "#/.server/auth";
import { reg_cookie } from "#/.server/cookie";
import type { IRegResumeFv } from "@/reg";
import { Progress } from "@/reg/progress";
import { reg_resume_fv } from "@/reg/schema";
import { stripe as stripe_env } from "$/env";
import { reg_get } from "$/pg/queries/registration";

export const resume_application = async (
  request: Request,
  url: URL,
  fd: FormData
) => {
  const { user } = await get_session(request);
  if (!user) return to_auth(url);

  const fv = await getValidatedFormData<IRegResumeFv>(
    fd,
    valibotResolver(reg_resume_fv)
  );
  if (fv.errors) return fv;

  const reg = await reg_get(fv.data.reference);
  // a reference someone else holds answers exactly as a reference nobody
  // holds: the strip must not confirm that an id exists to whoever guesses it.
  if (!reg || (reg.r_id !== user.email && user.role !== "admin")) {
    return {
      errors: {
        reference: {
          type: "not_found",
          message: "we couldn't find an application with that reference",
        },
      },
    };
  }

  /** set existing reference user inputs */
  const rc = await reg_cookie
    .parse(request.headers.get("cookie"))
    .then((x) => x || {});
  rc.reference = reg.id;

  // absolute: this action lives at /register, so a "../" hop would leave the
  // registration tree entirely.
  return redirect(
    `/register/${reg.id}/${new Progress(reg, stripe_env.connect_routing).step}`,
    {
      headers: {
        "set-cookie": await reg_cookie.serialize(rc),
      },
    }
  );
};
