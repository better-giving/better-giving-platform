import { report_error } from "#/errors/report";
import type { Alert } from "@/slack";
import { stage, wise as wise_env } from "../env";
import { aws_monitor } from "../kit/slack";
import { wise } from "../kit/wise";
import { is_own_recipient } from "./own-accounts";
import { NotFundedError } from "./transfer";

/** awaiting our funding: the one status in which funding is ours to ask for */
const UNFUNDED = "incoming_payment_waiting";
/** funded, and the money on its way or delivered */
const FUNDED = new Set([
  "incoming_payment_initiated",
  "processing",
  "funds_converted",
  "outgoing_payment_sent",
]);

/**
 * pays `amount` USD to wise recipient `to` under `ref`, wise's idempotency key:
 * quote → transfer → fund. resolves with the transfer id once funding was
 * accepted. throws `NotFundedError` only when no money moved; any other throw
 * means it may have. a recipient that is one of our own accounts, or whose
 * check could not run, is paid all the same: Better Giving does not pry into
 * where a nonprofit sends its funds, so ops is warned, never blocked.
 */
export async function wise_pay(
  to: number,
  amount: number,
  ref: string
): Promise<number> {
  const { transfer, warning } = await create_transfer(to, amount, ref).catch(
    (err) => {
      throw new NotFundedError(err);
    }
  );

  // guards for a ref reused within one claim: wise answers a reused ref with
  // its original transfer, funded or cancelled. the crons never reach these on
  // their own: each claim draws a fresh ref, and a claim left processing is
  // not retried, so only a caller re-sending a claim's stored ref meets them.
  if (FUNDED.has(transfer.status ?? "")) return transfer.id;
  if (transfer.status === "cancelled") {
    // cancelled before it was funded: no money moved
    throw new NotFundedError(
      new Error(
        `transfer ${transfer.id} (customerTransactionId ${ref}) is cancelled`
      )
    );
  }
  if (transfer.status !== UNFUNDED) {
    // refunded, bounced, charged back or unrecognised: money may have moved
    throw new Error(
      `transfer ${transfer.id} (customerTransactionId ${ref}) is ${transfer.status}`
    );
  }
  const funding = await wise.fund_transfer(transfer.id, +wise_env.profile_id, {
    type: "BALANCE",
  });

  if (funding.status === "REJECTED") {
    throw new NotFundedError(new Error(`funding failed ${funding.errorCode}`));
  }
  // only now is it true that the payout went ahead
  if (warning) await warn_ops(warning);
  return transfer.id;
}

type Transfer = Awaited<ReturnType<typeof wise.transfer>>;
type Warning = Parameters<typeof warn_ops>[0];

/** the own-account lookup is given this long: a stalled one must not hold a
 * batch of payouts, and counts as a check that could not run */
const CHECK_MS = 5_000;
/** an ops alert is given this long, so a stalled Slack cannot stall a payout */
const ALERT_MS = 3_000;

/** `p`'s answer, or `on_timeout` once `ms` pass */
const within = <T>(ms: number, p: Promise<T>, on_timeout: () => T) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => resolve(on_timeout()), ms);
    p.then(resolve, reject).finally(() => clearTimeout(t));
  });

/** the transfer, and the warning to send ops once it is funded */
async function create_transfer(
  to: number,
  amount: number,
  ref: string
): Promise<{ transfer: Transfer; warning?: Warning }> {
  const recipient = await wise.v2_account(to);
  const checked = await within(
    CHECK_MS,
    is_own_recipient(recipient).then(
      (own) => ({ own, err: null as unknown }),
      (err: unknown) => ({ own: false, err })
    ),
    () => ({ own: false, err: "timed out" as unknown })
  );
  const fields = [
    { name: "recipient", value: to.toString() },
    { name: "holder", value: recipient.name?.fullName ?? "no name" },
    { name: "customerTransactionId", value: ref },
  ];
  const warning: Warning | undefined =
    checked.err !== null
      ? {
          title: "own-account check could not run before a payout",
          body: `could not read Better Giving's own Wise account details to check recipient ${to}: ${String(checked.err)}. the payout went ahead`,
          fields,
        }
      : checked.own
        ? {
            title: "payout to one of Better Giving's own Wise accounts",
            body: `recipient ${to} matches one of Better Giving's own Wise accounts. the payout went ahead: check it is what the nonprofit asked for`,
            fields,
          }
        : undefined;

  const quote = await wise.quote(wise_env.profile_id, {
    sourceCurrency: "USD",
    targetCurrency: recipient.currency,
    sourceAmount: amount,
    targetAmount: null,
    payOut: null,
    // priced for the balance we fund it from: without it wise quotes a
    // bank-transfer pay-in fee, and the balance then debits another total
    preferredPayIn: "BALANCE",
    targetAccount: to.toString(),
  });
  const transfer = await wise.transfer({
    targetAccount: to.toString(),
    quoteUuid: quote.id,
    customerTransactionId: ref,
    details: {
      transferPurpose: "verification.transfers.purpose.other",
      sourceOfFunds: "verification.source.of.funds.other",
    },
  });

  if (transfer.errors) throw transfer.errors;
  return { transfer, warning };
}

/** an alert that fails or stalls is reported, never thrown past the money */
async function warn_ops(a: {
  title: string;
  body: string;
  fields: NonNullable<Alert["fields"]>;
}) {
  try {
    await within(
      ALERT_MS,
      aws_monitor.send_alert({
        ...a,
        type: "ERROR",
        from: `wise-pay:${stage}`,
      }),
      () => undefined
    );
  } catch (err) {
    report_error(err, { alert: a.title });
  }
}
