import { Actions } from "@better-giving/ui";
import { format } from "date-fns";
import { CheckCircle2Icon } from "lucide-react";
import { useFetcher, useNavigate } from "react-router";
import { RouteModal } from "#/components/route-modal";
import type { Route } from "./+types/route";
import type { VoidReason } from "./api";

export { ErrorModal as ErrorBoundary } from "#/components/error";
export { action, loader } from "./api";

const reasons = [
  {
    value: "refunded",
    label: "Refunded",
    hint: "The donor got the full amount back.",
  },
  {
    value: "refunded_loss",
    label: "Refunded at a loss",
    hint: "Funds were already paid out, so the platform absorbed the refund.",
  },
] as const;

const reason_label: Record<VoidReason, string> = {
  refunded: "refunded",
  refunded_loss: "refunded at a loss",
};

export default function Page({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const close = () =>
    navigate("..", { preventScrollReset: true, replace: true });

  return (
    <RouteModal classes="bg-card">
      <Content data={loaderData} on_close={close} />
    </RouteModal>
  );
}

function Content({
  data,
  on_close,
}: {
  data: Route.ComponentProps["loaderData"];
  on_close: () => void;
}) {
  const fetcher = useFetcher<{ ok: boolean }>();
  const submitting = fetcher.state !== "idle";
  const already_voided = !!data.voided_at;

  if (fetcher.data?.ok) {
    return (
      <div className="p-6 sm:p-8 text-center">
        <CheckCircle2Icon className="mx-auto mb-3 text-success pictogram-md" />
        <h3 className="text-lg font-bold mb-1">Match voided</h3>
        <p className="text-sm text-gray-11 mb-4">
          Nothing further is chased or filed for this gift.
        </p>
        <button type="button" onClick={on_close} className="btn btn-primary">
          Close
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="p-6 sm:p-8">
        <h3 className="text-lg font-bold mb-1">Void employer match</h3>
        <p className="text-sm text-gray-11 mb-1">
          Records that this gift went back to the donor outside the app, so no
          match is chased or filed for it.
        </p>
        <p className="text-xs text-gray-11 mb-4">
          {data.company_name || "No employer"} · {data.donation_id} ·{" "}
          {data.status}
        </p>

        {already_voided ? (
          <p className="text-sm">
            Already voided
            {data.voided_at &&
              ` on ${format(new Date(data.voided_at), "MMM d, yyyy")}`}
            {data.void_reason && ` — ${reason_label[data.void_reason]}`}
          </p>
        ) : (
          <fetcher.Form method="post" id="void-match">
            <fieldset className="grid gap-3">
              <legend className="text-sm font-medium mb-2">Reason</legend>
              {reasons.map((r) => (
                <div key={r.value} className="grid gap-1">
                  <label className="radio">
                    <input
                      type="radio"
                      name="reason"
                      value={r.value}
                      defaultChecked={r.value === "refunded"}
                      aria-describedby={`hint-${r.value}`}
                    />
                    <span className="text-sm font-medium">{r.label}</span>
                  </label>
                  {/* pl-8 clears the control the label sits beside: the `radio`
                      utility is a 16px input plus its 16px gap */}
                  <p
                    id={`hint-${r.value}`}
                    className="text-xs text-gray-11 pl-8"
                  >
                    {r.hint}
                  </p>
                </div>
              ))}
            </fieldset>
          </fetcher.Form>
        )}
      </div>

      <Actions band>
        <button
          type="button"
          disabled={submitting}
          onClick={on_close}
          className="btn-secondary btn"
        >
          {already_voided ? "Close" : "Cancel"}
        </button>
        {!already_voided && (
          <button
            type="submit"
            form="void-match"
            disabled={submitting}
            className="btn btn-primary"
          >
            {submitting ? "Voiding..." : "Void match"}
          </button>
        )}
      </Actions>
    </div>
  );
}
