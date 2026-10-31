import { Field, Modal } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import * as v from "valibot";
import { humanize, rd2num } from "@/helpers/decimal";
import { DialogActions } from "./dialog-actions";
import { RowSummary } from "./row-summary";
import type { IOwedRow } from "./types";
import { use_submit_once } from "./use-submit-once";

export interface ICredit {
  usd: number;
  reason: string;
  ref: string;
}

export interface ICreditDialog {
  open: boolean;
  row: IOwedRow | null;
  /** true while the credit request is in flight: holds the dialog open */
  submitting: boolean;
  /** the refusal the last request came back with */
  error?: string;
  on_submit: (values: ICredit) => void;
  on_close: () => void;
  /** see `Modal`'s `returnFocusFallback` */
  return_focus_fallback?: () => HTMLElement | null;
}

const required_text = v.pipe(v.string(), v.trim(), v.nonEmpty("required"));

/** `max` is the outstanding as the summary shows it, cents rounded down */
const credit_schema = (max: number) => {
  const range = `between $0.01 and $${humanize(max)}`;
  return v.object({
    // checked as text and converted at submit: the installed resolver's types
    // hand the handler the input shape, so a transform here would be untyped
    usd: v.pipe(
      v.string(),
      v.trim(),
      v.nonEmpty("required"),
      v.check((s) => {
        const n = Number(s);
        return Number.isFinite(n) && n >= 0.01 && n <= max;
      }, range)
    ),
    reason: required_text,
    ref: required_text,
  });
};

export function CreditDialog({
  open,
  row,
  submitting,
  on_close,
  return_focus_fallback,
  ...rest
}: ICreditDialog) {
  return (
    <Modal
      open={open}
      onClose={on_close}
      busy={submitting}
      returnFocusFallback={return_focus_fallback}
      classes="bg-card"
    >
      {row && (
        <Body
          key={row.id}
          row={row}
          submitting={submitting}
          on_close={on_close}
          {...rest}
        />
      )}
    </Modal>
  );
}

interface IBody
  extends Pick<
    ICreditDialog,
    "submitting" | "error" | "on_submit" | "on_close"
  > {
  row: IOwedRow;
}

function Body({ row, submitting, error, on_submit, on_close }: IBody) {
  const max = rd2num(row.outstanding_usd);
  const schema = useMemo(() => credit_schema(max), [max]);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<v.InferOutput<typeof schema>>({
    resolver: valibotResolver(schema),
    defaultValues: { usd: "", reason: "", ref: "" },
  });
  const submit_once = use_submit_once(submitting, error);

  return (
    <form
      onSubmit={handleSubmit((x) =>
        submit_once(() => on_submit({ ...x, usd: Number(x.usd) }))
      )}
    >
      <div className="p-6 sm:p-8 grid gap-4">
        <div>
          <h3 className="text-lg font-bold mb-1">Credit amount owed</h3>
          <p className="text-sm text-gray-11">
            Takes an amount off what this row owes.
          </p>
        </div>
        <RowSummary row={row} amount_label="Outstanding" />
        <Field
          {...register("usd")}
          label="Amount (USD)"
          required
          inputMode="decimal"
          placeholder="0.00"
          classes={{ input: "w-full" }}
          error={errors.usd?.message}
        />
        <Field
          {...register("reason")}
          type="textarea"
          label="Reason"
          required
          rows={3}
          classes={{ input: "w-full" }}
          error={errors.reason?.message}
        />
        <Field
          {...register("ref")}
          label="Reference"
          sub="What the credit answers to, such as a payout or transfer id. Each credit on this row needs its own reference."
          required
          classes={{ input: "w-full" }}
          error={errors.ref?.message}
        />
      </div>
      <DialogActions
        submitting={submitting}
        error={error}
        label="Credit"
        busy_label="Crediting…"
        tone="btn-primary"
        on_close={on_close}
      />
    </form>
  );
}
