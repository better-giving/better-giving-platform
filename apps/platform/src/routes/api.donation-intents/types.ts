import type { IDonation, IDonor, IFrom, ITo } from "@/donations";
import type { IDonationIntent } from "@/donations/schema";

export interface Ctx {
  to: ITo;
  from: IFrom;
  donor: IDonor;
  via: IDonationIntent["via"];
  via_extra: IDonationIntent["via_extra"];
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
