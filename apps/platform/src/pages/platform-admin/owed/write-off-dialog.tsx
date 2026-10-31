import { Field, Modal } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useForm } from "react-hook-form";
import * as v from "valibot";
import { DialogActions } from "./dialog-actions";
import { RowSummary } from "./row-summary";
import type { IOwedRow } from "./types";
import { use_submit_once } from "./use-submit-once";

export interface IWriteOff {
  reason: string;
}

export interface IWriteOffDialog {
  open: boolean;
  row: IOwedRow | null;
  /** true while the write-off request is in flight: holds the dialog open */
  submitting: boolean;
  /** the refusal the last request came back with */
  error?: string;
  on_submit: (values: IWriteOff) => void;
  on_close: () => void;
  /** see `Modal`'s `returnFocusFallback` */
  return_focus_fallback?: () => HTMLElement | null;
}

const schema = v.object({
  reason: v.pipe(v.string(), v.trim(), v.nonEmpty("required")),
});

export function WriteOffDialog({
  open,
  row,
  submitting,
  on_close,
  return_focus_fallback,
  ...rest
}: IWriteOffDialog) {
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
          error={rest.error}
          on_submit={rest.on_submit}
        />
      )}
    </Modal>
  );
}

interface IBody
  extends Pick<
    IWriteOffDialog,
    "submitting" | "error" | "on_submit" | "on_close"
  > {
  row: IOwedRow;
}

function Body({ row, submitting, error, on_submit, on_close }: IBody) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<IWriteOff>({
    resolver: valibotResolver(schema),
    defaultValues: { reason: "" },
  });
  const submit_once = use_submit_once(submitting, error);

  return (
    <form
      onSubmit={handleSubmit((values) => submit_once(() => on_submit(values)))}
    >
      <div className="p-6 sm:p-8 grid gap-4">
        <div>
          <h3 className="text-lg font-bold mb-1">Write off amount owed</h3>
          <p className="text-sm text-gray-11">
            Sets what this row owes to $0 and books it as a loss.
          </p>
        </div>
        <RowSummary row={row} amount_label="To write off" />
        <Field
          {...register("reason")}
          type="textarea"
          label="Reason"
          required
          rows={3}
          classes={{ input: "w-full" }}
          error={errors.reason?.message}
        />
      </div>
      <DialogActions
        submitting={submitting}
        error={error}
        label="Write off"
        busy_label="Writing off…"
        tone="btn-destructive"
        on_close={on_close}
      />
    </form>
  );
}
