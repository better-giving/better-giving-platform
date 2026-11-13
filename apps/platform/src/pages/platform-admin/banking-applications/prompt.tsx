import { Actions, Badge, CheckField } from "@better-giving/ui";
import { ChevronRight, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { useRemixForm } from "remix-hook-form";
import { RouteModal } from "#/components/route-modal";
import type { TStatus } from "@/banking";
import type { IUpdate } from "@/banking/schema";

interface IConfirmHolder {
  holder: string;
  /** "" when the npo has no legal name on file */
  legal_name: string;
}

type Props = {
  verdict: Extract<TStatus, "approved" | "rejected">;
  /** the account's holder isn't the npo's legal name, or there is no legal
   * name to check it against: approving takes a tick that the reviewer
   * confirmed it, which the action refuses without */
  confirm_holder?: IConfirmHolder;
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

function Content({ verdict, confirm_holder }: Props) {
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
  const [confirmed, set_confirmed] = useState(false);
  const unconfirmed = !!confirm_holder && !confirmed;
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
    if (busy || sent.current || unconfirmed) return e.preventDefault();
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
          <Badge tone="success">Approved</Badge>
        ) : (
          <Badge tone="destructive">Rejected</Badge>
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

      {confirm_holder && (
        <div className="px-6 pb-6 grid gap-3 w-full">
          <dl className="bg-warning-subtle border border-amber-6 rounded-card px-4 py-3 text-sm text-warning-subtle-fg">
            <div className="flex gap-2 flex-wrap">
              <dt className="font-bold">Account holder</dt>
              <dd>{confirm_holder.holder}</dd>
            </div>
            <div className="flex gap-2 flex-wrap">
              <dt className="font-bold">Legal name</dt>
              <dd>{confirm_holder.legal_name || "No legal name on file"}</dd>
            </div>
          </dl>
          <CheckField
            name="confirm_holder"
            value="true"
            checked={confirmed}
            onChange={(e) => set_confirmed(e.target.checked)}
            classes={{ input: "self-start mt-0.5", label: "text-sm" }}
          >
            I've confirmed with the nonprofit that its payouts should go to{" "}
            {confirm_holder.holder}'s account.
          </CheckField>
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
          aria-disabled={busy || unconfirmed}
          aria-busy={busy}
          type="submit"
          onClick={(e) => {
            if (unconfirmed) e.preventDefault();
          }}
          className={`btn btn-primary aria-disabled:bg-gray-3 aria-disabled:text-gray-11 ${busy ? "pending" : ""}`}
        >
          {busy ? "Submitting…" : "Submit"}
        </button>
      </Actions>
    </fetcher.Form>
  );
}
