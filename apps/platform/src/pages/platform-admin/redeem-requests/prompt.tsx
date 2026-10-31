import { Actions } from "@better-giving/ui";
import { ChevronRight, X } from "lucide-react";
import {
  type FormEvent,
  type PropsWithChildren,
  useEffect,
  useRef,
} from "react";
import { Link, useFetcher, useParams } from "react-router";
import { RouteModal } from "#/components/route-modal";

type Props = {
  verdict: "approve" | "reject";
};

export function Prompt(props: Props) {
  const { tx_id } = useParams();
  const fetcher_key = `tx-request-${tx_id}-${props.verdict}`;
  const in_flight = useFetcher({ key: fetcher_key }).state !== "idle";
  return (
    <RouteModal classes="bg-card" busy={in_flight}>
      {/* keyed: the route stays mounted across requests, and the latch from
          one must not swallow the first press on the next */}
      <Content key={tx_id} fetcher_key={fetcher_key} {...props} />
    </RouteModal>
  );
}

interface IContent extends Props {
  fetcher_key: string;
}

function Content({ verdict, fetcher_key }: IContent) {
  const fetcher = useFetcher({ key: fetcher_key });
  // held, not `disabled`: disabling Submit would blur it onto <body>
  const busy = fetcher.state !== "idle";
  // `busy` lags the submit by a render, so in that gap a second press would
  // send again and Close/Back would leave; the latch closes on the press itself
  const sent = useRef(false);
  useEffect(() => {
    if (fetcher.state === "idle") sent.current = false;
  }, [fetcher.state]);
  const hold = (e: { preventDefault(): void }) => {
    if (busy || sent.current) e.preventDefault();
  };
  const submit_once = (e: FormEvent) => {
    // `busy` too: back on a request still in flight, the remount starts unlatched
    if (busy || sent.current) return e.preventDefault();
    sent.current = true;
  };

  return (
    <fetcher.Form
      method="POST"
      onSubmit={submit_once}
      className="grid content-start justify-items-center"
    >
      <input type="hidden" value={verdict} name="verdict" />
      <div className="relative w-full">
        <h2 className="sm:text-xl font-bold text-center border-b border-hairline bg-gray-3 p-5">
          Redeem units request
        </h2>
        <Link
          to=".."
          aria-label="Close"
          aria-disabled={busy}
          onClick={hold}
          className="border p-2 rounded absolute top-1/2 right-4 transform -translate-y-1/2 aria-disabled:text-gray-11"
        >
          <X className="size-4.5 sm:size-6" />
        </Link>
      </div>
      <p className="px-6 pb-4 text-center text-gray-11 mt-4 font-semibold">
        You are about to {verdict} this request.
      </p>

      <div className="flex items-center gap-2 mb-6">
        <Status classes="bg-gray-11">Pending</Status>
        <ChevronRight className="icon-xl" />
        {verdict === "approve" ? (
          <Status classes="bg-success">Approved</Status>
        ) : (
          <Status classes="bg-destructive">Cancelled</Status>
        )}
      </div>

      <Actions band>
        <Link
          replace
          preventScrollReset
          to=".."
          aria-disabled={busy}
          onClick={hold}
          className="btn-secondary btn"
        >
          Back
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

function Status(props: PropsWithChildren<{ classes?: string }>) {
  return (
    <div
      className={`${
        props.classes ?? ""
      } text-primary-fg px-2 py-1 text-xs uppercase rounded`}
    >
      {props.children}
    </div>
  );
}
