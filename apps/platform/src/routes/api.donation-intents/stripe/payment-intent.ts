import type Stripe from "stripe";
import { to_atomic_c } from "#/helpers/stripe";
import type { IAmount } from "@/donations";
import type { IMetadata } from "@/stripe";
import { stripe } from "$/kit/stripe";

export interface IInput extends IAmount {
  order_id: string;
  currency: string;
  customer_id: string;
  /** a retry with the same key answers the same intent */
  idempotency_key?: string;
  bank_only?: boolean;
  /** `statement_descriptor_suffix`; absent, the intent sets none */
  descriptor_suffix?: string;
}

export async function payment_intent(i: IInput): Promise<string> {
  const to_pay = i.base + i.fee_allowance + i.tip;
  const params: Stripe.PaymentIntentCreateParams = {
    amount: to_atomic_c(i.currency)(to_pay),
    // stripe's default is automatic_async, which leaves the charge's
    // balance_transaction null at confirmation — the value settled.ts polls
    // for before it 503s and makes stripe redeliver. spelled out to keep
    // settlement a single round trip.
    capture_method: "automatic",
    currency: i.currency.toLowerCase(),
    customer: i.customer_id,
    metadata: { order_id: i.order_id } satisfies IMetadata,
    payment_method_options: {
      acss_debit: {
        mandate_options: {
          payment_schedule: "sporadic",
          transaction_type: "business",
        },
        setup_future_usage: "on_session",
        verification_method: "automatic",
      },
    },
    ...(i.bank_only
      ? { payment_method_types: ["us_bank_account", "acss_debit"] }
      : { automatic_payment_methods: { enabled: true } }),
    ...(i.descriptor_suffix && {
      statement_descriptor_suffix: i.descriptor_suffix,
    }),
  };
  const { client_secret } = i.idempotency_key
    ? await stripe.paymentIntents.create(params, {
        idempotencyKey: i.idempotency_key,
      })
    : await stripe.paymentIntents.create(params);
  return client_secret || "invalid client secret";
}
