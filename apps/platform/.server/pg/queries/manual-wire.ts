import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { mask_string } from "#/helpers/mask-string";
import type { IManualWireRow } from "#/pages/platform-admin/manual-wires/types";
import { to_units } from "@/helpers/decimal";
import { min_payout_amount } from "@/npo/schema";
import type { PayoutMethod } from "@/payouts";
import { payout_cents } from "../../payouts/amount";
import { net_owed } from "../../payouts/net-owed";
import { owed_netting_on } from "../../payouts/owed-run";
import { db } from "../db";
import { dists } from "../schema/dist";
import { donation_donors } from "../schema/donation";
import { npos } from "../schema/npo";
import { manual_wires, payouts } from "../schema/payout";
import { npo_default_bapp } from "./banking";
import type { DbOrTx } from "./helpers";
import { outstanding_for_npo } from "./owed";

type ManualWireInsert = typeof manual_wires.$inferInsert;

export async function manual_wire_put(db_: DbOrTx, data: ManualWireInsert) {
  await db_.insert(manual_wires).values(data);
}

/** the wire recorded under this provider's reference, if any */
export async function manual_wire_by_tx(
  provider: string,
  provider_tx_id: string
) {
  const [row] = await db
    .select({ id: manual_wires.id })
    .from(manual_wires)
    .where(
      and(
        eq(manual_wires.provider, provider),
        eq(manual_wires.provider_tx_id, provider_tx_id)
      )
    );
  return row;
}

/** how the npo is paid; undefined for no such npo */
export async function npo_payout_method(
  db_: DbOrTx,
  npo_id: number
): Promise<PayoutMethod | undefined> {
  const [row] = await db_
    .select({ payout_method: npos.payout_method })
    .from(npos)
    .where(eq(npos.id, npo_id));
  return row?.payout_method;
}

/** what a wire is judged against: how the npo is paid and its own minimum */
export async function npo_wire_terms(npo_id: number) {
  const [row] = await db
    .select({
      id: npos.id,
      name: npos.name,
      payout_method: npos.payout_method,
      payout_minimum: npos.payout_minimum,
    })
    .from(npos)
    .where(eq(npos.id, npo_id));
  return row;
}

/** who a pending payout is for: a gift's donor by email, else name (a
 * donation payout's `source_id` is its dist); a withdrawal by the account it
 * left */
const payout_label = sql<string>`case
  when ${payouts.source} = 'liq' then 'Savings'
  when ${payouts.source} = 'lock' then 'Investments'
  else coalesce(nullif(${donation_donors.email}, ''), nullif(${donation_donors.name}, ''), 'Donation')
end`;

/**
 * every active npo paid by manual wire with a net above 0 pending, by name,
 * with its pending payouts oldest first. each row carries the net the next
 * wire must carry, as `mark_wired` judges it: the gross less what the npo
 * owes, when owed netting is on. a net under the minimum keeps its row, which
 * `mark_wired` refuses
 */
export async function manual_wire_rows(): Promise<IManualWireRow[]> {
  const rows = await db
    .select({
      npo_id: npos.id,
      name: npos.name,
      payout_minimum: npos.payout_minimum,
      id: payouts.id,
      source_id: payouts.source_id,
      label: payout_label,
      date: payouts.date,
      amount: payouts.amount,
    })
    .from(payouts)
    .innerJoin(npos, eq(npos.id, payouts.npo_id))
    .leftJoin(
      dists,
      and(eq(payouts.source, "donation"), eq(dists.id, payouts.source_id))
    )
    .leftJoin(
      donation_donors,
      eq(donation_donors.donation_id, dists.donation_id)
    )
    .where(
      and(
        eq(payouts.type, "pending"),
        eq(npos.payout_method, "manual_wire"),
        eq(npos.active, true)
      )
    )
    .orderBy(asc(npos.name), asc(npos.id), asc(payouts.date), asc(payouts.id));

  const by_npo = new Map<number, typeof rows>();
  for (const r of rows) {
    by_npo.set(r.npo_id, [...(by_npo.get(r.npo_id) ?? []), r]);
  }
  const nets = await owed_netting_on();
  const due = await Promise.all(
    [...by_npo.values()].map(async (of_npo): Promise<IManualWireRow[]> => {
      const { npo_id, name, payout_minimum } = of_npo[0]!;
      const minimum = payout_minimum ?? min_payout_amount;
      const gross_cents = payout_cents(of_npo.map((r) => r.amount));
      const owed = nets ? await outstanding_for_npo(db, npo_id) : [];
      const plan = net_owed(gross_cents / 100, owed, minimum);
      // what the npo owes takes it all: no wire to send
      if (plan.status === "recover_only") return [];
      const net_cents = to_units(plan.net, 2);
      const bank = (await npo_default_bapp(npo_id))?.bank_summary;
      const row: IManualWireRow = {
        npo_id,
        name,
        gross: gross_cents / 100,
        owed: (gross_cents - net_cents) / 100,
        net: net_cents / 100,
        minimum,
        bank: bank || "No bank account on file",
        payouts: of_npo.map(({ id, source_id, label, date, amount }) => ({
          id,
          label,
          ref: mask_string(source_id, 4),
          date,
          amount,
        })),
      };
      return [row];
    })
  );
  return due.flat();
}

/** the npos among `ids` paid by manual wire, which the grants run skips */
export async function npos_manual_wire(ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: npos.id })
    .from(npos)
    .where(and(inArray(npos.id, ids), eq(npos.payout_method, "manual_wire")));
  return new Set(rows.map((r) => r.id));
}
