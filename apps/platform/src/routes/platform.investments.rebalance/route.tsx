import { Actions } from "@better-giving/ui";
import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { RouteModal } from "#/components/route-modal";
import type { ILog } from "@/nav";
import type { Route } from "./+types/route";
import { RebalanceForm } from "./form";
import { Review } from "./review";
import type { State } from "./types";

export { ErrorModal as ErrorBoundary } from "#/components/error";
export { action, loader } from "./api";

// keyed, so the modal shell reads the submission Content makes
const fetcher_key = "rebalance";

export default function Page({ loaderData: data }: Route.ComponentProps) {
  const fetcher = useFetcher({ key: fetcher_key });
  return (
    <RouteModal
      size="lg"
      title="Rebalance investments"
      busy={fetcher.state !== "idle"}
      classes="bg-card"
    >
      <Content {...data} />
    </RouteModal>
  );
}

function Content(props: ILog) {
  const [state, setState] = useState<State>({ type: "form" });
  const fetcher = useFetcher({ key: fetcher_key });
  const hold = (e: { preventDefault(): void }) => {
    if (fetcher.state !== "idle") e.preventDefault();
  };

  return (
    <div>
      {state.type === "form" && (
        <RebalanceForm
          composition={props.composition}
          init={state.data}
          on_submit={(x) => setState({ type: "review", data: x })}
        />
      )}
      {state.type === "review" && <Review fv={state.data} ltd={props} />}

      <Actions band>
        {state.type === "form" ? (
          <Link
            replace
            preventScrollReset
            to=".."
            aria-disabled={fetcher.state !== "idle"}
            onClick={hold}
            className="btn-secondary btn"
          >
            Back
          </Link>
        ) : (
          <button
            className="btn-secondary btn"
            type="button"
            onClick={() => setState((x) => ({ ...x, type: "form" }))}
          >
            Edit
          </button>
        )}
        <button
          disabled={fetcher.state !== "idle"}
          form={state.type === "form" ? "rebalance-form" : undefined}
          type={state.type === "form" ? "submit" : "button"}
          onClick={
            state.type === "review"
              ? () =>
                  fetcher.submit(state.data.txs, {
                    method: "post",
                    encType: "application/json",
                  })
              : undefined
          }
          className="btn btn-primary"
        >
          {state.type === "form" ? "Review" : "Submit"}
        </button>
      </Actions>
    </div>
  );
}
