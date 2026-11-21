import { DateField, Field, Modal, Select } from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { format } from "date-fns";
import { useMemo } from "react";
import {
  type Control,
  useController,
  useForm,
  useWatch,
} from "react-hook-form";
import * as v from "valibot";
import { useMoneyInput } from "#/components/money-field";
import { DialogActions } from "#/pages/platform-admin/owed/dialog-actions";
import { use_submit_once } from "#/pages/platform-admin/owed/use-submit-once";
import { toPP } from "@/helpers/date";
import { snap, to_units } from "@/helpers/decimal";
import { WIRE_PROVIDERS } from "@/payouts";
import type { IManualWireRow, IWirePayout } from "./types";
import { usd } from "./wires-table";

export interface IMarkWiredValues {
  /** YYYY-MM-DD */
  wire_date: string;
  wire_fee: number;
  provider: string;
  provider_tx_id: string;
  amount_sent: number;
}

export interface IMarkWiredDialog {
  open: boolean;
  row: IManualWireRow | null;
  /** who the wire can be sent through */
  providers?: readonly string[];
  /** true while the request is in flight: holds the dialog open */
  submitting: boolean;
  /** the refusal the last request came back with */
  error?: string;
  on_submit: (values: IMarkWiredValues) => void;
  on_close: () => void;
  /** see `Modal`'s `returnFocusFallback` */
  return_focus_fallback?: () => HTMLElement | null;
}

/** a deduction as the summary writes it: "−$612.40", "−$0.00" when none; a
 * negative one (an addition) prints unsigned */
const less = (n: number) => (n < 0 ? usd(-n) : `−${usd(n)}`);

/** what the wire must carry: the net total less the fee; a blank fee is $0 */
const to_send = (net: number, fee: string) => snap(net - (Number(fee) || 0));

const required_text = v.pipe(v.string(), v.trim(), v.nonEmpty("required"));

const wired_schema = (net: number, providers: readonly string[]) =>
  v.pipe(
    v.object({
      wire_date: v.pipe(v.string(), v.nonEmpty("required")),
      // money is checked as the plain decimal the mask stores and converted
      // at submit: the resolver's types hand the handler the input shape. the
      // mask refuses a minus, so a fee can't go below zero
      wire_fee: v.pipe(v.string(), v.nonEmpty("required")),
      provider: v.pipe(
        v.string(),
        v.check((p) => providers.includes(p), "required")
      ),
      provider_tx_id: required_text,
      amount_sent: v.pipe(v.string(), v.nonEmpty("required")),
    }),
    v.forward(
      v.partialCheck(
        [["wire_fee"], ["amount_sent"]],
        (x) =>
          to_units(Number(x.amount_sent), 2) ===
          to_units(to_send(net, x.wire_fee), 2),
        (issue) => {
          const fee = (issue.input as { wire_fee: string }).wire_fee;
          return `enter ${usd(to_send(net, fee))}, the net total less the wire fee`;
        }
      ),
      ["amount_sent"]
    )
  );

type TForm = v.InferOutput<ReturnType<typeof wired_schema>>;

export function MarkWiredDialog({
  open,
  row,
  submitting,
  on_close,
  return_focus_fallback,
  providers = WIRE_PROVIDERS,
  ...rest
}: IMarkWiredDialog) {
  return (
    <Modal
      open={open}
      onClose={on_close}
      busy={submitting}
      returnFocusFallback={return_focus_fallback}
      classes="bg-popover"
    >
      {row && (
        <Body
          key={row.npo_id}
          row={row}
          providers={providers}
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
    IMarkWiredDialog,
    "submitting" | "error" | "on_submit" | "on_close"
  > {
  row: IManualWireRow;
  providers: readonly string[];
}

function Body({
  row,
  providers,
  submitting,
  error,
  on_submit,
  on_close,
}: IBody) {
  const schema = useMemo(
    () => wired_schema(row.net, providers),
    [row.net, providers]
  );
  const options = useMemo(() => [...providers], [providers]);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<TForm>({
    resolver: valibotResolver(schema),
    defaultValues: {
      wire_date: format(new Date(), "yyyy-MM-dd"),
      wire_fee: "0.00",
      provider: providers.length === 1 ? providers[0] : "",
      provider_tx_id: "",
      amount_sent: "",
    },
  });
  const { field: date } = useController({ control, name: "wire_date" });
  const { field: provider } = useController({ control, name: "provider" });
  const fee = useWatch({ control, name: "wire_fee" });
  const submit_once = use_submit_once(submitting, error);

  return (
    <form
      onSubmit={handleSubmit((x) =>
        submit_once(() =>
          on_submit({
            ...x,
            wire_fee: Number(x.wire_fee),
            amount_sent: Number(x.amount_sent),
          })
        )
      )}
    >
      <div className="p-6 sm:p-8 grid gap-4">
        <h3 className="text-lg font-bold">Mark wired</h3>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-gray-11">Nonprofit</dt>
          <dd className="font-semibold">
            {row.name} · {row.npo_id}
          </dd>
          <dt className="text-gray-11">Bank account</dt>
          <dd className="font-semibold">{row.bank}</dd>
        </dl>
        <DateField
          label="Wire date"
          required
          value={date.value}
          onChange={date.onChange}
          error={errors.wire_date?.message}
        />
        <MoneyInput
          control={control}
          name="wire_fee"
          label="Wire fee"
          sub="Paid by the nonprofit"
          error={errors.wire_fee?.message}
        />
        <Select
          ref={provider.ref}
          label="Provider"
          required
          value={provider.value || undefined}
          onChange={provider.onChange}
          options={options}
          option_disp={(p) => p}
          error={errors.provider?.message}
        />
        <Field
          {...register("provider_tx_id")}
          label="Transaction id"
          required
          placeholder="Transaction id from the provider"
          classes={{ input: "w-full" }}
          error={errors.provider_tx_id?.message}
        />
        <MoneyInput
          control={control}
          name="amount_sent"
          label="Amount sent"
          suffix="USD"
          placeholder="0.00"
          error={errors.amount_sent?.message}
        />
        <Payouts payouts={row.payouts} />
        <dl
          aria-label="Summary"
          className="bg-panel rounded p-4 grid gap-1 text-sm figures"
        >
          <SumRow label="Pending" value={usd(row.gross)} />
          <SumRow label="Owed, deducted" value={less(row.owed)} />
          <SumRow label="Net total" value={usd(row.net)} />
          <SumRow label="Wire fee" value={less(Number(fee) || 0)} />
          <SumRow
            label="Amount to send"
            value={usd(to_send(row.net, fee))}
            total
          />
          <SumRow label="Balance debit" value={usd(row.gross)} />
        </dl>
      </div>
      {/* a refusal quotes the provider's transaction id, one unbroken run */}
      <div className="wrap-anywhere">
        <DialogActions
          submitting={submitting}
          error={error}
          label="Mark wired"
          busy_label="Marking wired…"
          tone="btn-primary"
          on_close={on_close}
        />
      </div>
    </form>
  );
}

interface IMoneyInput {
  control: Control<TForm>;
  name: "wire_fee" | "amount_sent";
  label: string;
  sub?: string;
  suffix?: string;
  placeholder?: string;
  error?: string;
}

/** `MoneyField` with the "$" prefix, which `MoneyField` doesn't pass through */
function MoneyInput({ control, name, ...props }: IMoneyInput) {
  const { field } = useController({
    control,
    name,
    // the amount's check reads the fee: a fee edit re-checks it, once the
    // form has been submitted
    rules: name === "wire_fee" ? { deps: ["amount_sent"] } : undefined,
  });
  const money = useMoneyInput({
    value: field.value,
    onChange: field.onChange,
    ref: field.ref,
  });
  return (
    <Field
      {...props}
      {...money}
      required
      prefix="$"
      classes={{ input: "w-full" }}
      name={name}
      onBlur={field.onBlur}
    />
  );
}

interface ISumRow {
  label: string;
  value: string;
  /** the figure the wire carries: ruled off and bold, label in full ink */
  total?: boolean;
}

function SumRow({ label, value, total }: ISumRow) {
  return (
    <div
      className={
        total
          ? "flex justify-between gap-4 border-t border-hairline pt-2 mt-1 font-bold"
          : "flex justify-between gap-4"
      }
    >
      <dt className={total ? undefined : "text-gray-11"}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

const short_id = (id: string) => `${id.slice(0, 4)}...${id.slice(-4)}`;

interface IPayouts {
  payouts: IWirePayout[];
}

/** the payouts this wire settles; past about six rows the list scrolls, the
 * half row at its foot saying so */
function Payouts({ payouts }: IPayouts) {
  return (
    <section>
      <h4 className="text-sm font-semibold mb-2">
        Payouts settled{" "}
        <span className="ms-1 font-normal text-gray-11">{payouts.length}</span>
      </h4>
      <div className="border border-hairline rounded bg-surface overflow-hidden">
        <ul
          aria-label="Payouts settled"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling list takes focus so a keyboard can scroll it
          tabIndex={0}
          className="max-h-56 sm:max-h-51 overflow-y-auto scrollbars text-sm figures focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
        >
          {payouts.map((p) => (
            <li
              key={p.id}
              className="grid grid-cols-[auto_1fr_auto] sm:grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5 border-t border-hairline first:border-t-0"
            >
              <span className="contents sm:flex sm:min-w-0 sm:items-baseline sm:gap-2">
                <span className="col-span-full truncate" title={p.label}>
                  {p.label}
                </span>
                <span className="shrink-0 text-xs text-gray-11">
                  {short_id(p.id)}
                </span>
              </span>
              <span className="text-gray-11 max-sm:text-xs">
                {toPP(p.date)}
              </span>
              <span className="text-right">{usd(p.amount)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
