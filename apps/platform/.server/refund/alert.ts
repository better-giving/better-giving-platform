import { inArray } from "drizzle-orm";
import { report_error } from "#/errors/report";
import type { AlertTable, Field } from "@/slack";
import { base_url } from "../env";
import { db } from "../pg/db";
import { type IOwed, owed_total } from "../pg/queries/owed";
import { user } from "../pg/schema/auth";
import { npos } from "../pg/schema/npo";

/** "Nov 20, 2026", in UTC; undefined for no date or one that doesn't parse */
export const alert_date = (when: string | Date | null | undefined) => {
  if (!when) return undefined;
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
};

/** "Dec 10, 2026, 07:00 UTC": a deadline keeps its time, since it can fall
 * near midnight and a date alone reads a day off in another zone */
export const alert_deadline = (when: string | Date | null | undefined) => {
  if (!when) return undefined;
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return undefined;
  const at = d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  });
  return `${at} UTC`;
};

/** "$6.00" for usd, else "6.00 EUR". a missing value reads "unknown amount" */
export const amount_label = (
  value: string | number | undefined,
  ccy = "USD"
) => {
  const n = Number(value);
  if (value === undefined || value === "" || !Number.isFinite(n)) {
    return "unknown amount";
  }
  return ccy === "USD" ? `$${n.toFixed(2)}` : `${n.toFixed(2)} ${ccy}`;
};

/** what an alert reads off the donation lookup */
export interface IAlertDonation {
  id: string;
  to_id: string;
  to_name: string;
  to_type: "npo" | "fund";
  from_name?: string;
  created_at: string | Date;
}

/** the nonprofit's name, or "#id" when the lookup has none */
export const recipient_name = (don?: IAlertDonation) => {
  if (!don) return "unknown nonprofit";
  return don.to_name || (don.to_id ? `#${don.to_id}` : "unknown nonprofit");
};

/** "Save the Kids (#4)", linked to its admin page when it is a nonprofit */
export const recipient_field = (don?: IAlertDonation): Field => {
  const value =
    don?.to_name && don.to_id
      ? `${don.to_name} (#${don.to_id})`
      : recipient_name(don);
  return {
    name: "Nonprofit",
    value,
    inline: true,
    url:
      don?.to_type === "npo" && don.to_id
        ? `${base_url}/admin/${don.to_id}`
        : undefined,
  };
};

export const donor_field = (don?: IAlertDonation): Field => ({
  name: "Donor",
  value: don ? don.from_name || "Anonymous" : "unknown donor",
  inline: true,
});

export const donated_field = (don?: IAlertDonation): Field | undefined => {
  const value = alert_date(don?.created_at);
  return value ? { name: "Donated", value, inline: true } : undefined;
};

/** "donation 98bc019c… · dispute X": the ids an alert footer carries, the
 * donation id cut to its first eight characters */
export const short_id = (id: string) =>
  id.length > 12 ? `${id.slice(0, 8)}…` : id;

const usd = (n: number) => n.toFixed(2);

/**
 * what a filing recorded as owed, one row per party and a total. a party is
 * named by its nonprofit's or user's name, with "#id" when the name is
 * missing. all figures are usd.
 */
export async function owed_table(owed: IOwed[]): Promise<AlertTable> {
  const npo_ids = owed.flatMap((o) => (o.npo_id === null ? [] : [o.npo_id]));
  const ref_npos = owed.flatMap((o) =>
    o.referrer_npo === null ? [] : [o.referrer_npo]
  );
  const user_ids = owed.flatMap((o) =>
    o.referrer_user === null ? [] : [o.referrer_user]
  );
  // a failed name lookup must not lose the alert: parties fall back to ids
  const [by_id, by_referral, users] = await Promise.all([
    npo_ids.length
      ? db
          .select({ id: npos.id, name: npos.name })
          .from(npos)
          .where(inArray(npos.id, npo_ids))
      : [],
    ref_npos.length
      ? db
          .select({ id: npos.referral_id, name: npos.name })
          .from(npos)
          .where(inArray(npos.referral_id, ref_npos))
      : [],
    user_ids.length
      ? db
          .select({ id: user.referral_code, name: user.name })
          .from(user)
          .where(inArray(user.referral_code, user_ids))
      : [],
  ]).catch((err) => {
    report_error(err, { title: "owed table names" });
    return [[], [], []] as const;
  });
  const npo_name = new Map(by_id.map((n) => [n.id, n.name]));
  const referral_name = new Map(by_referral.map((n) => [n.id, n.name]));
  const user_name = new Map(users.map((u) => [u.id, u.name]));

  const party = (o: IOwed) => {
    if (o.npo_id !== null) {
      const name = npo_name.get(o.npo_id);
      return name ? `${name} (#${o.npo_id})` : `#${o.npo_id}`;
    }
    if (o.referrer_user !== null) {
      return `${user_name.get(o.referrer_user) || `user ${o.referrer_user}`} (referrer)`;
    }
    const name = o.referrer_npo ? referral_name.get(o.referrer_npo) : undefined;
    return `${name || `npo ${o.referrer_npo}`} (referrer)`;
  };

  const right = "right" as const;
  return {
    columns: [
      { name: "Party" },
      { name: "Received (USD)", align: right },
      { name: "Card fee (USD)", align: right },
      { name: "Dispute fee (USD)", align: right },
      { name: "Owed (USD)", align: right },
    ],
    rows: [
      ...owed.map((o) => [
        party(o),
        usd(o.received_usd),
        usd(o.fee_processing_usd),
        usd(o.fee_dispute_usd),
        usd(owed_total(o)),
      ]),
      [
        "Total",
        "—",
        "—",
        "—",
        usd(owed.reduce((sum, o) => sum + owed_total(o), 0)),
      ],
    ],
  };
}
