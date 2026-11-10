import { Field } from "@ark-ui/react/field";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useController, useForm } from "react-hook-form";
import { useFetcher, useSearchParams } from "react-router";
import * as v from "valibot";
import { useMoneyInput } from "#/components/money-field";
import { RouteModal } from "#/components/route-modal";
import { config } from "#/pages/user-dashboard/referrals/config";
import { search } from "@/helpers/https";
import { $req } from "@/schemas";
import { amount_num } from "@/schemas/amount";
import type { Route } from "./+types/route";

interface IContent {
  prev: number;
}

export { ErrorModal as ErrorBoundary } from "#/components/error";
export { action, loader } from "./api";

export default function Page({ loaderData: user }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const { pay_min = "50" } = user;
  const { min = pay_min } = search(params);

  return (
    <RouteModal classes="grid bg-popover text-gray-12 p-6">
      <Content prev={+min} />
    </RouteModal>
  );
}

export const schema = v.object({
  amount: v.lazy((x) => {
    if (!x) return $req;
    return v.pipe(
      $req,
      // whole dollars: the `pay_min` column is an integer
      amount_num(0),
      v.minValue(config.pay_min, `pay_minimum of $${config.pay_min}`),
      v.transform((x) => x.toString())
    );
  }),
});
interface FV extends v.InferOutput<typeof schema> {}

function Content(props: IContent) {
  const fetcher = useFetcher({ key: "bal-mov" });

  const {
    handleSubmit,
    control,
    formState: { errors, isDirty },
  } = useForm<FV>({
    defaultValues: { amount: props.prev.toString() || "" },
    resolver: valibotResolver(schema),
  });
  const { field } = useController({ control, name: "amount" });
  const money = useMoneyInput({
    value: field.value,
    onChange: field.onChange,
    places: 0,
    ref: field.ref,
  });

  return (
    <form
      onSubmit={handleSubmit(async ({ amount }) => {
        fetcher.submit(amount, { method: "put", encType: "text/plain" });
      })}
      className="contents"
    >
      <h4 className="mb-2">Payout threshold</h4>

      <Field.Root className="grid my-4">
        <Field.Label className="mb-1">
          Amount
          <span className="text-destructive-subtle-fg"> *</span>
        </Field.Label>
        <input
          placeholder="e.g. $ 100"
          name={field.name}
          onBlur={field.onBlur}
          {...money}
          className="field-input"
        />
        <span className="text-destructive-subtle-fg text-xs text-right empty:hidden mt-1">
          {errors.amount?.message}
        </span>
      </Field.Root>
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
