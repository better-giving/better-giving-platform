import { resp } from "@/helpers/https";

/** why an intent can't be made, as data. each surface words it its own way:
 * checkout shows `copy` to the donor, the partner API sends `kind` as a code */
export type RefusalKind =
  | "below_minimum"
  | "above_maximum"
  | "unsupported"
  | "invalid"
  | "authorization_expired";

export interface Refusal {
  refused: true;
  kind: RefusalKind;
  /** safe to show a donor verbatim */
  copy: string;
  /** the status checkout answers with */
  status: number;
  /** `below_minimum`: the smallest base, in usd, and the units per usd of the
   * currency it was judged in */
  minimum_usd?: number;
  upusd?: number;
}

export const refuse = (
  kind: RefusalKind,
  copy: string,
  status = 400,
  extra: Pick<Refusal, "minimum_usd" | "upusd"> = {}
): Refusal => ({ refused: true, kind, copy, status, ...extra });

export const is_refusal = (x: object): x is Refusal => "refused" in x;

/** checkout's wire format for a refusal */
export const to_response = <T extends object>(x: Refusal | T): Response | T =>
  is_refusal(x) ? resp.refuse(x.copy, x.status) : x;

/** the chariot row is stored at upusd 1, which is only true of usd */
export const currency_refusal = (
  via: string,
  currency: string
): Refusal | undefined =>
  via === "chariot" && currency !== "USD"
    ? refuse("unsupported", `chariot is usd-only, got ${currency}`)
    : undefined;
