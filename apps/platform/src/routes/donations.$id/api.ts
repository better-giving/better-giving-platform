import { valibotResolver } from "@hookform/resolvers/valibot";
import {
  donation_match_filed_notif as dmfn,
  donation_private_message as dpm,
  donation_tribute_notif as dtn,
} from "emails";
import { href } from "react-router";
import { getValidatedFormData } from "remix-hook-form";
import { get_session, to_auth } from "#/.server/auth";
import {
  donations_cookie,
  type IDonationIntentExpiries,
} from "#/.server/cookie";
import { dataWithSuccess } from "#/.server/toast";
import { emails as bg_emails } from "@/constants/common";
import { is_paid } from "@/donations/helpers";
import type { IDonation } from "@/donations/interfaces";
import { to_pretty_utc } from "@/helpers/date";
import { to_amount } from "@/helpers/email";
import { resp } from "@/helpers/https";
import { from_full } from "@/helpers/name";
import { is_gift_returned } from "@/match";
import { msg } from "@/queue";
import { send_email } from "$/email";
import { base_url } from "$/env";
import { enqueue } from "$/kit/queue";
import { db } from "$/pg/db";
import { donation_get, donation_update } from "$/pg/queries/donation";
import { donation_message_put } from "$/pg/queries/donation-message";
import {
  claim_submitted,
  match_event_get,
  open_match_event,
} from "$/pg/queries/match";
import { npo_admins } from "$/pg/queries/user";
import type { Route } from "./+types/route";
import { type Schema, schema } from "./schema";

/** an unexpired donations cookie entry for this donation, else a session under the donor's email */
async function donor_access(request: Request, url_id: string, don: IDonation) {
  // cookie first: a guest checkout has no session to fall back on
  const expiry_per_intent = await donations_cookie
    .parse(request.headers.get("cookie"))
    .then<IDonationIntentExpiries>((x) => x || {});
  // checkout keys its entry by the row's own id, which a legacy v1 id in the
  // url (resolved by `donation_get`) never matches
  const unexpired = (k: string) => (expiry_per_intent[k] ?? 0) >= Date.now();
  if (unexpired(don.id) || unexpired(url_id)) {
    return { is_donor: true, user: undefined };
  }
  const { user } = await get_session(request);
  const is_donor =
    !!user && user.email.toLowerCase() === don.from_email.toLowerCase();
  return { is_donor, user };
}

/** allowlist, so a column added to the row stays private until named here */
const to_public = (don: IDonation) => ({
  id: don.id,
  created_at: don.created_at,
  amount: { base: don.amount.base },
  currency: don.currency,
  to_id: don.to_id,
  to_name: don.to_name,
  to_type: don.to_type,
  source: don.source,
  form_id: don.form_id,
  from_public_msg_to_npo: don.from_public_msg_to_npo,
});

async function match_outcome(don: IDonation) {
  // keyed off the row's own id, not `params.id` — `donation_get` also resolves
  // legacy v1 ids, and the event's foreign key points at the former.
  const match = await match_event_get(don.id);

  // the employer's own donation row — the only place the amount that actually
  // arrived is written. read behind the stamp, never on the ordinary path: this
  // loader runs on every view of the page and all but a handful of them will
  // never have a match. the pair is written together under a both-or-neither
  // check, so the second test costs nothing and keeps this off an assertion.
  const matched_don =
    match?.matched_at && match.matched_donation_id
      ? await donation_get(match.matched_donation_id)
      : null;

  return {
    // the donor said so; nothing else could tell us. additive field — an older
    // bundle that doesn't read it is unaffected.
    match_filed: !!match?.submitted_at,
    // one flag, decided in one place: a refund can reach this screen either as
    // a voided event or as a donation that never had one.
    match_voided: is_gift_returned(don.status, match?.voided_at),
    // undefined until an employer's money is recorded against the gift. flat
    // and additive, like the two flags above — an older bundle that doesn't
    // read it still renders the panel it always did.
    match_arrived: matched_don
      ? // the base amount, not the tip: a match is a settled row born with
        // `tip: 0`, and the base is the money the employer actually sent
        { amount: matched_don.amount.base, currency: matched_don.currency }
      : undefined,
  };
}

export const loader = async ({ request, params }: Route.LoaderArgs) => {
  const url = new URL(request.url);
  const don = await donation_get(params.id);
  if (!don) throw resp.status(404, "donation not found");

  const { is_donor } = await donor_access(request, params.id, don);

  const base_url = url.origin;
  const donate_thanks_path = href("/donations/:id", { id: params.id });
  const donate_path =
    don.to_type === "fund"
      ? href("/donate-fund/:fund_id", { fund_id: don.to_id })
      : href("/donate/:id", { id: don.to_id });
  const donate_url = `${base_url}${donate_path}`;
  const donate_thanks_url = `${base_url}${donate_thanks_path}`;
  const profile_path =
    don.to_type === "fund"
      ? href("/campaigns/:fund_id", { fund_id: don.to_id })
      : href("/org/:org", { org: don.to_id });
  const profile_url = `${base_url}${profile_path}`;

  return {
    ...to_public(don),
    // the whole row, private fields included, and the match outcome are the donor's alone
    ...(is_donor ? { ...don, ...(await match_outcome(don)) } : {}),
    is_donor,
    donate_url,
    donate_thanks_url,
    profile_url,
  };
};

export const action = async ({ request, params }: Route.ActionArgs) => {
  const fv = await getValidatedFormData<Schema>(
    request,
    valibotResolver(schema)
  );
  if (fv.errors) return fv;

  const { data: p } = fv;

  const don = await donation_get(params.id);
  if (!don) throw resp.status(404, "donation not found");
  // employer capture is not recipient-shaped — a fund donation reaches the same
  // nonprofits and is just as matchable, so it and the filing claim that
  // follows it are allowed here alongside the public message.
  if (
    don.to_type === "fund" &&
    p.type !== "public_msg" &&
    p.type !== "employer" &&
    p.type !== "filed"
  ) {
    throw resp.status(
      400,
      "cannot add tribute or private messages to fund donations"
    );
  }

  const access = await donor_access(request, params.id, don);
  if (!access.is_donor) {
    if (!access.user) return to_auth(request);
    throw resp.status(403, "not authorized");
  }

  if (p.type === "tribute" && !don.tribute) {
    await donation_update(db, don.id, { tribute: p });

    const amount_usd = don.amount.base / don.upusd;

    //send only if paid
    if (p.notif && is_paid(don.status)) {
      const data: dtn.IData = {
        to_name: don.to_name,
        in_honor_of: p.full_name,
        notif_to_full_name: p.notif.to_fullname,
        from: {
          first_name: from_full(don.from_name).fn ?? "Anonymous",
          full_name: don.from_name ?? "Anonymous",
        },
        from_msg: p.notif.from_msg,
        amount: to_amount(don.amount.base, amount_usd, don.currency),
      };
      const { node, subject } = dtn.template(data);

      await send_email({ node, to: [p.notif.to_email], subject });
    }
    return dataWithSuccess(null, "Tribute added to donation.");
  }

  if (p.type === "public_msg" && !don.from_public_msg_to_npo) {
    if (!is_paid(don.status)) {
      // only write to holding record, don't send email yet - it will be
      await donation_update(db, don.id, {
        from_public_msg_to_npo: p.msg,
        from_public: true,
      });
      return dataWithSuccess(null, "Your message is posted!");
    }

    await db.transaction(async (tx) => {
      await donation_update(tx, don.id, {
        from_public_msg_to_npo: p.msg,
        from_public: true,
      });
      await donation_message_put(tx, {
        id: don.id,
        date: new Date().toISOString(),
        amount: don.amount.base,
        donation_id: don.id,
        donor_message: p.msg,
        donor_name: don.from_name || "Anonymous",
        npo_id: don.to_id,
      });
    });
    return dataWithSuccess(null, "Your message is posted.");
  }
  if (p.type === "employer" && !don.from_company_name) {
    // per-donation, like every other field on this screen — there is no donor
    // entity to hang an employer off, so a later donation asks again.
    await donation_update(db, don.id, { from_company_name: p.company_name });

    // unpaid donations enqueue nothing: settlement reads the name we just wrote
    // and emits the same message itself, so a pack for a gift that never
    // completed is impossible rather than merely unlikely. the two paths share
    // a dedupe key, so a donor who arrives here after settling gets one pack.
    // a refunded donation is not paid either, so it takes the same silent
    // branch — nothing is queued for a gift that went back.
    if (is_paid(don.status)) {
      await enqueue(
        msg("don-match", { id: don.id, from_company_name: p.company_name })
      );
      return dataWithSuccess(
        null,
        "Thanks! We're emailing you what to file with them."
      );
    }
    return dataWithSuccess(
      null,
      "Thanks! We've noted your employer on this donation."
    );
  }
  if (p.type === "filed") {
    // the panel this button lives on is universal, so a donor who never named
    // an employer has no event row yet — nothing opened one for them. same
    // open-then-claim as the pack handler, and for the same reason: the insert
    // is idempotent, so arriving here twice cannot produce two events.
    await open_match_event(don.id);
    const claimed = await claim_submitted(don.id);

    // lost the claim: already filed. a refresh or a double-click, not a
    // failure — and the heads-up must not go out a second time, so it is
    // inside the gate rather than after it.
    if (claimed) {
      const data: dmfn.IData = {
        id: don.id,
        date: to_pretty_utc(don.created_at),
        // the base gift, not the tip — the tip is a separate donation to us and
        // is not what an employer matches
        amount: to_amount(
          don.amount.base,
          don.amount.base / don.upusd,
          don.currency
        ),
        to_name: don.to_name,
        from: {
          first_name: from_full(don.from_name).fn || "there",
          full_name: don.from_name || "Anonymous",
        },
        from_email: don.from_email,
        employer_name: don.from_company_name,
        base_url,
      };
      const { node, subject } = dmfn.template(data);
      // to us, never the beneficiary: we are the charity on the receipt, so the
      // employer's verification request lands here and the nonprofit could not
      // answer it.
      const res = await send_email({ node, subject, to: [bg_emails.hi] });
      if (!res.data) console.error("match filed notif NOT sent:", don.id);
    }

    // one copy either way — the donor did the same thing whether or not their
    // click won the claim. promises only our side of it; whether the employer
    // pays out is theirs and we hold nothing about it.
    return dataWithSuccess(
      null,
      "Thanks for letting us know! We'll answer your employer's verification request."
    );
  }
  if (
    p.type === "private_msg" &&
    // hasn't sent one yet
    !don.from_private_msg_to_npo
  ) {
    await donation_update(db, don.id, { from_private_msg_to_npo: p.msg });

    if (!is_paid(don.status)) {
      return dataWithSuccess(null, "Your private message is sent.");
    }

    // send email to npo admins
    const adms = await npo_admins(+don.to_id);

    const data: dpm.IData = {
      id: don.id,
      amount: to_amount(
        don.amount.base,
        don.amount.base / don.upusd,
        don.currency
      ),
      date: to_pretty_utc(don.created_at),
      to_name: don.to_name,
      from: {
        first_name: from_full(don.from_name).fn || "Anonymous",
        full_name: don.from_name || "Anonymous",
      },
      message: p.msg,
    };
    const { node, subject } = dpm.template(data);

    const res = await send_email({
      node,
      subject,
      to: adms.map((a) => a.email),
    });

    console.info(res);
    return dataWithSuccess(null, "Your private message is sent.");
  }
};
