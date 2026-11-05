import { redirect } from "react-router";
import { parseFormData } from "remix-hook-form";
import { to_auth } from "#/.server/auth";
import { reg_cookie } from "#/.server/cookie";
import { reg_user } from "#/pages/registration/data/reg-user";
import { new_application } from "#/pages/registration/new-application";
import { resume_application } from "#/pages/registration/resume-application";
import { Progress } from "@/reg/progress";
import { stripe as stripe_env } from "$/env";
import { reg_latest } from "$/pg/queries/registration";
import type { Route } from "./+types/route";

export const loader = async ({ request, url }: Route.LoaderArgs) => {
  const ru = await reg_user(request, true);
  if (!ru) return to_auth(url);

  /* a lead who closed the tab before opening the mail arrives here holding
   * only a grant. this screen starts an application and offers to resume one
   * by reference, and they can do neither — they have no session to start
   * under, and no reference unless `reg_cookie` happened to survive. the row
   * they already have is the only thing here for them, so hand it straight
   * back.
   *
   * resolved from the grant's own address rather than that cookie, which is
   * unsigned and client-writable and so decides nothing about who this is. */
  if (ru.grant) {
    const reg = await reg_latest(ru.user.email);
    if (!reg) return to_auth(url);
    return redirect(
      `/register/${reg.id}/${new Progress(reg, stripe_env.connect_routing).step}`
    );
  }

  const rc = await reg_cookie
    .parse(request.headers.get("cookie"))
    .then((x) => x || {});
  return { reference: rc.reference ?? "" };
};

/** the screen has two independent submissions — starting an application and
 * resuming one — each driven by its own fetcher so their errors and pending
 * states never bleed into one another. `intent` picks the handler. */
export const action = async ({ request, url }: Route.ActionArgs) => {
  const fd = await request.formData();
  const { intent } = await parseFormData<{ intent?: string }>(fd);

  if (intent === "resume") return resume_application(request, url, fd);
  return new_application(request, url, fd);
};
