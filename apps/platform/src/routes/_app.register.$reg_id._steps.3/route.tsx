import { redirect } from "react-router";
import { step_loader } from "#/pages/registration/data/step-loader";
import { next_step, steps } from "#/pages/registration/routes";
import { update_action } from "#/pages/registration/update-action";
import { Progress } from "@/reg/progress";
import { stripe as stripe_env } from "$/env";
import type { Route } from "./+types/route";
import { FsaForm } from "./fsa";

export { ErrorBoundary } from "#/components/error";

/** the agreement is the one conditional step — `Progress` lets a 501(c)(3) past
 * it (a seeded identity already opens banking), so `step_loader`'s "not that
 * far yet" guard never fires here and a stale link would sit a US applicant in
 * front of an agreement it has no business signing. redirect forward only, and
 * only when `Progress` puts the visitor past 3: `step_loader` owns the backward
 * direction and sends anyone at or below 3 back here, so a forward redirect
 * outside that gate ping-pongs into a hard error page. stored rows exist as
 * 501c3-with-no-EIN, and with no `o_type` at all — both sit AT 3, fall through
 * to the form, and cannot finish it: `docs_fsa` requires `"other"`. */
export const loader = async (args: Route.LoaderArgs) => {
  const res = await step_loader(3)(args);
  if (res instanceof Response) return res;
  const past_this_step = new Progress(res, stripe_env.connect_routing).step > 3;
  if (res.o_type === "501c3" && past_this_step) {
    return redirect(`../${steps.banking}`);
  }
  return res;
};

export const action = update_action(next_step[3]);

export default function Page({ loaderData: reg }: Route.ComponentProps) {
  return <FsaForm {...reg} />;
}
