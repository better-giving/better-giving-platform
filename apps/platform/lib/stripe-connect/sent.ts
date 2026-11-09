/** what a routed transfer's reversal records make of it, for the payouts page.
 * `partial.reversed` is usd. `unknown`: stripe could not be read, so the
 * standing is not invented */
export type TSentStanding =
  | { kind: "paid" }
  | { kind: "partial"; reversed: number }
  | { kind: "reversed" }
  | { kind: "unknown" };

export interface ISentTransfer {
  id: string;
  /** usd sent to the connected account */
  amount: number;
  /** when the transfer was created, ISO-8601 */
  date: string;
  standing: TSentStanding;
}

export interface ISentTransfers {
  items: ISentTransfer[];
  /** older routed transfers exist than this list holds */
  truncated: boolean;
}

/** the payouts page's stripe part: the routed transfers, and where the
 * nonprofit's next card gift goes */
export interface INpoSent extends ISentTransfers {
  /** a card gift made now settles to the connected account: routing's own
   * answer (`is_routable`), so false whenever banking says not available */
  on_stripe: boolean;
  /** an account is linked and the nonprofit has not disconnected it */
  connected: boolean;
}

/**
 * what `reversed` cents of reversal records make of a transfer of `amount`
 * cents. nothing reversed is paid out; the whole amount (or more) is fully
 * reversed; a part is partly reversed, and `reversed` on that result is the
 * reversed usd
 */
export function transfer_standing(
  amount: number,
  reversed: number
): Exclude<TSentStanding, { kind: "unknown" }> {
  if (!(reversed > 0)) return { kind: "paid" };
  if (reversed >= amount) return { kind: "reversed" };
  return { kind: "partial", reversed: reversed / 100 };
}

/** where a routed donation stands, on either surface that shows it. `sending`
 * and `not_sent` are the two a routed donation with no transfer is in */
export type TRoutedKind = TSentStanding["kind"] | "sending" | "not_sent";

/** the words for `kind`, the one place the donations list and the payouts
 * page take them from */
export const routed_label = (kind: TRoutedKind): string => {
  switch (kind) {
    case "paid":
      return "Paid out";
    case "partial":
      return "Partly reversed";
    case "reversed":
      return "Fully reversed";
    case "unknown":
      return "Status unavailable";
    case "sending":
      return "Sending to Stripe";
    case "not_sent":
      return "Not sent to Stripe";
  }
};

/** a routed dist's standing from what the dist row records. a refund that
 * reversed the gift decides it either way: reversed after its transfer,
 * never sent before one. `now` is a parameter for the test's sake */
export function routed_kind(d: {
  transfer_id: string | null;
  /** the dist's status */
  reversed: boolean;
}): TRoutedKind {
  if (d.transfer_id) return d.reversed ? "reversed" : "paid";
  return d.reversed ? "not_sent" : "sending";
}
