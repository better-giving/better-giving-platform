import {
  type LoaderFunction,
  type LoaderFunctionArgs,
  redirect,
} from "react-router";
import { safeParse } from "valibot";
import { to_auth } from "#/.server/auth";
import { reg_user } from "#/pages/registration/data/reg-user";
import {
  GRANT_STEP,
  grant_open,
  routes,
  steps,
} from "#/pages/registration/routes";
import type { Reg$IdData } from "#/pages/registration/types";
import { resp } from "@/helpers/https";
import { Progress } from "@/reg/progress";
import { reg_id, type TStatus } from "@/reg/schema";
import { reg_get } from "$/pg/queries/registration";

/** which child of `/register/:reg_id` this request matched. `params` says
 * nothing about it — the layout wraps every child alike — so the grant it hands
 * down has to name the one it is for off the url. */
const matched_child = (url: URL, rid: string): string => {
  const path = url.pathname.replace(/\/$/, "");
  const segs = path.split("/");
  const i = segs.lastIndexOf(rid);
  return i < 0 ? "" : segs.slice(i + 1).join("/");
};

/** the chrome the grant-open children render inside, so it answers to the same
 * authority they do — and to no more of them than they do. */
export const reg_loader: LoaderFunction = async ({ params, request, url }) => {
  const p = safeParse(reg_id, params.reg_id);
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const rid = p.output;

  const ru = await reg_user(request, grant_open.has(matched_child(url, rid)));
  if (!ru) return to_auth(url);
  const { user } = ru;

  const reg = await reg_get(rid);
  // a stale reference is a 404 the applicant can read, not a `{status:404}`
  // the chrome below then destructures a missing row out of
  if (!reg) throw resp.status(404, `reg:${rid} not found`);
  // only owner or admin can view
  if (reg.r_id !== user.email && user.role !== "admin") {
    throw resp.status(403);
  }
  return {
    user,
    reg,
  } satisfies Reg$IdData;
};

interface IWizardExitRow {
  id: string;
  status?: TStatus | null;
  o_name?: string | null;
  status_approved_npo_id?: number | null;
}

/** where a request goes once the application has left the editable states: in
 * review, to the summary that shows it; approved, to the success page. nothing
 * while it is still editable, or for the summary screen (`step` 5) in review.
 * a write names no `step` — it has no screen to stay on. */
export const wizard_exit = (
  reg: IWizardExitRow,
  step?: Progress["step"]
): string | undefined => {
  if (reg.status === "02" && step !== 5) {
    return `/register/${reg.id}/${steps.summary}`;
  }
  if (reg.status === "03") {
    const q = new URLSearchParams({
      name: reg.o_name ?? "",
      id: `${reg.status_approved_npo_id ?? ""}`,
    });
    return `/register/${routes.success}?${q}`;
  }
};

export const step_loader =
  (this_step: Progress["step"]) =>
  async ({ params, request, url }: LoaderFunctionArgs) => {
    const ru = await reg_user(request, this_step === GRANT_STEP);
    if (!ru) return to_auth(url);
    const { user } = ru;
    const p = safeParse(reg_id, params.reg_id);
    if (p.issues) throw resp.status(400, p.issues[0].message);
    const rid = p.output;

    const reg = await reg_get(rid);
    if (!reg) throw resp.status(404);
    // only owner or admin can view
    if (reg.r_id !== user.email && user.role !== "admin") {
      throw resp.status(403);
    }

    const r = new Progress(reg);

    const exit = wizard_exit(reg, this_step);
    if (exit) return redirect(exit);

    if (this_step > r.step) {
      return redirect(`../${r.step}`);
    }

    return reg;
  };
