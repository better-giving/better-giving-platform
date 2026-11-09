import { Outlet, useFetcher } from "react-router";
import { FormNotice } from "#/pages/@sections/form-notice";
import { step_loader } from "#/pages/registration/data/step-loader";
import type { Route } from "./+types/route";
import { EndowmentStatus } from "./endowment-status";
import { Step } from "./step";

export { ErrorBoundary } from "#/components/error";
export { submit_action as action } from "./submit-action";
export const loader = step_loader(5);

export default function Page({ loaderData: reg }: Route.ComponentProps) {
  const fetcher = useFetcher({ key: "reg-sub" });

  const is_steps_disabled = fetcher.state !== "idle" || reg.status === "02";
  // a refusal is `resp.fail`'s body; a landed submit answers `{ first }`
  const refusal: string | undefined =
    fetcher.state === "idle" ? fetcher.data?.message : undefined;

  return (
    <div className="grid">
      <h3 className="text-lg mb-2">Summary</h3>
      <p className="text-sm mb-8">
        {reg.status === "04" && //keep bottom margin
          "If you are happy with the details you have submitted, click continue. If you wish to check, click update as required."}
      </p>

      <Step num={1} disabled={is_steps_disabled} />
      <Step num={2} disabled={is_steps_disabled} />
      {/* a 501(c)(3) never signed an agreement — no row to send it back to */}
      {reg.o_type === "other" && <Step num={3} disabled={is_steps_disabled} />}
      <Step num={4} disabled={is_steps_disabled} />

      {refusal && <FormNotice classes="mt-6">{refusal}</FormNotice>}
      <EndowmentStatus status={reg.status} classes="mt-6" />
      {/** render prompts */}
      <Outlet />
    </div>
  );
}
