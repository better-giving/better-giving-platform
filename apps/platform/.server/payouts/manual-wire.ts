import { snap, to_units } from "@/helpers/decimal";
import { min_payout_amount } from "@/npo/schema";
import { WIRE_PROVIDERS } from "@/payouts";
import { is_unique_violation } from "../pg/errors";
import {
  manual_wire_by_tx,
  manual_wire_put,
  npo_pending_payout_ids,
  npo_wire_terms,
} from "../pg/queries/manual-wire";
import { MANUAL_WIRES_PROVIDER_TX_UNIQ } from "../pg/schema/payout";
import { settle_npo_payouts } from "./settle";
import { wire_settlement_id } from "./transfer";

export interface IMarkWired {
  npo_id: number;
  /** `YYYY-MM-DD`, the day the provider sent it */
  wire_date: string;
  /** what reached the npo's bank, usd */
  amount_sent: number;
  provider: string;
  provider_tx_id: string;
  /** the provider's fee, usd, paid by the npo out of the net */
  wire_fee: number;
}

export type MarkWiredResult =
  | { status: "ok"; settlement_id: string; net: number }
  /** a field the route should have refused: nothing written */
  | { status: "invalid"; field: keyof IMarkWired }
  /** this provider's reference is already recorded: nothing written */
  | { status: "duplicate" }
  | { status: "not_manual_wire" }
  | { status: "none_pending" }
  | { status: "under_minimum"; net: number; minimum: number }
  /** `amount_sent` must be the net less the fee: `expected` */
  | { status: "amount_mismatch"; net: number; expected: number }
  /** a returned wise transfer holds the npo's payouts */
  | { status: "held" };

/**
 * records a wire sent by hand to an npo paid by `manual_wire`, settling
 * all its pending payouts in one transaction with the wire and its settlement.
 * `providers` is `WIRE_PROVIDERS` outside tests
 */
export async function mark_wired(
  input: IMarkWired,
  providers: readonly string[] = WIRE_PROVIDERS
): Promise<MarkWiredResult> {
  const provider_tx_id = input.provider_tx_id.trim();
  const invalid = invalid_field({ ...input, provider_tx_id }, providers);
  if (invalid) return { status: "invalid", field: invalid };
  const { npo_id, provider, wire_date, amount_sent, wire_fee } = input;

  if (await manual_wire_by_tx(provider, provider_tx_id)) {
    return { status: "duplicate" };
  }
  const npo = await npo_wire_terms(npo_id);
  if (npo?.payout_method !== "manual_wire")
    return { status: "not_manual_wire" };

  const settlement_id = wire_settlement_id(provider, provider_tx_id);
  const sent_cents = to_units(amount_sent, 2);
  const fee_cents = to_units(wire_fee, 2);
  try {
    const res = await settle_npo_payouts(
      {
        id: npo.id,
        name: npo.name,
        payout_minimum: npo.payout_minimum ?? min_payout_amount,
      },
      await npo_pending_payout_ids(npo.id),
      {
        settlement_id,
        reference: provider_tx_id,
        date: `${wire_date}T00:00:00.000Z`,
        matches: (net) => to_units(net, 2) - fee_cents === sent_cents,
        record: (tx, settlement_id) =>
          manual_wire_put(tx, {
            npo_id: npo.id,
            provider,
            provider_tx_id,
            wire_date,
            amount_sent,
            wire_fee,
            settlement_id,
          }),
      }
    );
    switch (res.status) {
      case "wired":
        return { status: "ok", settlement_id, net: res.total };
      case "amount_mismatch":
        return {
          status: "amount_mismatch",
          net: res.net,
          expected: (to_units(res.net, 2) - fee_cents) / 100,
        };
      case "under_minimum":
        return {
          status: "under_minimum",
          net: res.total,
          minimum: res.minimum,
        };
      case "none_pending":
      case "held":
        return { status: res.status };
      default:
        throw new Error(`mark_wired: unexpected settle result ${res.status}`);
    }
  } catch (err) {
    // a concurrent mark of the same wire committed first
    if (
      is_unique_violation(err, MANUAL_WIRES_PROVIDER_TX_UNIQ) ||
      is_unique_violation(err, "settlements_pkey")
    ) {
      return { status: "duplicate" };
    }
    throw err;
  }
}

const in_cents = (n: number) =>
  Number.isFinite(n) && Number.isInteger(snap(n * 100));

/** a real calendar day: `2026-02-31` rolls over to March, so it fails */
function is_day(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

function invalid_field(
  i: IMarkWired,
  providers: readonly string[]
): keyof IMarkWired | null {
  if (!providers.includes(i.provider)) return "provider";
  if (i.provider_tx_id === "") return "provider_tx_id";
  if (!is_day(i.wire_date)) return "wire_date";
  if (!in_cents(i.wire_fee) || i.wire_fee < 0) return "wire_fee";
  if (!in_cents(i.amount_sent) || i.amount_sent <= 0) return "amount_sent";
  return null;
}
