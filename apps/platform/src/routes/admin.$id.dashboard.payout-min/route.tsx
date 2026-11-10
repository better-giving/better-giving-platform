import { valibotResolver } from "@hookform/resolvers/valibot";
import { X } from "lucide-react";
import { useForm } from "react-hook-form";
import type { MetaFunction } from "react-router";
import { Link, useFetcher, useSearchParams } from "react-router";
import * as v from "valibot";
import { MoneyField } from "#/components/money-field";
import { RouteModal } from "#/components/route-modal";
import { endowUpdate } from "#/pages/admin/endow-update-action";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import { search } from "@/helpers/https";
import type { INpoUpdate } from "@/npo";
import { min_payout_amount } from "@/npo/schema";
import { amount_num } from "@/schemas/amount";

interface IContent {
  prev: number;
}

export { ErrorModal as ErrorBoundary } from "#/components/error";
export const action = endowUpdate({ redirect: ".." });

export const amount = v.pipe(
  amount_num(),
  v.minValue(min_payout_amount, (x) => `minimum is $${x.requirement}`),
  v.transform((x) => x.toString())
);

export const meta: MetaFunction = ({ matches }) =>
  admin_page_meta("Payout threshold", matches);

// keyed, so the modal shell reads the submission Content makes
const fetcher_key = "payout-min";

export default function PayoutMin() {
  const [params] = useSearchParams();
  const { min = min_payout_amount } = search(params);
  const fetcher = useFetcher({ key: fetcher_key });

  return (
    <RouteModal
      busy={fetcher.state !== "idle"}
      classes="grid bg-popover text-gray-12 p-6"
    >
      <Content prev={+min} />
    </RouteModal>
  );
}

function Content(props: IContent) {
  const fetcher = useFetcher({ key: fetcher_key });
  const busy = fetcher.state !== "idle";
  const hold = (e: { preventDefault(): void }) => {
    if (busy) e.preventDefault();
  };

  const {
    handleSubmit,
    control,
    formState: { errors, isDirty },
  } = useForm({
    defaultValues: { amount: props.prev.toString() || "" },
    resolver: valibotResolver(v.object({ amount })),
  });

  return (
    <form
      onSubmit={handleSubmit(async ({ amount }) => {
        fetcher.submit({ payout_minimum: +amount } satisfies INpoUpdate, {
          method: "PATCH",
          encType: "application/json",
        });
      })}
      className="contents"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <h4>Payout threshold</h4>
        <Link
          to=".."
          replace
          preventScrollReset
          aria-label="Close"
          aria-disabled={busy}
          onClick={hold}
          className="btn btn-icon btn-secondary aria-disabled:pointer-events-none"
        >
          <X className="icon-xl" />
        </Link>
      </div>

      <MoneyField
        sub="Grant amount to accumulate to trigger payout"
        required
        label="Amount (USD)"
        placeholder="e.g. $100"
        control={control}
        name="amount"
        error={errors.amount?.message}
        classes="mb-4"
      />

      <button
        type="submit"
        disabled={busy || !isDirty}
        className="btn btn-primary"
      >
        {busy ? "Submitting..." : "Submit"}
      </button>
    </form>
  );
}
