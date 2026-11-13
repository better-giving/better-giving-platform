import { report_error } from "#/errors/report";
import { group_by } from "@/helpers/array";
import type { IPayout, IPendingStatus } from "@/payouts";
import { stage } from "$/env";
import { aws_monitor } from "$/kit/slack";
import { owed_netting_on, undo_deductions } from "$/payouts/owed-run";
import { settle_npo_payouts } from "$/payouts/settle";
import { wise_pay } from "$/payouts/wise-pay";
import {
  hold_alert_claim,
  hold_alert_unclaim,
  npo_returned_payouts,
  pending_payouts,
  processing_payouts,
} from "$/pg/queries/payout";
import { type GrantEligibility, grant_eligibility } from "./eligibility";

// optional npo_id to retry a single npo
interface IInput {
  npo_id?: number;
}

const fn = `grants-processor:${stage}`;

export async function index(event?: IInput) {
  try {
    await alert_unsettled_claims();
    const grants = await pending_payouts();

    if (grants.length === 0) {
      await aws_monitor.send_alert({
        type: "NOTICE",
        from: fn,
        title: "No grants to process",
        body: `No grants to process for ${stage}`,
      });
      return { statusCode: 200, body: "No grants to process" };
    }

    const by_npo = group_by(grants, (g) => g.npo_id);
    const target_npo = event?.npo_id?.toString();

    for (const [npo, items = []] of Object.entries(by_npo).filter(
      ([id]) => !target_npo || id === target_npo
    )) {
      await process_item(+npo, items as IPayout<IPendingStatus>[]);
    }
    return { statusCode: 200, body: "Done processing grants" };
  } catch (err) {
    report_error(err);
    return { statusCode: 500, body: "Something went wrong" };
  }
}

/**
 * a processing row was claimed and never settled or released: a killed run, a
 * failed release, a transfer whose funding or record is unknown, or a
 * concurrent run still in flight. `pending_payouts` never returns these rows,
 * so without this they sit unpaid and unannounced
 */
async function alert_unsettled_claims() {
  try {
    const stuck = await processing_payouts();
    if (stuck.length === 0) return;
    // one line per claim: its ref is the customerTransactionId to look up in wise
    const by_claim = group_by(
      stuck,
      (p) => `npo:${p.npo_id} ref ${p.ref || "unknown"}`
    );
    const lines = Object.entries(by_claim).map(([claim, ps = []]) => {
      const line = `${claim}: ${ps.map((p) => p.id).join(", ")}`;
      const { npo_id, ref } = ps[0]!;
      return ref
        ? `${line}\n  to reset: ${undo_deductions({ npo_id }, ref)}`
        : line;
    });
    await aws_monitor.send_alert({
      type: "ERROR",
      from: fn,
      title: "payouts claimed but not settled",
      body: `reconcile in Wise before resetting any to pending\n${lines.join("\n")}`,
    });
  } catch (err) {
    report_error(err);
  }
}

/** once per returned settlement: the npo stays held run after run until a new
 * account is the one the run pays, and ops needs telling only when it starts */
async function alert_held(el: Extract<GrantEligibility, { status: "held" }>) {
  const { npo, hold, total } = el;
  if (!(await hold_alert_claim(hold.settlement_id))) return;
  try {
    const returned = await npo_returned_payouts(npo.id);
    await aws_monitor.send_alert({
      type: "ERROR",
      from: fn,
      title: `Grants held for npo:${npo.id}: ${npo.name}`,
      body: "its last transfer came back, so nothing more is sent until a new bank account is approved and made its default; the returned payouts then go out with the next run",
      fields: [
        {
          name: "returned",
          value: returned
            ? `${returned.count} payout(s), ${returned.total}`
            : "none left",
        },
        { name: "pending", value: total.toString() },
        { name: "settlement", value: hold.settlement_id },
      ],
    });
  } catch (err) {
    report_error(err, { npo_id: npo.id });
    await hold_alert_unclaim(hold.settlement_id);
  }
}

async function process_item(npo_id: number, items: IPayout<IPendingStatus>[]) {
  try {
    // a run that doesn't net skips the locking claim tx for an npo still under
    // its minimum; one that nets judges the minimum in the claim, under lock
    const el = await grant_eligibility(
      npo_id,
      items.map((i) => i.amount),
      await owed_netting_on()
    );
    if (el.status === "not_found") throw new Error(`npo:${npo_id} not found`);
    if (el.status === "skipped") {
      console.info(`npo:${npo_id} not paid: ${el.reason}`);
      return;
    }
    if (el.status === "held") return await alert_held(el);
    const { npo, minimum, wise_id } = el;

    const res = await settle_npo_payouts(
      { id: npo.id, name: npo.name, payout_minimum: minimum },
      items.map((i) => i.id),
      wise_id === null
        ? null
        : {
            ref_key: wise_id,
            pay: (ref, total) => wise_pay(+wise_id, total, ref),
          }
    );
    if (res.status === "recovered") {
      await aws_monitor.send_alert({
        type: "NOTICE",
        from: fn,
        title: `Grant recovered as owed for npo:${npo.id}: ${npo.name}`,
        fields: [
          { name: "amount", value: res.total.toString() },
          { name: "ref_id", value: res.ref },
        ],
      });
      return;
    }
    if (res.status !== "settled") {
      console.info(`npo:${npo_id} not paid: ${res.status}`);
      return;
    }

    await aws_monitor.send_alert({
      type: "NOTICE",
      from: fn,
      title: `Grant paid for npo:${npo.id}: ${npo.name}`,
      fields: [
        { name: "amount", value: res.total.toString() },
        { name: "transfer_id", value: res.transfer_id },
        { name: "ref_id", value: res.ref },
      ],
    });
  } catch (err) {
    report_error(err, { npo_id });
  }
}
