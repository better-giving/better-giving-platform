import { wise as wise_env } from "../env";
import { wise } from "../kit/wise";
import { is_own_recipient } from "./own-accounts";
import { NotFundedError, PayRefused } from "./transfer";

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
 * means it may have. funds only a transfer that pays a recipient that is not
 * one of our own accounts; otherwise the `NotFundedError`'s cause is a
 * `PayRefused`.
 */
export async function wise_pay(
  to: number,
  amount: number,
  ref: string
): Promise<number> {
  const transfer = await create_transfer(to, amount, ref).catch((err) => {
    throw new NotFundedError(err);
  });

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
  return transfer.id;
}

type Transfer = Awaited<ReturnType<typeof wise.transfer>>;

async function create_transfer(
  to: number,
  amount: number,
  ref: string
): Promise<Transfer> {
  const recipient = await wise.v2_account(to);
  const own = await is_own_recipient(recipient).catch((err) => {
    throw new PayRefused(
      `could not read Better Giving's own Wise account details to check recipient ${to} against (${String(err)})`
    );
  });
  if (own) {
    throw new PayRefused(
      `recipient ${to} (${recipient.name?.fullName ?? "no name"}) is one of Better Giving's own Wise accounts, not the payee's`
    );
  }

  const quote = await wise.quote(wise_env.profile_id, {
    sourceCurrency: "USD",
    targetCurrency: recipient.currency,
    sourceAmount: amount,
    targetAmount: null,
    payOut: null,
    preferredPayIn: null,
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
  return transfer;
}
