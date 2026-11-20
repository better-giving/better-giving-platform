import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { IManualWireRow } from "#/pages/platform-admin/manual-wires/types";
import { to_units } from "@/helpers/decimal";
import { min_payout_amount } from "@/npo/schema";
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

/** the ids of every payout of the npo still pending */
export async function npo_pending_payout_ids(
  npo_id: number
): Promise<string[]> {
  const rows = await db
    .select({ id: payouts.id })
    .from(payouts)
    .where(and(eq(payouts.npo_id, npo_id), eq(payouts.type, "pending")));
  return rows.map((r) => r.id);
}

/** who a pending payout is for: a gift's donor by email, else name (a
 * donation payout's `source_id` is its dist); a withdrawal by the account it
 * left */
const payout_label = sql<string>`case
  when ${payouts.source} = 'liq' then 'Savings'
  when ${payouts.source} = 'lock' then 'Investments'
  else coalesce(nullif(${donation_donors.email}, ''), nullif(${donation_donors.name}, ''), 'Unknown donor')
end`;

/**
 * every npo paid by manual wire with payouts pending, by name: what the next
 * wire nets, as `mark_wired` judges it (netting what the npo owes when owed
 * netting is on), with its pending payouts oldest first
 */
export async function manual_wire_rows(): Promise<IManualWireRow[]> {
  const rows = await db
    .select({
      npo_id: npos.id,
      name: npos.name,
      payout_minimum: npos.payout_minimum,
      id: payouts.id,
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
      and(eq(payouts.type, "pending"), eq(npos.payout_method, "manual_wire"))
    )
    .orderBy(asc(npos.name), asc(npos.id), asc(payouts.date), asc(payouts.id));

  const by_npo = new Map<number, typeof rows>();
  for (const r of rows) {
    by_npo.set(r.npo_id, [...(by_npo.get(r.npo_id) ?? []), r]);
  }
  const nets = await owed_netting_on();
  return Promise.all(
    [...by_npo.values()].map(async (of_npo) => {
      const { npo_id, name, payout_minimum } = of_npo[0]!;
      const minimum = payout_minimum ?? min_payout_amount;
      const gross_cents = payout_cents(of_npo.map((r) => r.amount));
      const owed = nets ? await outstanding_for_npo(db, npo_id) : [];
      const plan = net_owed(gross_cents / 100, owed, minimum);
      const net_cents =
        plan.status === "recover_only" ? 0 : to_units(plan.net, 2);
      const bank = (await npo_default_bapp(npo_id))?.bank_summary;
      return {
        npo_id,
        name,
        gross: gross_cents / 100,
        owed: (gross_cents - net_cents) / 100,
        net: net_cents / 100,
        minimum,
        bank: bank || "No bank account on file",
        payouts: of_npo.map(({ id, label, date, amount }) => ({
          id,
          label,
          date,
          amount,
        })),
      };
    })
  );
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
