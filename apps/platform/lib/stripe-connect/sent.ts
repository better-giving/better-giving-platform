/** what a routed transfer's reversal records make of it, for the payouts page.
 * `partial.reversed` is usd. `unknown`: stripe could not be read, so the
 * standing is not invented */
export type TSentStanding =
  | { kind: "paid" }
  | { kind: "partial"; reversed: number }
  | { kind: "reversed" }
  /** the gift was refunded and the npo owes back money stripe refused to
   * reverse from the transfer: it stayed in the connected account */
  | { kind: "kept" }
  /** `kept`, and nothing is owed any more: recovered, credited or written off */
  | { kind: "repaid" }
  | { kind: "unknown" };

export interface ISentTransfer {
  id: string;
  /** usd sent to the connected account */
  amount: number;
  /** when the transfer was created, ISO-8601 */
  date: string;
  standing: TSentStanding;
}

/** a routed donation no transfer has paid, and so not one of the `items` */
export interface IUnsentTransfer {
  /** the dist */
  id: string;
  /** usd routed */
  amount: number;
  /** when the donation was routed, ISO-8601 */
  date: string;
  kind: TUnsentKind;
}

export interface ISentTransfers {
  items: ISentTransfer[];
  /** older routed transfers exist than this list holds */
  truncated: boolean;
}

/** the payouts page's stripe part: the routed transfers, and where the
 * nonprofit's next card gift goes */
export interface INpoSent extends ISentTransfers {
  /** routed donations with no transfer yet: on their way, or never going */
  unsent: IUnsentTransfer[];
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
): Exclude<TSentStanding, { kind: "unknown" | "kept" }> {
  if (!(reversed > 0)) return { kind: "paid" };
  if (reversed >= amount) return { kind: "reversed" };
  return { kind: "partial", reversed: reversed / 100 };
}

/** where a routed donation stands, on either surface that shows it. `sending`
 * and `not_sent` are the two a routed donation with no transfer is in */
export type TRoutedKind = TSentStanding["kind"] | "sending" | "not_sent";
export type TUnsentKind = Extract<TRoutedKind, "sending" | "not_sent">;

/** how long a routed donation may wait for its transfer before it reads as
 * not sent: the transfer job retries within stripe's 24h idempotency window,
 * so one older than that was refused, went unanswered, or is held by an open
 * dispute, whose close sends it unless the gift is reversed by then
 * (`held_transfers` in .server/stripe-connect/release.ts) */
export const SENDING_WINDOW_MS = 24 * 60 * 60 * 1000;

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
    case "kept":
      return "Refunded, owed to Better Giving";
    case "repaid":
      return "Refunded, repaid to Better Giving";
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
export function routed_kind(
  d: {
    transfer_id: string | null;
    /** the dist's status */
    reversed: boolean;
    /** stripe refused to reverse part of its transfer, and the amount is
     * recorded owed by the nonprofit */
    kept?: boolean;
    /** with `kept`, the amount is still outstanding. unset reads as owing */
    owing?: boolean;
    routed_at: string;
  },
  now = Date.now()
): TRoutedKind {
  if (d.transfer_id) {
    if (!d.reversed) return "paid";
    if (!d.kept) return "reversed";
    return d.owing === false ? "repaid" : "kept";
  }
  if (d.reversed) return "not_sent";
  return now - Date.parse(d.routed_at) > SENDING_WINDOW_MS
    ? "not_sent"
    : "sending";
}
