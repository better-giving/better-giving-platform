import { valibotResolver } from "@hookform/resolvers/valibot";
import { MinusIcon, PlusIcon } from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";
import type { IComposition } from "@/nav";
import { to_bals } from "../helpers";
import { type FV, fv, type Tx } from "../types";
import { FieldCell } from "./field-cell";

interface Props {
  init?: FV;
  composition: IComposition;
  classes?: string;
  on_submit: (fv: FV) => void;
}

const default_tx: Tx = {
  tx_id: "",
  out_id: "",
  out_qty: "",
  in_id: "",
  in_qty: "",
  price: "",
  fee: "",
};

export function RebalanceForm({
  init,
  classes,
  composition,
  on_submit,
}: Props) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FV>({
    resolver: valibotResolver(fv),
    defaultValues: init || {
      txs: [default_tx],
      bals: to_bals(composition),
    },
  });

  const txs = useFieldArray({ control, name: "txs" });

  return (
    <form
      id="rebalance-form"
      onSubmit={handleSubmit((x) => on_submit(x))}
      className={`${classes} grid p-4`}
    >
      <div className="mb-2">
        <p className="text-sm font-bold">Tickers</p>
        <p className="font-mono text-sm text-gray-11">
          {Object.keys(composition)
            .map((x) => x.toLowerCase())
            .join(" ")}
        </p>
      </div>
      <div className="table-scroll pb-4">
        <table className="table">
          <thead>
            <tr className="text-xs text-left">
              <th>
                <button
                  aria-label="Add transaction row"
                  className="align-middle"
                  type="button"
                  onClick={() => txs.append(default_tx)}
                >
                  <PlusIcon className="stroke-success icon-md" />
                </button>
              </th>
              <th>Out</th>
              <th>In</th>
              <th>Out qty</th>
              <th>In qty</th>
              <th>Price</th>
              <th>ID</th>
              <th>Fee</th>
            </tr>
          </thead>
          <tbody>
            {txs.fields.map((tx, idx) => {
              return (
                <tr key={tx.id}>
                  <td>
                    <button
                      type="button"
                      aria-label={`Remove transaction row ${idx + 1}`}
                      onClick={() => txs.remove(idx)}
                      className="px-2 align-middle"
                    >
                      <MinusIcon className="stroke-destructive icon-md" />
                    </button>
                  </td>
                  <FieldCell
                    placeholder="bndx"
                    {...register(`txs.${idx}.out_id`)}
                    error={errors.txs?.[idx]?.out_id?.message}
                  />
                  <FieldCell
                    placeholder="cash"
                    {...register(`txs.${idx}.in_id`)}
                    error={errors.txs?.[idx]?.in_id?.message}
                  />
                  <FieldCell
                    placeholder="2.023"
                    {...register(`txs.${idx}.out_qty`)}
                    error={errors.txs?.[idx]?.out_qty?.message}
                  />
                  <FieldCell
                    placeholder="100"
                    {...register(`txs.${idx}.in_qty`)}
                    error={errors.txs?.[idx]?.in_qty?.message}
                  />
                  <FieldCell
                    placeholder="49.42"
                    {...register(`txs.${idx}.price`)}
                    error={errors.txs?.[idx]?.price?.message}
                  />
                  <FieldCell
                    placeholder="tx123abc.."
                    {...register(`txs.${idx}.tx_id`)}
                    error={errors.txs?.[idx]?.tx_id?.message}
                  />
                  <FieldCell
                    placeholder="0.24"
                    {...register(`txs.${idx}.fee`)}
                    error={errors.txs?.[idx]?.fee?.message}
                  />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-destructive-subtle-fg text-xs mt-1 empty:hidden">
        {errors.txs?.root?.message}
      </p>
    </form>
  );
}
