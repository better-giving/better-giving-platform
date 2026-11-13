import { redirect } from "react-router";
import { safeParse } from "valibot";
import { to_auth } from "#/.server/auth";
import { change_identity } from "#/pages/registration/change-identity";
import { reg_user } from "#/pages/registration/data/reg-user";
import { routes, steps } from "#/pages/registration/routes";
import { resp } from "@/helpers/https";
import type { IRegStartFv } from "@/reg";
import { Progress } from "@/reg/progress";
import { EDITABLE, reg_id } from "@/reg/schema";
import { stripe as stripe_env } from "$/env";
import { reg_get } from "$/pg/queries/registration";
import type { Route } from "./+types/route";

/* answers to a draft grant, like the contact step does. the identity summary
 * offers "Change" to a lead whose address is not proven yet, and a link that
 * lands them on /signup is the one correction they cannot make. */
export const loader = async ({ params, request, url }: Route.LoaderArgs) => {
  const ru = await reg_user(request, true);
  if (!ru) return to_auth(url);
  const { user } = ru;
  const p = safeParse(reg_id, params.reg_id);
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const reg = await reg_get(p.output);
  if (!reg) throw resp.status(404);
  if (reg.r_id !== user.email && user.role !== "admin") {
    throw resp.status(403);
  }

  if (reg.status === "03") {
    const to = `../../${routes.success}?name=${reg.o_name}&id=${reg.status_approved_npo_id}`;
    return redirect(to);
  }
  // in review: the wizard is read-only, and so is the identity. a rejected
  // one stays open, as every other step does for its resubmit.
  if (!reg.status || !EDITABLE.includes(reg.status)) {
    return redirect(`../${steps.summary}`);
  }

  /* a row with no `o_type` at all predates the column, so nothing on it says
   * which branch it belonged to except an hq country that isn't the one the
   * US branch pins. */
  const o_type: IRegStartFv["o_type"] =
    reg.o_type ??
    (reg.o_hq_country && reg.o_hq_country !== "United States"
      ? "other"
      : "501c3");

  return {
    /** where "Cancel" goes back to */
    step: new Progress(reg, stripe_env.connect_routing).step,
    values: {
      o_type,
      o_ein: reg.o_ein ?? "",
      // the US branch pins this to "United States"; showing it in the country
      // field would make it look like a choice the applicant made.
      o_hq_country: o_type === "other" ? (reg.o_hq_country ?? "") : "",
      o_registration_number: reg.o_registration_number ?? "",
    } satisfies IRegStartFv,
  };
};

export const action = async ({ params, request, url }: Route.ActionArgs) =>
  change_identity(request, url, params.reg_id, await request.formData());
