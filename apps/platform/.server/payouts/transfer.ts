import { uuid_v5 } from "@/payouts/uuid-v5";

export { payout_cents, payout_total } from "./amount";

/** a Wise payout failed with no money moved */
export class NotFundedError extends Error {
  constructor(cause: unknown) {
    super("transfer not funded", { cause });
    this.name = "NotFundedError";
  }
}

/**
 * a claim's wise `customerTransactionId` (its idempotency key): uuid v5 of
 * recipient + total + claimed id set + a nonce drawn per claim. made once, in
 * the claim's tx, and stored on the claimed rows, so a retry within the claim
 * reuses it; a set released and claimed again gets a new one, never the
 * earlier claim's transfer, which wise may have cancelled meanwhile.
 */
export function transfer_ref(
  ref_key: string,
  total: number,
  ids: string[],
  nonce: string = crypto.randomUUID()
): string {
  return uuid_v5(
    JSON.stringify([ref_key, total.toFixed(2), [...ids].sort(), nonce])
  );
}

/**
 * a run that sends no transfer, its rows all recovered as owed: uuid v5 of
 * the party (an npo id, or a referrer id) + the claimed id set, with no nonce.
 * the claim settles the set in the same tx, so a retry finds nothing pending
 * and the ref never recurs
 */
export function recovered_run_ref(
  party: number | string,
  ids: string[]
): string {
  return uuid_v5(JSON.stringify(["recovered", party, [...ids].sort()]));
}

/**
 * a manual wire's settlement id: uuid v5 of the provider + its own reference
 * for the wire, so the same reference at two providers never collides and
 * recording one wire twice does
 */
export function wire_settlement_id(
  provider: string,
  provider_tx_id: string
): string {
  return uuid_v5(JSON.stringify(["manual_wire", provider, provider_tx_id]));
}
