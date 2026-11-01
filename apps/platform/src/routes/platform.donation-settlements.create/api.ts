import * as v from "valibot";
import { partition_destinations } from "#/routes/api.q-handler.$event/partition-destinations";
import type { IDonation, IDonationSettled } from "@/donations";
import type { IMsg } from "@/queue/types";
import type { IInput, IParts } from "@/types/donation-dist";
import { enqueue } from "$/kit/queue";
import { db } from "$/pg/db";
import { is_unique_violation } from "$/pg/errors";
import { donation_get, donation_put } from "$/pg/queries/donation";
import { claim_match_arrival, match_event_get } from "$/pg/queries/match";
import { nav_ltd } from "$/pg/queries/nav";
import { npo_get } from "$/pg/queries/npo";
import type { MatchEvent } from "$/pg/schema/match";
import type { ISettlementPreview } from "$/settlement/preview";
import { preview_settlement } from "$/settlement/preview";
import { settle_npo } from "$/settlement/settle-npo";
import type { Route } from "./+types/route";
import { send_match_arrived } from "./send-match-arrived";

/**
 * text whose blank reads as `fallback` — an absent key, "" and whitespace alike.
 *
 * a form posts every key it holds, so a box the admin never touched arrives as
 * "" rather than missing, and `v.optional` only substitutes its default for
 * `undefined`. the blank has to be folded away inside the pipe or the box the
 * ui says is optional refuses the whole settlement.
 */
const text = (fallback: string) =>
  v.optional(
    v.pipe(
      v.string(),
      v.transform((s) => s.trim() || fallback)
    ),
    fallback
  );

/**
 * the one refusal that names no field: a page loaded before the key existed
 * posts none, and the fix is the reload, not a box to correct
 */
const stale_page_msg = "This page is out of date. Reload it and confirm again.";

const schema = v.object({
  from: v.optional(v.picklist(["cheque", "daf", "stocks", "match"]), "cheque"),
  /**
   * the nonprofit the admin picked. absent when a matched gift names the
   * recipient instead — a fund gift has no nonprofit of its own to pick.
   */
  npo_id: v.optional(
    v.pipe(
      v.string(),
      v.transform((s) => s.trim()),
      v.transform((s) => (s ? Number(s) : undefined)),
      v.check(
        (n) => n === undefined || (Number.isInteger(n) && n >= 1),
        "not a nonprofit id"
      )
    )
  ),
  donor_name: text("Anonymous"),
  /** checked after the blank is folded away, so an untouched box still passes
   * on the house address while a typed one has to be an address */
  donor_email: v.pipe(text("settlement@better.giving"), v.email()),
  net: v.pipe(v.string(), v.transform(Number), v.minValue(0.01)),
  reference: v.pipe(v.string(), v.nonEmpty()),
  /**
   * the donor's original gift this payment matches — the id the employer was
   * asked to quote, never the employer's own new row. optional: an employer's
   * cheque that names nothing is still money that has to be recorded.
   */
  for_donation_id: v.optional(v.string(), ""),
  /**
   * minted by the client when the preview opens, so a confirm whose response
   * was lost replays under the same key. the settlement's ids derive from it,
   * and the donation's primary key refuses the second write.
   *
   * required, with no server-minted fallback: a key minted here is fresh on
   * every post, so the page that lost its response would settle twice. the
   * absent key folds to "" only so the refusal reads as `stale_page_msg` —
   * an object's missing-key issue carries the object's message, not this one's.
   */
  idempotency_key: v.pipe(
    v.optional(v.string(), ""),
    v.nonEmpty(stale_page_msg),
    v.uuid()
  ),
});

/**
 * thrown to roll the settlement back when the arrival claim refuses.
 *
 * the claim is the last write in the transaction and the only one that can
 * decline, so a refusal has to take the employer's donation row and the npo
 * credit down with it — otherwise the admin is told "no" while the money sits
 * recorded. caught immediately outside the transaction; never propagates.
 */
class MatchRefusedError extends Error {}

// builds the IInput used by both loader (preview) and action (execute)
function build_input(
  npo_id: number,
  npo_name: string,
  net: number,
  nav_price: number,
  sttl_id: string,
  parent_id: string,
  now: string,
  via: string,
  parsed: { donor_email: string; donor_name: string; reference: string }
): IInput {
  const zero = { base: 0, tip: 0, fee_allowance: 0 } as const;
  const ps: IParts = {
    amnt: { base: net, tip: 0, fee_allowance: 0 },
    amnt_usd: { base: net, tip: 0, fee_allowance: 0 },
    fa: { ...zero },
    sttl: { base: net, tip: 0, fee_allowance: 0 },
    sttl_fee: { ...zero },
    sttl_fa: { ...zero },
  };

  return {
    id: npo_id,
    ps,
    sttl: { id: sttl_id, date: now, currency: "USD" },
    prnt: {
      id: parent_id,
      to_id: npo_id.toString(),
      to_name: npo_name,
      to_members: [],
      type: "npo",
    },
    source: undefined,
    program: undefined,
    nav_price,
    tx: {
      upusd: 1,
      status: "settled",
      updated_at: now,
      currency: "USD",
      source: "bg-marketplace",
      frequency: "one-time",
      via,
      via_extra: parsed.reference,
      from_email: parsed.donor_email,
      from_name: parsed.donor_name,
      from_public: false,
    },
  };
}

/** where a settlement lands — a gift's recipient, or the nonprofit the admin picked */
type ITo = Pick<
  IDonation,
  "to_id" | "to_name" | "to_type" | "to_members" | "to_tip_allowed"
>;

/**
 * the employer's own donation row, and the parent every destination hangs off.
 *
 * a fund recipient is carried through as a fund: the fan-out to its members is
 * a settlement detail and does not reshape the row the money arrived as.
 */
function build_parent(
  id: string,
  sttl_id: string,
  net: number,
  now: string,
  via: string,
  to: ITo,
  parsed: { donor_email: string; donor_name: string; reference: string }
): IDonationSettled {
  return {
    id,
    upusd: 1,
    status: "settled",
    created_at: now,
    updated_at: now,
    amount: { base: net, tip: 0, fee_allowance: 0 },
    currency: "USD",
    source: "bg-marketplace",
    frequency: "one-time",
    via,
    via_extra: parsed.reference,
    from_email: parsed.donor_email,
    from_name: parsed.donor_name,
    from_public: false,
    ...to,
    settlement: {
      id: sttl_id,
      date: now,
      currency: "USD",
      net,
      fee: 0,
    },
  };
}

/**
 * one sentence for both steps.
 *
 * the preview reaches this state as readily as the confirm does, and an admin
 * told two different things about the same settlement has to guess which is
 * true — so the refusal is written once and read from both.
 */
const no_destinations_msg = (gift: {
  id: string;
  to_name: string;
  to_type: string;
}) =>
  gift.to_type === "fund"
    ? `Donation ${gift.id} went to ${gift.to_name}, which has no active nonprofits left — there is nowhere to settle its match`
    : `Donation ${gift.id} went to ${gift.to_name}, which is no longer active — there is nowhere to settle its match`;

const not_found_msg = (id: string) => `Donation ${id} not found`;

/**
 * read from both steps, for the same reason `no_destinations_msg` is.
 *
 * the selector only ever lists active nonprofits, so one reaching here
 * deactivated while the form was open. it has to be refused rather than passed
 * on: `settle_npo` treats an inactive nonprofit as a no-op, so the settlement
 * would record the money against nobody and report success.
 */
const inactive_npo_msg = (npo: { name: string }) =>
  `${npo.name} is no longer active — there is nowhere to settle this`;

/**
 * a fund gift already names its recipient, so a nonprofit picked beside it is a
 * mis-keyed form — the same reading the npo case takes of a nonprofit that
 * disagrees with the gift's. dropping it instead would leave that nonprofit's
 * name on the success screen having been sent nothing.
 */
const fund_gift_npo_msg = (gift: { id: string; to_name: string }) =>
  `Donation ${gift.id} went to ${gift.to_name} — a match follows the fund the gift was given to, not a nonprofit picked beside it`;

export const loader = async ({ url }: Route.LoaderArgs) => {
  const { searchParams: s } = url;
  const npo_id = Number(s.get("npo_id"));
  const gross = Number(s.get("net"));
  /**
   * the gift an employer's payment matches. added alongside `npo_id`/`net`,
   * never in place of them — a preview keyed on a nonprofit still works on its
   * own, which is the only thing older bundles know how to ask for.
   */
  const for_id = (s.get("for_donation_id") ?? "").trim();

  /**
   * `error` says why a *completed* load produced no records — a null preview on
   * its own is a dead end, since the form has nothing to transition to and
   * nothing to show. null while the admin has simply not asked for anything yet.
   */
  const none = (error: string | null = null) => ({
    preview: null,
    previews: [] as ISettlementPreview[],
    error,
  });
  if (!gross || gross <= 0) return none();

  const now = new Date().toISOString();

  const gift = for_id ? await donation_get(for_id) : undefined;
  if (for_id && !gift) return none(not_found_msg(for_id));

  // told here as well as at confirm: an admin who has picked a nonprofit and
  // typed a fund's gift id should find out before reviewing records that will
  // be refused
  if (gift && gift.to_type === "fund" && npo_id > 0) {
    return none(fund_gift_npo_msg(gift));
  }

  if (gift) {
    // the gift decides the recipient, so a fund's members each get a preview
    const parent = build_parent(
      "preview",
      "preview",
      gross,
      now,
      "cheque",
      {
        to_id: gift.to_id,
        to_name: gift.to_name,
        to_type: gift.to_type,
        to_members: gift.to_members,
        to_tip_allowed: gift.to_tip_allowed,
      },
      { donor_email: "", donor_name: "", reference: "" }
    );
    const { destinations } = await partition_destinations(parent);
    if (destinations.length === 0) return none(no_destinations_msg(gift));

    const previews = (
      await Promise.all(destinations.map((d) => preview_settlement(d)))
    ).filter((p): p is ISettlementPreview => p != null);
    // every destination priced to nothing is the same dead end as having none:
    // the filter above must not be able to empty the list silently
    if (previews.length === 0) return none(no_destinations_msg(gift));

    // `preview` is the field every bundle before this one reads, so it keeps
    // carrying the first destination rather than going null on a fund
    return { preview: previews[0] ?? null, previews, error: null };
  }

  if (!npo_id) return none();

  const nav = await nav_ltd();
  const npo = await npo_get(npo_id);
  if (!npo) return none("NPO not found");
  if (npo.active === false) return none(inactive_npo_msg(npo));

  const input = build_input(
    npo_id,
    npo.name,
    gross,
    nav.price,
    "preview",
    "preview",
    now,
    "cheque",
    {
      donor_email: "",
      donor_name: "",
      reference: "",
    }
  );

  const preview = await preview_settlement(input);
  return { preview, previews: preview ? [preview] : [], error: null };
};

export const action = async ({ request }: Route.ActionArgs) => {
  const fd = await request.formData();
  const result = v.safeParse(schema, Object.fromEntries(fd));
  if (!result.success) {
    // outranks every field: nothing on a stale page is worth correcting, and the
    // pipe goes on to report the blank key as a bad uuid beside it
    if (result.issues.some((i) => i.message === stale_page_msg)) {
      return { ok: false as const, error: stale_page_msg };
    }
    // named, not "Invalid input": the submit happens from the preview step where
    // nothing is editable, so the field is the only thing that tells an admin
    // holding a cheque which box to go back and fix
    return {
      ok: false as const,
      error: result.issues
        // `getDotPath` is null for an issue raised on the object itself, which
        // has no field to name
        .map((i) => `${v.getDotPath(i) ?? "form"}: ${i.message}`)
        .join("; "),
    };
  }
  const parsed = result.output;

  // only a match attaches to anything; the field is inert for the other
  // sources, and an empty box is the same as an unnamed employer cheque, not a
  // bad id
  const for_id = parsed.from === "match" ? parsed.for_donation_id.trim() : "";

  // `donation_get` also resolves legacy v1 ids, so every write below keys off
  // the returned row's own id — that is what the event's foreign key points at.
  const gift = for_id ? await donation_get(for_id) : undefined;
  if (for_id && !gift) {
    return { ok: false as const, error: not_found_msg(for_id) };
  }

  // the match follows the gift, not the form: an employer matches the donation
  // they were shown, so the beneficiary is the original's. a form that names a
  // different nonprofit is a mis-keyed id rather than a second intent, and is
  // refused instead of quietly reconciled either way.
  //
  // only checkable for a gift that went to one nonprofit — a fund gift's
  // `to_id` is a fund id, so there is nothing to compare a nonprofit against,
  // and the form stops asking for one once a donation id is filled in.
  if (
    gift &&
    gift.to_type === "npo" &&
    parsed.npo_id != null &&
    Number(gift.to_id) !== parsed.npo_id
  ) {
    return {
      ok: false as const,
      error: `Donation ${gift.id} went to ${gift.to_name} — a match goes to the same nonprofit as the gift it matches`,
    };
  }

  // the other half of the same rule: a fund gift names its recipient too, so a
  // nonprofit picked beside it disagrees with the gift just as surely
  if (gift && gift.to_type === "fund" && parsed.npo_id != null) {
    return { ok: false as const, error: fund_gift_npo_msg(gift) };
  }

  // a fund gift resolves to no single nonprofit; its members are found below
  const npo_id = gift
    ? gift.to_type === "npo"
      ? Number(gift.to_id)
      : undefined
    : parsed.npo_id;
  if (!gift && npo_id == null) {
    return { ok: false as const, error: "Select a nonprofit" };
  }

  const npo = npo_id == null ? undefined : await npo_get(npo_id);
  if (npo_id != null && !npo) {
    return { ok: false as const, error: "NPO not found" };
  }
  // only the directly picked nonprofit needs this. a gift's recipient goes
  // through `partition_destinations`, which drops inactive npos and fund
  // members alike, and the empty result it leaves is refused below with the
  // sentence that explains the match.
  if (!gift && npo?.active === false) {
    return { ok: false as const, error: inactive_npo_msg(npo) };
  }

  const now = new Date().toISOString();

  const via = parsed.from;
  // the employer's name as the donor typed it, falling back to whatever the
  // admin read off the payment. the employer is not a donor: `donor_email`
  // keeps its settlement placeholder, because no address for them is held.
  const from_name = gift
    ? gift.from_company_name || parsed.reference
    : parsed.donor_name;
  const parent_id = parsed.idempotency_key;
  const sttl_id = `${parsed.from}-${parsed.idempotency_key}`;

  const parent_don = build_parent(
    parent_id,
    sttl_id,
    parsed.net,
    now,
    via,
    npo
      ? {
          to_id: npo.id.toString(),
          to_name: npo.name,
          to_type: "npo",
          to_tip_allowed: npo.hide_bg_tip ?? false,
          to_members: [],
        }
      : {
          to_id: gift!.to_id,
          to_name: gift!.to_name,
          to_type: gift!.to_type,
          to_tip_allowed: gift!.to_tip_allowed,
          to_members: gift!.to_members,
        },
    { ...parsed, donor_name: from_name }
  );

  // a matched gift settles through the same fan-out the queue runs for the gift
  // itself, so a fund's match reaches each of its active members. cheque, DAF,
  // stocks and a match naming no donation keep their single npo destination.
  //
  // resolved before the transaction opens: it is all reads, and they run on the
  // shared connection rather than the tx handle.
  let inputs: IInput[];
  if (gift) {
    inputs = (await partition_destinations(parent_don)).destinations;
  } else {
    // only this branch prices in nav — `partition_destinations` fetches its own
    const nav = await nav_ltd();
    inputs = [
      build_input(
        npo_id!,
        npo!.name,
        parsed.net,
        nav.price,
        sttl_id,
        parent_id,
        now,
        via,
        { ...parsed, donor_name: from_name }
      ),
    ];
  }

  // a fund whose members have all gone inactive has nowhere to put the money.
  // refused rather than recorded against no recipient: an employer's row with
  // no distribution behind it is a credit nobody can be shown to have received.
  if (inputs.length === 0) {
    return { ok: false as const, error: no_destinations_msg(gift!) };
  }

  /**
   * the notifications the settlement owes, carried out of the transaction.
   *
   * returned from the callback rather than pushed into an outer array: on the
   * refusal path the callback throws, so there is no committed value to read
   * and nothing can be sent about money that rolled back.
   */
  let matched: MatchEvent | null;
  let msgs: IMsg[];
  try {
    ({ matched, msgs } = await db.transaction(async (tx) => {
      await donation_put(tx, parent_don);
      const msgs: IMsg[] = [];
      // every destination's msgs, not just the last: a fund's match settles
      // several nonprofits and each is owed its own `don-dist`
      for (const i of inputs) msgs.push(...(await settle_npo(tx, i)).msgs);
      if (!gift) return { matched: null, msgs };
      // last, because the stamp points at the employer's row and that row has to
      // exist first. same `now` and same handle as the money: two clocks would
      // date the arrival differently from the gift recording it.
      const row = await claim_match_arrival(tx, gift.id, parent_id, now);
      if (!row) throw new MatchRefusedError();
      return { matched: row, msgs };
    }));
  } catch (err) {
    // the parent donation row is the transaction's first write and is keyed by
    // the idempotency key, so a replay fails there and rolls back before any
    // credit. reported as the success it already was: a refusal sends the admin
    // back to preview again under a new key, which settles the money twice.
    if (is_unique_violation(err, "donations_pkey")) {
      return { ok: true as const, replayed: true as const };
    }
    if (!(err instanceof MatchRefusedError)) throw err;
    // the claim gates on two things and says which by way of the row it left
    // behind — a null return can only come from a row that already existed,
    // since an unstamped one is opened by the claim itself. an admin holding a
    // cheque needs to know which of the two happened.
    const evt = await match_event_get(gift!.id);
    return {
      ok: false as const,
      error: evt?.voided_at
        ? `Donation ${gift!.id} was refunded — there is nothing left to match`
        : `A match is already recorded for donation ${gift!.id}`,
    };
  }

  // after the commit, never inside it: a refused mail must not roll back money
  // that has already moved. sent only on a claim that actually won, so a
  // resubmitted form cannot mail the donor twice.
  //
  // the employer gets nothing at all — no receipt, no acknowledgement. they are
  // not the donor, we hold no address or consent for them, and the gift is not
  // theirs to deduct. that is deliberate; it is not an omission to fix.
  if (matched && gift) await send_match_arrived(gift, parsed.net);

  /**
   * the same handover the queue path makes after settling a nonprofit: without
   * it a manually settled npo is never mailed, no country metric moves and no
   * webhook fires, for money already in its balance.
   *
   * swallowed, unlike the queue path where a throw means qstash redelivers.
   * this rail has no retry and the money is committed, so a qstash outage would
   * otherwise show the admin a failure for a settlement that worked and invite
   * them to re-key a payment already recorded. logged loudly instead — the
   * missing notification is recoverable by hand, a double settlement is not.
   *
   * `send_match_arrived` above needs no such wrapper: `send_email` never
   * throws, and it already logs its own provider refusals.
   */
  if (msgs.length) {
    try {
      await enqueue(...msgs);
    } catch (err) {
      console.error("settlement msgs NOT enqueued:", sttl_id, err);
    }
  }

  return { ok: true as const };
};
