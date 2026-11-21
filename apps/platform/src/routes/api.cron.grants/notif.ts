import type { grants_schedule } from "emails";
import { grants_schedule as gs } from "emails";
import { report_error } from "#/errors/report";
import { emails } from "@/constants/common";
import { group_by } from "@/helpers/array";
import { send_email } from "$/email";
import { wise as wise_env } from "$/env";
import { wise } from "$/kit/wise";
import { net_owed } from "$/payouts/net-owed";
import { owed_netting_on } from "$/payouts/owed-run";
import { payout_total } from "$/payouts/transfer";
import { db } from "$/pg/db";
import { outstanding_for_npo } from "$/pg/queries/owed";
import { pending_payouts } from "$/pg/queries/payout";
import { type GrantEligibility, grant_eligibility } from "./eligibility";

function to_yymm(date: string) {
  const parts = date.split("-");
  return parts[0].substring(2, 4) + parts[1];
}

type Row = grants_schedule.IData["rows"][number];

type Netted = Extract<GrantEligibility, { status: "nets" | "manual_wire" }>;

/** what the run will do for an npo whose owed amounts it nets, as the run's
 * own plan reads it. a manual-wire npo the plan would pay is left to a wire */
async function netted_row(el: Netted): Promise<Row & { net: number }> {
  const owed = await outstanding_for_npo(db, el.npo.id);
  const plan = net_owed(el.total, owed, el.minimum);
  const base = {
    id: el.npo.id,
    name: el.npo.name,
    amount: el.total,
    min: el.minimum,
  };
  if (plan.status === "under_minimum") {
    const { net, deductions } = plan;
    return { ...base, net, effect: "skipped", deductions };
  }
  const deductions = [
    ...plan.recovered,
    ...plan.repaid.map((r) => ({ ...r, usd: -r.usd })),
  ];
  if (plan.status === "recover_only") {
    return { ...base, net: 0, effect: "recovered", deductions };
  }
  const effect =
    el.status === "manual_wire"
      ? plan.net > 0
        ? "manual_wire"
        : "skipped"
      : el.wise_id
        ? "pass"
        : "skipped";
  return { ...base, net: plan.net, effect, deductions };
}

/** a manual-wire npo's row when the run nets nothing: due a wire on the
 * minimum the run pays a wise npo at */
function gross_wire_row(
  el: Extract<GrantEligibility, { status: "manual_wire" }>
): Row {
  const { npo, total, minimum } = el;
  const due = total > 0 && total >= minimum;
  return {
    id: npo.id,
    name: npo.name,
    amount: total,
    min: minimum,
    effect: due ? "manual_wire" : "skipped",
  };
}

/**
 * 1 day before the 3-day cycle
 */
export async function index() {
  try {
    const grants = await pending_payouts();
    if (grants.length === 0) {
      console.info("No pending grants to process");
      return;
    }

    const by_npo = group_by(grants, (g) => g.npo_id);

    const rows: grants_schedule.IData["rows"] = [];
    const passing: number[] = [];
    const nets = await owed_netting_on();

    for (const [npo_id, items = []] of Object.entries(by_npo)) {
      // el.total is the cents the payout run sends: notice, minimum and run agree
      const el = await grant_eligibility(
        +npo_id,
        items.map((i) => i.amount),
        nets
      );
      if (el.status === "not_found") {
        console.info(`NPO ${npo_id} not found, skipping`);
        continue;
      }
      if (el.status === "manual_wire" && !nets) {
        rows.push(gross_wire_row(el));
        continue;
      }
      if (el.status === "nets" || el.status === "manual_wire") {
        const row = await netted_row(el);
        rows.push(row);
        if (row.effect === "pass") passing.push(row.net);
        continue;
      }
      const effect = el.status === "pass" ? "pass" : "skipped";
      rows.push({
        id: el.npo.id,
        name: el.npo.name,
        amount: el.total,
        min: el.minimum,
        effect,
      });
      if (effect === "pass") passing.push(el.total);
    }
    const total_grant = payout_total(passing);

    const usd_bal = await wise.balance(
      +wise_env.balance_id_usd,
      +wise_env.profile_id
    );
    const usd_bal_val = usd_bal.totalWorth.value;

    const { node, subject } = gs.template({
      rows,
      total_grant,
      wise_usd_balance: usd_bal_val,
      report_period: to_yymm(new Date().toISOString()),
      low_balance: usd_bal_val < total_grant,
    });

    const res = await send_email({
      node,
      subject,
      to: [emails.tim, emails.chauncey, emails.jms],
    });

    console.info("sent report", res);
  } catch (err) {
    report_error(err);
  }
}
