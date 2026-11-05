import { Combo, DrawerIcon, MaskedInput, Separator } from "@better-giving/ui";
import { dollar } from "@better-giving/ui/masks";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { app_name } from "#/constants/env";
import { report_error } from "#/errors/report";
import { use_debouncer } from "#/hooks/use-debouncer";
import type { WiseCurrencyOption } from "#/types/components";
import { RecipientDetails } from "./recipient-details";
import type { IFormButtons, OnSubmit } from "./types";
import { use_currencies } from "./use-currencies";

/**
 * Denominated in USD
 */
const DEFAULT_EXPECTED_MONTHLY_DONATIONS_AMOUNT = "1000";

const to_label = (c: WiseCurrencyOption) =>
  `${c.code.toUpperCase()} - ${c.name}`;

/** "hong kong dollar" has to find "HongKong", and "usd" has to find the code. */
const strip = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const matches = (text: string, q: string) => strip(text).includes(strip(q));

type Props = {
  FormButtons: IFormButtons;
  /** All errors should be handled inside `onSubmit` */
  onSubmit: OnSubmit;
  is_loading: boolean;
  verified?: boolean;
};

export function BankDetails({
  FormButtons,
  onSubmit,
  is_loading,
  verified,
}: Props) {
  const currencies = use_currencies();
  const [is_submitting, set_submitting] = useState(false);
  const [currency, setCurrency] = useState<WiseCurrencyOption>({
    code: "USD",
    name: "United States Dollar",
    rate: null,
  });

  const [amount, setAmount] = useState(
    DEFAULT_EXPECTED_MONTHLY_DONATIONS_AMOUNT
  );
  const [debounced_amount] = use_debouncer(amount, 500);

  const handleSubmit: OnSubmit = async (...params) => {
    try {
      set_submitting(true);
      await onSubmit(...params);
    } catch (error) {
      // all errors should be handled in `onSubmit`.
      // this try/catch is just to ensure that `is_submitting`
      // is set to false at the end of the operation.
      report_error(error);
    } finally {
      set_submitting(false);
    }
  };

  return (
    <div className="grid gap-6">
      <div className="grid md:w-80">
        <Combo
          value={currency}
          on_change={(c) => c && setCurrency(c)}
          options={{
            items: currencies.data ?? [],
            loading: currencies.is_loading,
          }}
          item_key={(c) => c.code}
          item_text={to_label}
          filter={matches}
          // the full list is the point here — a payout currency is picked from
          // what wise supports, not from the default RESULT_LIMIT of 10 rows
          limit={Number.POSITIVE_INFINITY}
          label="Select your bank account currency:"
          required
          disabled={is_submitting || is_loading || currencies.is_error}
          classes={{ container: "md:w-80", control: "w-full" }}
          adornment={(open, state) =>
            state === "loading" ? (
              <LoaderCircle className="text-gray-11 animate-spin icon-xl" />
            ) : (
              <DrawerIcon is_open={open} className="icon-xl" />
            )
          }
        />
        <p className="mt-1 text-sm text-gray-11">
          The details Wise asks for next depend on this currency.
        </p>
        {/* a failed list can't open, so the reason sits under the field. it is
          not the field's error: the selected currency is fine, so the edge
          stays neutral rather than marking the value invalid. announced when
          it appears, since the disabled control can't carry a description —
          the region stays mounted so the sentence lands in a live region the
          screen reader already knows */}
        <p
          role="status"
          className={`text-sm text-destructive-subtle-fg ${currencies.is_error ? "mt-1" : ""}`}
        >
          {currencies.is_error &&
            "Couldn't load currencies. Refresh to try again."}
        </p>
      </div>
      <MaskedInput
        id="expected-monthly-donations"
        label="What is the amount you expect to receive monthly on our
        platform?"
        sub={
          <p className="text-sm text-gray-11 my-2">
            Depending on how much you expect to receive each month via{" "}
            {app_name}, different details are required. At this point, we
            recommend using a conservative figure - Maybe $1000 per month.
          </p>
        }
        mask={dollar}
        value={dollar.mask(+amount)}
        onChange={(amount) => setAmount(dollar.unmask(amount).toString())}
        classes={{ input: "md:w-80" }}
        disabled={is_submitting}
      />

      <Separator classes="before:bg-gray-6 after:bg-gray-6" />

      <RecipientDetails
        verified={verified}
        amount={+debounced_amount}
        currency={currency.code}
        disabled={is_submitting || is_loading}
        FormButtons={FormButtons}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
