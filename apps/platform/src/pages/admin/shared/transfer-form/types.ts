import * as v from "valibot";
import { amount } from "../amount";
export const sources = ["liq", "lock"] as const;
const source = v.picklist(sources, "Please select source");

const bals = v.object({
  liq: v.number(),
  lock: v.number(),
});
interface Bals extends v.InferOutput<typeof bals> {}

export type Source = v.InferOutput<typeof source>;

const schema_raw = v.object({
  amount,
  source,
  /** internal  */
  bals,
});
export const schema = v.pipe(
  schema_raw,
  v.forward(
    v.partialCheck(
      [["amount"], ["bals"], ["source"]],
      ({ amount, bals, source }) => {
        const bal = bals[source];
        return +amount <= bal;
      },
      "amount exceeds balance"
    ),
    ["amount"]
  )
);

export interface Schema extends v.InferOutput<typeof schema> {}
export interface SubmitFV extends Omit<Schema, "bals"> {}

export interface Props {
  /** preset */
  from?: Source;
  bals: Bals;
  onSubmit: (fv: SubmitFV) => void;
  is_submitting?: boolean;
  /** the server's refusal of the last submit — shown on the amount field */
  error?: string;
}
