import { Actions, Badge } from "@better-giving/ui";
import { ChevronRight, X } from "lucide-react";
import { type FormEvent, useEffect, useRef } from "react";
import { Link, useFetcher } from "react-router";
import { useRemixForm } from "remix-hook-form";
import { RouteModal } from "#/components/route-modal";
import type { TStatus } from "@/banking";
import type { IUpdate } from "@/banking/schema";

type Props = {
  verdict: Extract<TStatus, "approved" | "rejected">;
};

const fetcher_key = (verdict: Props["verdict"]) =>
  `banking-application-${verdict}`;

export function Prompt(props: Props) {
  const in_flight =
    useFetcher({ key: fetcher_key(props.verdict) }).state !== "idle";
  return (
    <RouteModal classes="bg-popover" busy={in_flight}>
      <Content {...props} />
    </RouteModal>
  );
}

function Content({ verdict }: Props) {
  const fetcher = useFetcher({ key: fetcher_key(verdict) });
  const {
    register,
    formState: { errors },
  } = useRemixForm<IUpdate>({
    defaultValues: { type: verdict },
    fetcher,
  });
  const reason_id = "reject-reason";
  // held, not `disabled`: disabling Submit would blur it onto <body>
  const busy = fetcher.state !== "idle";
  // `busy` lags the submit by a render, so in that gap a second press would
  // send again and Close/Cancel would leave; the latch closes on the press itself
  const sent = useRef(false);
  useEffect(() => {
    if (fetcher.state === "idle") sent.current = false;
  }, [fetcher.state]);
  const hold = (e: { preventDefault(): void }) => {
    if (busy || sent.current) e.preventDefault();
  };
  const submit_once = (e: FormEvent) => {
    if (busy || sent.current) return e.preventDefault();
    sent.current = true;
  };

  return (
    <fetcher.Form
      method="POST"
      onSubmit={submit_once}
      className="grid content-start justify-items-center"
    >
      <input type="hidden" value={verdict} name="type" />
      <div className="relative w-full">
        <h2 className="sm:text-xl font-bold text-center border-b border-hairline p-5">
          Banking application
        </h2>
        <Link
          to=".."
          aria-label="Close"
          aria-disabled={busy}
          onClick={hold}
          className="btn btn-icon btn-secondary absolute top-1/2 right-4 -translate-y-1/2 aria-disabled:pointer-events-none"
        >
          <X className="icon-xl" />
        </Link>
      </div>
      <p className="px-6 pb-4 text-center text-gray-11 mt-4 font-semibold">
        You are about to {verdict} this banking application.
      </p>

      {verdict === "approved" ? (
        <div className="px-6 pb-4 text-center text-gray-11">
          This will immediately payout all pending funds to newly linked bank
          account and is irreversible.
        </div>
      ) : null}

      <div className="flex items-center gap-2 mb-6">
        <Badge>Under review</Badge>
        <ChevronRight className="icon-xl" />
        {verdict === "approved" ? (
          <Badge variant="success">Approved</Badge>
        ) : (
          <Badge variant="destructive">Rejected</Badge>
        )}
      </div>

      {verdict === "rejected" && (
        <div className="px-6 w-full pb-6 grid">
          <label htmlFor={reason_id} className="label mb-2" data-required>
            Reason for rejection:
          </label>
          <textarea
            {...register("reason")}
            id={reason_id}
            className="field-input"
          />
          <span className="empty:hidden text-xs text-destructive-subtle-fg mt-1">
            {errors.reason?.message}
          </span>
        </div>
      )}

      <Actions band>
        <Link
          replace
          preventScrollReset
          to=".."
          aria-disabled={busy}
          onClick={hold}
          className="btn-secondary btn"
        >
          Cancel
        </Link>
        <button
          aria-disabled={busy}
          aria-busy={busy}
          type="submit"
          className={`btn btn-primary ${busy ? "pending" : ""}`}
        >
          {busy ? "Submitting…" : "Submit"}
        </button>
      </Actions>
    </fetcher.Form>
  );
}
