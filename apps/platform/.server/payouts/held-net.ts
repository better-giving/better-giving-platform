import type { IHeldMoney } from "@/payouts";
import { held_money } from "../pg/queries/held-money";
import type { DbOrTx } from "../pg/queries/helpers";
import { outstanding_for_npo } from "../pg/queries/owed";
import { net_owed } from "./net-owed";
import { owed_netting_on } from "./owed-run";

/**
 * `held_money` with `net`: what the grant run would pay of it, the amounts
 * the npo owes taken off as `settle` takes them. the payout minimum is left
 * out, since the card promises the money, not the day. an npo owing all of it
 * nets to 0
 */
export async function held_money_net(
  pg: DbOrTx,
  npo_id: number
): Promise<IHeldMoney> {
  const held = await held_money(pg, npo_id);
  if (held.total <= 0 || !(await owed_netting_on())) return held;
  const owed = await outstanding_for_npo(pg, npo_id);
  const plan = net_owed(held.total, owed, 0);
  return { ...held, net: plan.status === "recover_only" ? 0 : plan.net };
}
