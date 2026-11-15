import { report_error } from "#/errors/report";
import { group_by } from "@/helpers/array";
import type { ICommission } from "@/referrals";
import { stage } from "$/env";
import { aws_monitor } from "$/kit/slack";
import { owed_netting_on, undo_deductions } from "$/payouts/owed-run";
import { settle_referrer_commissions } from "$/payouts/settle-commissions";
import { payout_total } from "$/payouts/transfer";
import { wise_pay } from "$/payouts/wise-pay";
import { resend_all_returned_commissions } from "$/payouts/wise-return-commission";
import { commissions_all_by_status } from "$/pg/queries/referrer";
import {
  CREDIT_BY_HAND,
  referrer_of,
  refunded_in_flight_lines,
} from "$/refund/commission";
import { get_referrer } from "./helpers";

const lambda = `commissions-processor:${stage}`;

export async function index() {
  try {
    await alert_unsettled_claims();
    // before the pending read: a referrer on a new payout account is paid now
    await resend_all_returned_commissions(
      async (id) => (await get_referrer(id))?.pay_id
    );
    const items = await commissions_all_by_status("pending");

    if (items.length === 0) {
      await aws_monitor.send_alert({
        type: "NOTICE",
        from: lambda,
        title: "No commissions to process",
        body: `No commissions to process for ${stage}`,
      });
      return { statusCode: 200, body: "No commissions to process" };
    }

    const grouped = items.reduce(
      (acc, curr) => {
        const key = (curr.referrer_user ?? curr.referrer_npo)!;
        acc[key] ||= [];
        acc[key].push(curr);
        return acc;
      },
      {} as { [index: string]: ICommission[] }
    );

    for (const [referrer, sources] of Object.entries(grouped)) {
      await process_item(referrer, sources);
    }

    return { statusCode: 200, body: "Done processing commissions" };
  } catch (err) {
    report_error(err);
    return { statusCode: 500, body: "Something went wrong" };
  }
}

/**
 * a processing commission was claimed by a transfer and never paid or
 * released: a killed run, a failed release, or a transfer whose funding or
 * record is unknown. the pending read never returns it, so without this it
 * sits unpaid and unannounced
 */
async function alert_unsettled_claims() {
  try {
    const stuck = await commissions_all_by_status("processing");
    if (stuck.length === 0) return;
    const by_claim = group_by(
      stuck,
      (c) => `${c.referrer_user ?? c.referrer_npo} ref ${c.ref || "unknown"}`
    );
    const lines = Object.entries(by_claim).map(([claim, cs = []]) => {
      const line = `${claim}: ${cs.map((c) => c.donation_id).join(", ")}`;
      const first = cs[0]!;
      return first.ref
        ? `${line}\n  to reset: ${undo_deductions(referrer_of(first), first.ref)}`
        : line;
    });
    const refs = [...new Set(stuck.flatMap((c) => (c.ref ? [c.ref] : [])))];
    const in_flight = await refunded_in_flight_lines(refs).catch((err) => {
      report_error(err);
      return [];
    });
    await aws_monitor.send_alert({
      type: "ERROR",
      from: lambda,
      title: "commissions claimed but not paid",
      body: [
        "reconcile in Wise before resetting any to pending",
        ...lines,
        ...(in_flight.length > 0
          ? [
              `refunded while a claim held them, so recorded as owed by the referrer: once that transfer is confirmed unfunded, ${CREDIT_BY_HAND}`,
              ...in_flight,
            ]
          : []),
      ].join("\n"),
    });
  } catch (err) {
    report_error(err);
  }
}

async function process_item(ref_id: string, items: ICommission[]) {
  try {
    const ref = await get_referrer(ref_id);
    if (!ref) throw new Error(`referrer:${ref_id} not found`);

    const nets = await owed_netting_on();
    // netting may settle one owing it all with no transfer
    if (!nets && !ref.pay_id) {
      return console.info(`referrer:${ref_id} has no payout method`);
    }
    // skips the locking claim for a referrer still under it; the claim rechecks.
    // netting judges the minimum on the net, and owing it all needs no minimum
    const snapshot = payout_total(items.map((i) => i.amount));
    if (!nets && snapshot < ref.pay_min) {
      return console.info(
        `referrer:${ref_id} payout ${snapshot} is less than minimum ${ref.pay_min}`
      );
    }

    const pay_id = ref.pay_id;
    const res = await settle_referrer_commissions(
      { id: ref_id, pay_min: ref.pay_min },
      pay_id
        ? {
            pay_id,
            pay: (wise_ref, total) => wise_pay(pay_id, total, wise_ref),
          }
        : null
    );
    if (res.status === "recovered") {
      await aws_monitor.send_alert({
        type: "NOTICE",
        from: lambda,
        title: `Commission recovered as owed for ${ref_id}`,
        fields: [
          { name: "amount", value: res.total.toString() },
          { name: "ref_id", value: res.ref },
        ],
      });
      return;
    }
    if (res.status !== "paid") {
      return console.info(`referrer:${ref_id} not paid: ${res.status}`);
    }

    await aws_monitor.send_alert({
      type: "NOTICE",
      from: lambda,
      title: `Commission paid for ${ref_id}`,
      fields: [
        { name: "amount", value: res.total.toString() },
        { name: "name", value: ref.name },
        { name: "email", value: ref.email },
        { name: "transfer_id", value: res.transfer_id },
        { name: "ref_id", value: res.ref },
      ],
    });
  } catch (err) {
    report_error(err, { ref_id });
  }
}
