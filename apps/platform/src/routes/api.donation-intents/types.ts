import type { IDonation, IDonor, IFrom, ITo, ITribute } from "@/donations";
import type { IDonationIntent } from "@/donations/schema";

export interface Ctx {
  to: ITo;
  from: IFrom;
  donor: IDonor;
  via: IDonationIntent["via"];
  via_extra: IDonationIntent["via_extra"];
  /** the donation id a caller minted before the request, so a retry of it
   * finds its own row and processor objects. a DAF grant takes it over its
   * connect metadata, which a partner's page writes before any payment exists */
  don_id?: string;
  /** a tribute to write with the row, for a rail whose payment can settle
   * before the caller could write it afterwards (a DAF grant) */
  tribute?: ITribute;
  /** a partner's card intent: cards only, not every method the account has on */
  card_only?: boolean;
  /** what a Stripe payment chose on an earlier attempt, to send again, and
   * where to keep what this attempt chose before any Stripe object depends on
   * it. both come from a caller that retries under idempotency keys */
  provider_state?: {
    customer_id?: string;
    descriptor_suffix?: string | null;
  };
  on_provider_state?: (state: {
    customer_id: string;
    descriptor_suffix: string | null;
  }) => Promise<void>;
  intent: Omit<
    IDonationIntent,
    "via" | "via_extra" | "to_id" | "donor" | "source"
  > & {
    /** checkout's own sources, or a partner's (`partner-api`) */
    source: IDonation["source"];
  };
}

export interface IntentResult {
  don_id: string;
  body: Record<string, any>;
}

export type Provider = (ctx: Ctx) => Promise<Response | IntentResult>;

/** what a donor reads when the intent route refuses a request it can't act on */
export const REFUSED_COPY =
  "We couldn't process this donation. Please refresh the page and try again.";
