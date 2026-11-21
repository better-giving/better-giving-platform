import { snap, to_units } from "@/helpers/decimal";
import { min_payout_amount } from "@/npo/schema";
import { WIRE_PROVIDERS } from "@/payouts";
import { is_unique_violation } from "../pg/errors";
import {
  manual_wire_by_tx,
  manual_wire_put,
  npo_wire_terms,
} from "../pg/queries/manual-wire";
import { MANUAL_WIRES_PROVIDER_TX_UNIQ } from "../pg/schema/payout";
import { settle_npo_payouts } from "./settle";
import { wire_settlement_id } from "./transfer";

export interface IMarkWired {
  npo_id: number;
  /** the payouts the wire covers, as the page showed them; one pending since
   * stays for the next wire */
  payout_ids: string[];
  /** `YYYY-MM-DD`, the day the provider sent it */
  wire_date: string;
  /** what reached the npo's bank, usd: the net less `wire_fee` */
  amount_sent: number;
  provider: string;
  provider_tx_id: string;
  /** the provider's fee, usd, paid by the npo out of the net */
  wire_fee: number;
  /** the signed-in admin's user id */
  recorded_by: string;
}

export type MarkWiredResult =
  | { status: "ok"; settlement_id: string; net: number }
  /** a field refused, `amount_sent` included when it is not the net less the
   * fee: nothing written */
  | { status: "invalid"; field: keyof IMarkWired }
  /** this provider's reference is already recorded: nothing written */
  | { status: "duplicate" }
  | { status: "not_manual_wire" }
  | { status: "none_pending" }
  | { status: "under_minimum"; net: number; minimum: number }
  /** `payout_ids` is empty, repeats an id, or names one that is no longer the
   * npo's pending payout: nothing written */
  | { status: "payouts_changed" };

/**
 * records a wire sent by hand to an npo paid by `manual_wire`, settling
 * exactly `payout_ids` in one transaction with the wire and its settlement:
 * the net, the minimum and the debit are all of that set. tests pass a second
 * provider through `providers`
 */
export async function mark_wired(
  input: IMarkWired,
  providers: readonly string[] = WIRE_PROVIDERS
): Promise<MarkWiredResult> {
  const provider_tx_id = input.provider_tx_id.trim();
  const invalid = invalid_field({ ...input, provider_tx_id }, providers);
  if (invalid) return { status: "invalid", field: invalid };
  const { npo_id, payout_ids, provider, wire_date, amount_sent, wire_fee } =
    input;

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
        payout_method: npo.payout_method,
      },
      payout_ids,
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
            recorded_by: input.recorded_by,
          }),
      }
    );
    switch (res.status) {
      case "wired":
        return { status: "ok", settlement_id, net: res.total };
      // the expected figure stays on the server
      case "amount_mismatch":
        return { status: "invalid", field: "amount_sent" };
      case "under_minimum":
        return {
          status: "under_minimum",
          net: res.total,
          minimum: res.minimum,
        };
      case "none_pending":
      case "payouts_changed":
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

/** a finite usd figure in whole cents: `99.995` is past the cent */
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
  if (i.recorded_by === "") return "recorded_by";
  return null;
}
