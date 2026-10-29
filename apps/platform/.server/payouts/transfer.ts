import { createHash, randomUUID } from "node:crypto";

export { payout_cents, payout_total } from "./amount";

/** a Wise payout failed with no money moved */
export class NotFundedError extends Error {
  constructor(cause: unknown) {
    super("transfer not funded", { cause });
    this.name = "NotFundedError";
  }
}

// fixed namespace for the uuid v5 below; changing it re-keys every ref
const REF_NAMESPACE = Buffer.from("cb853edef275466b85c79409fa3f037a", "hex");

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
  nonce: string = randomUUID()
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

function uuid_v5(name: string): string {
  const b = createHash("sha1")
    .update(REF_NAMESPACE)
    .update(name)
    .digest()
    .subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
