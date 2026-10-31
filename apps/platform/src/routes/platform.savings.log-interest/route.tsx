import { Actions } from "@better-giving/ui";
import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { RouteModal } from "#/components/route-modal";
import { LogForm } from "./log-form";
import { Review } from "./review";
import type { State } from "./types";

export { ErrorModal as ErrorBoundary } from "#/components/error";
export { action } from "./api";

// keyed, so the modal shell reads the submission Content makes
const fetcher_key = "log-interest";

export default function Page() {
  const fetcher = useFetcher({ key: fetcher_key });
  return (
    <RouteModal
      size="lg"
      title="Log interest"
      busy={fetcher.state !== "idle"}
      classes="bg-card"
    >
      <Content />
    </RouteModal>
  );
}

function Content() {
  const [state, setState] = useState<State>({ type: "form" });
  const fetcher = useFetcher({ key: fetcher_key });
  const hold = (e: { preventDefault(): void }) => {
    if (fetcher.state !== "idle") e.preventDefault();
  };

  return (
    <div>
      {state.type === "form" && (
        <LogForm
          init={state.fv}
          on_submit={(x, y) => setState({ type: "review", fv: x, shares: y })}
        />
      )}
      {state.type === "review" && (
        <Review amount={+state.fv.total} shares={state.shares} />
      )}

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
            disabled={fetcher.state !== "idle"}
            className="btn-secondary btn"
            type="button"
            onClick={() => setState((x) => ({ ...x, type: "form" }))}
          >
            Edit
          </button>
        )}
        <button
          disabled={fetcher.state !== "idle"}
          form={state.type === "form" ? "log-interest-form" : undefined}
          type={state.type === "form" ? "submit" : "button"}
          onClick={
            state.type === "review"
              ? () =>
                  fetcher.submit(state.fv, {
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
