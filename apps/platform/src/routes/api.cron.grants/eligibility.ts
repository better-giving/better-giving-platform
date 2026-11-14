import { min_payout_amount } from "@/npo/schema";
import { type IReturnHold, npo_return_hold } from "$/payouts/resend-returned";
import { payout_total } from "$/payouts/transfer";
import { npo_default_bapp } from "$/pg/queries/banking";
import { npo_get } from "$/pg/queries/npo";

type Npo = NonNullable<Awaited<ReturnType<typeof npo_get>>>;

export type GrantEligibility =
  | { status: "not_found"; total: number }
  | {
      status: "skipped";
      npo: Npo;
      minimum: number;
      total: number;
      reason: string;
    }
  /** a transfer came back and no new account pays yet: sending more would
   * bounce it too */
  | {
      status: "held";
      npo: Npo;
      minimum: number;
      total: number;
      hold: IReturnHold;
    }
  | {
      status: "pass";
      npo: Npo;
      minimum: number;
      total: number;
      wise_id: string;
    }
  /** what the npo owes decides the minimum and whether a recipient is needed */
  | {
      status: "nets";
      npo: Npo;
      minimum: number;
      total: number;
      wise_id: string | null;
    };

/**
 * whether the grants run pays this npo its pending `amounts`, judged on their
 * `total`: the cents the run sends. the schedule notice asks the same. a run
 * that `nets_owed` leaves the minimum and the recipient to the netting, since
 * an npo owing at least its total is settled with no transfer
 */
export async function grant_eligibility(
  npo_id: number,
  amounts: number[],
  nets_owed: boolean
): Promise<GrantEligibility> {
  const total = payout_total(amounts);
  const npo = await npo_get(npo_id);
  if (!npo) return { status: "not_found", total };
  const minimum = npo.payout_minimum ?? min_payout_amount;
  const skip = (reason: string) =>
    ({ status: "skipped", npo, minimum, total, reason }) as const;

  if (npo.active === false) return skip("inactive");
  const hold = await npo_return_hold(npo.id);
  if (hold) return { status: "held", npo, minimum, total, hold };
  const wise_id = await npo_default_bapp(npo.id).then((x) => x?.id);
  if (nets_owed) {
    const recipient = wise_id ? String(wise_id) : null;
    return { status: "nets", npo, minimum, total, wise_id: recipient };
  }
  if (!wise_id) return skip("no wise recipient");
  if (total < minimum) {
    return skip(`payout minimum not met, min: ${minimum}, total: ${total}`);
  }
  return { status: "pass", npo, minimum, total, wise_id: String(wise_id) };
}
