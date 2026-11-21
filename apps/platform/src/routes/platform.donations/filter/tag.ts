import { type ViaGroup, via_group } from "./constants";

export type TagVariant =
  | "neutral"
  | "success"
  | "warning"
  | "destructive"
  | "outline";

export interface ITag {
  label: string;
  variant: TagVariant;
}

/** (status, via group) pairs with a word of their own */
const PAIRS: Record<string, ITag> = {
  "intent:crypto": { label: "Awaiting crypto", variant: "warning" },
  "intent:daf": { label: "Grant pending", variant: "warning" },
  "intent:stripe": { label: "Bank verification", variant: "warning" },
  "confirmed:crypto": { label: "Confirming on chain", variant: "warning" },
  "created:stripe": { label: "Unpaid checkout", variant: "neutral" },
  "created:paypal": { label: "Unpaid checkout", variant: "neutral" },
  "failed:stripe": { label: "Failed", variant: "destructive" },
  "failed:paypal": { label: "Failed", variant: "destructive" },
  "failed:crypto": { label: "Failed", variant: "destructive" },
  "expired:crypto": { label: "Payment expired", variant: "outline" },
  "expired:stripe": { label: "Checkout expired", variant: "outline" },
  "cancelled:daf": { label: "Grant cancelled", variant: "outline" },
  "cancelled:stripe": { label: "Campaign deleted", variant: "outline" },
};

/** a status whose tag doesn't depend on the method */
const ANY_METHOD: Record<string, ITag> = {
  settled: { label: "Settled", variant: "success" },
  refunded: { label: "Refunded", variant: "destructive" },
  refunded_loss: { label: "Refunded (loss)", variant: "destructive" },
};

/** a pair not in `PAIRS` shows its filter group's word */
const FALLBACK: Record<string, ITag> = {
  intent: { label: "Awaiting funds", variant: "warning" },
  confirmed: { label: "Awaiting funds", variant: "warning" },
  created: { label: "Unpaid checkout", variant: "neutral" },
  failed: { label: "Failed", variant: "destructive" },
  expired: { label: "Expired", variant: "outline" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

export const donation_tag = (status: string, via: string): ITag => {
  const any = ANY_METHOD[status];
  if (any) return any;
  const group: ViaGroup = via_group(via);
  return (
    PAIRS[`${status}:${group}`] ??
    FALLBACK[status] ?? { label: status, variant: "neutral" }
  );
};
