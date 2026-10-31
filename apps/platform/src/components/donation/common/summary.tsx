import { unpack } from "@better-giving/ui/helpers";
import { ListCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { OptionType } from "#/types/components";
import type { TFrequency } from "@/schemas";
import { BackBtn } from "./back-btn";

type Classes =
  | string
  | {
      container?: string;
      split?: string;
    };

type Props = {
  amount: number;
  tip?: { value: number; charity_name: string };
  fee_allowance?: number;

  Amount: (props: { amount: number | string; classes?: string }) => ReactNode;
  on_back(): void;
  /** shut while a payment is in flight. leaving would drop the hold. */
  back_disabled?: boolean;
  frequency?: TFrequency;
  classes?: Classes;
  children?: ReactNode;
  pre_split_content?: ReactNode;
  program?: OptionType<string>;
};

export function Summary({ Amount, frequency = "one-time", ...props }: Props) {
  const { container, split: splitClass } = unpack(props.classes);

  const tipValue = props.tip?.value ?? 0;

  return (
    <div className={container}>
      <BackBtn
        type="button"
        disabled={props.back_disabled}
        onClick={props.on_back}
      />
      <h4 className="flex items-center text-lg gap-2 my-4">
        <ListCheck className="icon-xl" />
        <span className="font-semibold text-sm">Your donation summary</span>
      </h4>
      {props.pre_split_content}

      <dl
        className={`grid grid-cols-[1fr_auto] items-center justify-between border-y border-hairline divide-y divide-hairline ${splitClass}`}
      >
        {props.program?.value && (
          <p className="text-gray-11 col-span-full py-2 text-sm">
            Program: {props.program.label}
          </p>
        )}
        <div className="grid grid-cols-[1fr_auto] py-3 gap-y-1">
          <dt className="mr-auto">
            <span>
              {props.tip && tipValue > 0
                ? `Donation for ${props.tip.charity_name}`
                : "Total donation"}
            </span>
          </dt>
          <Amount amount={props.amount} classes="text-gray-12" />
        </div>

        {tipValue > 0 && (
          <div className="col-span-full grid grid-cols-[1fr_auto] py-3">
            <dt className="mr-auto">Donation for Better Giving</dt>
            <Amount classes="text-sm" amount={tipValue} />
          </div>
        )}

        {props.fee_allowance ? (
          <div className="col-span-full grid grid-cols-[1fr_auto] py-3">
            <dt className="mr-auto">Covered processing fee</dt>
            <Amount classes="text-sm" amount={props.fee_allowance} />
          </div>
        ) : null}

        <div className="grid col-span-full grid-cols-[1fr_auto] font-medium py-3">
          <dt className="mr-auto">
            Total {frequency !== "one-time" ? frequency : ""} charge
          </dt>
          <Amount
            amount={props.amount + tipValue + (props.fee_allowance ?? 0)}
          />
        </div>
      </dl>

      {props.children}
    </div>
  );
}
