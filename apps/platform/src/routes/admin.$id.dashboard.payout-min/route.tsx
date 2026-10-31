import { Field } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useForm } from "react-hook-form";
import type { MetaFunction } from "react-router";
import { useFetcher, useSearchParams } from "react-router";
import * as v from "valibot";
import { RouteModal } from "#/components/route-modal";
import { endowUpdate } from "#/pages/admin/endow-update-action";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import { search } from "@/helpers/https";
import type { INpoUpdate } from "@/npo";
import { min_payout_amount } from "@/npo/schema";

interface IContent {
  prev: number;
}

export { ErrorModal as ErrorBoundary } from "#/components/error";
export const action = endowUpdate({ redirect: ".." });

export const amount = v.pipe(
  v.string(),
  v.transform((x) => +x),
  v.minValue(min_payout_amount, (x) => `minimum is $${x.requirement}`),
  v.transform((x) => x.toString())
);

export const meta: MetaFunction = ({ matches }) =>
  admin_page_meta("Payout threshold", matches);

export default function PayoutMin() {
  const [params] = useSearchParams();
  const { min = min_payout_amount } = search(params);

  return (
    <RouteModal classes="grid bg-card text-gray-12 p-6">
      <Content prev={+min} />
    </RouteModal>
  );
}

function Content(props: IContent) {
  const fetcher = useFetcher();

  const {
    handleSubmit,
    register,
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
      <h4 className="mb-2">Payout threshold</h4>

      <Field
        sub="Grant amount to accumulate to trigger payout"
        required
        label="Amount"
        placeholder="e.g. $100"
        {...register("amount")}
        error={errors.amount?.message}
        classes="mb-4"
      />

      <button
        type="submit"
        disabled={fetcher.state !== "idle" || !isDirty}
        className="btn btn-primary"
      >
        {fetcher.state !== "idle" ? "Submitting..." : "Submit"}
      </button>
    </form>
  );
}
