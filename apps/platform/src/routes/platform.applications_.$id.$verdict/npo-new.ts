import { addYears } from "date-fns";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { report_error } from "#/errors/report";
import { referral_id } from "#/helpers/referral";
import { resp } from "@/helpers/https";
import { msg } from "@/queue";
import type { Progress, TStatus } from "@/reg";
import { enqueue, in_dedupe_window } from "$/kit/queue";
import { wise } from "$/kit/wise";
import {
  is_own_recipient,
  OWN_ACCOUNT_REFUSAL,
  OWN_LOOKUP_REFUSAL,
} from "$/payouts/own-accounts";
import { db } from "$/pg/db";
import { is_unique_violation } from "$/pg/errors";
import { bapp_put } from "$/pg/queries/banking";
import { reg_update, reg_update_from } from "$/pg/queries/registration";
import { userxnpo_put } from "$/pg/queries/user";
import { user } from "$/pg/schema/auth";
import { npos } from "$/pg/schema/npo";
import { sync_npo_account } from "$/stripe-connect/sync";
import { held_elsewhere, lock_acct } from "$/stripe-connect/target";

type NpoInsert = typeof npos.$inferInsert;

export type EndowContentFromReg = Pick<
  NpoInsert,
  | "active_in_countries"
  | "endow_designation"
  | "fiscal_sponsored"
  | "hq_country"
  | "kyc_donors_only"
  | "name"
  | "registration_number"
  | "url"
  | "referrer_user"
  | "referrer_npo"
  | "referrer_expiry"
  | "referral_id"
  | "stripe_account_id"
>;

/** what `reg-updated` carries, plus the npo the approval minted: met by the
 * route's `IReg` and by a drizzle row alike */
interface IApprovedRow {
  id: string;
  /** a stripe-only approval files no bank, so announces none */
  o_bank_id?: string | null;
  status: TStatus | null;
  updated_at: string | null;
  status_approved_npo_id?: number | null;
}

/** enqueues what an approval announces, for a row an approval settled: this
 * call's, or an earlier one's. inside qstash's dedupe window the repeat
 * carries the same keys (npo id; id+status+updated_at), so it reaches the
 * queue only if the first enqueue never did. past the window it enqueues
 * nothing, since the same keys would mail again. anything but an approved row
 * is a conflicting state. */
export async function announce_approval(row: IApprovedRow | null) {
  const npo_id = row?.status === "03" ? row.status_approved_npo_id : null;
  if (!row || npo_id == null)
    throw resp.status(409, "registration not in review");
  if (in_dedupe_window(row.updated_at)) {
    await enqueue(
      ...(row.o_bank_id ? [msg("banking-new", { npo_id })] : []),
      msg("reg-updated", row)
    );
  }
  return npo_id;
}

export const npo_new = async (r: NonNullable<Progress["banking"]>) => {
  const rid = referral_id("NPO");
  const ecfr: EndowContentFromReg = {
    active_in_countries: r.o_activity_countries ?? [],
    endow_designation: r.o_designation,
    fiscal_sponsored: r.o_type === "other",
    hq_country: r.o_hq_country,
    kyc_donors_only: true,
    name: r.o_name,
    registration_number:
      r.o_type === "501c3" ? r.o_ein : r.o_registration_number,
    url: r.o_website,
    referral_id: rid,
    stripe_account_id: r.o_stripe_account_id,
  };

  if (r.rm === "referral" && r.rm_referral_code) {
    const onboarded = new Date();
    const expiry = addYears(onboarded, 3).toISOString();
    if (r.rm_referral_code.startsWith("NPO-")) {
      ecfr.referrer_npo = r.rm_referral_code;
    } else {
      ecfr.referrer_user = r.rm_referral_code;
    }
    ecfr.referrer_expiry = expiry;
  }

  // r.r_id is the registrant email; look up their user.id for the FK
  const [registrant] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, r.r_id))
    .limit(1);
  if (!registrant) throw new Error(`user not found for email ${r.r_id}`);
  const registrant_id = registrant.id;

  ///////////// approval of new endowment /////////////
  // id is a PG IDENTITY column
  const bank =
    r.o_bank_id && r.o_bank_statement
      ? {
          id: r.o_bank_id,
          statement: r.o_bank_statement,
          wacc: await wise.v2_account(+r.o_bank_id),
        }
      : null;
  // the same check as a banking approval: this one files the bank as default
  if (bank) {
    const own = await is_own_recipient(bank.wacc).catch((err) => {
      report_error(err);
      return null;
    });
    if (own === null) throw resp.status(409, OWN_LOOKUP_REFUSAL);
    if (own) throw resp.status(409, OWN_ACCOUNT_REFUSAL);
  }

  const new_endow: NpoInsert = {
    ...ecfr,
    social_media_urls: {},
    sdgs: [],
    overview_pt: "[]",
    published: false,
    hide_bg_tip: false,
    donor_address_required: false,
    fund_opt_in: true,
  };

  const acct = r.o_stripe_account_id;
  const acct_taken = () =>
    resp.status(
      409,
      `stripe account ${acct} is already linked to another nonprofit or application`
    );

  const approved = await db.transaction(async (tx) => {
    // copying the account onto the npo claims it, so it takes the connect
    // callback's lock, and ahead of the row lock below as the callback does:
    // the other order deadlocks against a callback on this registration
    if (acct) await lock_acct(tx, acct);

    // the claim goes first: a second approval that read "02" before this one
    // committed waits on the row lock, then finds "03" and stops before its npo
    // insert, which would otherwise surface as a unique-key 500. the row it
    // finds is announced as this one's.
    const claimed = await reg_update_from(tx, r.id, ["02"], { status: "03" });
    if (!claimed.won) return claimed.row;

    // after the claim, so a repeat approval announces rather than finding its
    // own npo holding the account. any other holder approves nothing.
    if (acct && (await held_elsewhere(acct, { kind: "reg", reg_id: r.id }, tx)))
      throw acct_taken();

    const [inserted] = await tx
      .insert(npos)
      .values(new_endow)
      .returning()
      .catch((err) => {
        // a duplicate written before connect claims took the lock
        if (is_unique_violation(err, "npos_stripe_account_id_unique"))
          throw acct_taken();
        throw err;
      });
    const id = Number(inserted.id);

    if (bank) {
      const now = new Date().toISOString();
      const bank_new: Parameters<typeof bapp_put>[1] = {
        id: bank.id,
        npo_id: id,
        bank_statement_url: bank.statement,
        bank_summary: bank.wacc.longAccountSummary,
        rejection_reason: "",
        status: "default",
        date_created: now,
        updated_at: now,
      };

      // a fresh npo can't own it yet: another npo does, so approve nothing
      if (!(await bapp_put(tx, bank_new))) {
        throw resp.status(409, `bank ${bank.id} is already registered`);
      }
    }
    await userxnpo_put(tx, id, registrant_id);
    return reg_update(tx, r.id, { status_approved_npo_id: id });
  });

  const npo_id = await announce_approval(approved);
  // the account's events while the registration held it matched no npo and
  // were acked, so stripe won't resend them: the mirror is read here or never
  if (acct) {
    try {
      await sync_npo_account(npo_id);
    } catch (err) {
      // approved regardless: account.updated or the banking page fills it
      if (!(err instanceof Stripe.errors.StripeError)) throw err;
      report_error(err);
    }
  }
  return npo_id;
};
