import { wise as wise_env } from "../env";
import { wise } from "../kit/wise";
import { is_own_recipient } from "./own-accounts";
import {
  attach_warning,
  type IPaid,
  type IPayWarning,
  within,
} from "./pay-warning";
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
 * accepted, and any warning for the caller to send after it has recorded the
 * payout: nothing here waits between accepted funding and that write. throws `NotFundedError` only when no money moved; any other throw
 * means it may have. a recipient that is one of our own accounts, or whose
 * check could not run, is paid all the same: Better Giving does not pry into
 * where a nonprofit sends its funds, so ops is warned, never blocked. a throw
 * from the funding call is rethrown as it is, carrying the warning
 * (`warning_of`) as "funding status unknown".
 */
export async function wise_pay(
  to: number,
  amount: number,
  ref: string
): Promise<IPaid> {
  const { transfer, warning } = await create_transfer(to, amount, ref).catch(
    (err) => {
      throw new NotFundedError(err);
    }
  );

  // guards for a ref reused within one claim: wise answers a reused ref with
  // its original transfer, funded or cancelled. the crons never reach these on
  // their own: each claim draws a fresh ref, and a claim left processing is
  // not retried, so only a caller re-sending a claim's stored ref meets them.
  if (FUNDED.has(transfer.status ?? "")) return { id: transfer.id };
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
  const funding = await wise
    .fund_transfer(transfer.id, +wise_env.profile_id, { type: "BALANCE" })
    .catch((err: unknown) => {
      // the transfer exists and funding may have landed: the own-account
      // warning rides on the error, saying the outcome is unknown
      if (warning) {
        attach_warning(err, {
          ...warning,
          body: warning.body.replace(
            "the payout went ahead",
            "the payout may have gone ahead: funding status unknown"
          ),
        });
      }
      throw err;
    });

  if (funding.status === "REJECTED") {
    throw new NotFundedError(new Error(`funding failed ${funding.errorCode}`));
  }
  return { id: transfer.id, warning };
}

type Transfer = Awaited<ReturnType<typeof wise.transfer>>;

/** the own-account lookup is given this long: a stalled one must not hold a
 * batch of payouts, and counts as a check that could not run */
const CHECK_MS = 5_000;
/** the transfer, and the warning to send ops once it is funded */
async function create_transfer(
  to: number,
  amount: number,
  ref: string
): Promise<{ transfer: Transfer; warning?: IPayWarning }> {
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
  const warning: IPayWarning | undefined =
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
