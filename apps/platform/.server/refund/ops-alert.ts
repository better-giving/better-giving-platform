import type { Alert, Field } from "@/slack";
import type { IOwed } from "../pg/queries/owed";
import {
  alert_deadline,
  donated_field,
  donor_field,
  type IAlertDonation,
  owed_table,
  recipient_field,
  recipient_name,
  short_id,
} from "./alert";

export interface IOpsAlert {
  /** slack sender identity, stage included */
  from: string;
  /** what happened, e.g. "Stripe dispute opened" */
  headline: string;
  don?: IAlertDonation;
  /** e.g. "$6.00"; absent, the title names the nonprofit alone */
  amount?: string;
  /** the amount field's name */
  subject: "Disputed" | "Refunded";
  /** after the amount: a reason or a status */
  fields?: Field[];
  /** the provider's own deadline; never guessed */
  respond_by?: string | Date;
  /** what the parties owe, as a table */
  owed?: IOwed[];
  /** one line each */
  note?: string[];
  action?: Alert["action"];
  /** e.g. `dispute dp_1`, after the donation's own */
  ids?: string[];
}

const inline = (name: string, value: string): Field => ({
  name,
  value,
  inline: true,
});

/** the dispute and refund ops alerts' one layout: "<headline> · $6.00 to
 * Save the Kids", the parties and amounts as fields, what is owed as a table */
export async function ops_alert(a: IOpsAlert): Promise<Alert> {
  const npo = recipient_name(a.don);
  const gift = a.amount ? `${a.amount} to ${npo}` : npo;
  const respond_by = alert_deadline(a.respond_by);
  const fields = [
    a.don && recipient_field(a.don),
    a.don && donor_field(a.don),
    a.amount && inline(a.subject, a.amount),
    ...(a.fields ?? []),
    donated_field(a.don),
    respond_by && inline("Respond by", respond_by),
  ].filter((f): f is Field => !!f);
  const ids = [a.don && `donation ${short_id(a.don.id)}`, ...(a.ids ?? [])]
    .filter((id): id is string => !!id)
    .join(" · ");
  const note = a.note?.join("\n");
  return {
    type: "NOTICE",
    from: a.from,
    title: `${a.headline} · ${gift}`,
    summary: `${a.headline}: ${gift}`,
    fields,
    ...(a.owed && a.owed.length > 0 && { table: await owed_table(a.owed) }),
    ...(note && { note }),
    ...(a.action && { action: a.action }),
    ...(ids && { context: [ids] }),
  };
}

/** "product_not_received" → "Product not received" */
export const humanize_code = (code: string) => {
  const words = code.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
