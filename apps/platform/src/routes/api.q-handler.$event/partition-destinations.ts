import type { IDonationSettled, IParent, TToType } from "@/donations";
import { is_funded_member } from "@/settlement/funded-members";
import { settled_parts, shared_parts } from "@/settlement/plan";
import type { IInput, IParts, ISource, ISttlmnt } from "@/types/donation-dist";
import { form_get } from "$/pg/queries/form";
import { nav_ltd } from "$/pg/queries/nav";
import { npo_get, npos_batch_get } from "$/pg/queries/npo";

export const partition_destinations = async (b: IDonationSettled) => {
  const {
    id: parent_id,
    created_at: parent_created_at,
    amount: parent_amount,
    settlement: parent_settlement,
    to_id: parent_to_id,
    to_type: parent_to_type,
    to_name: parent_to_name,
    to_members: parent_to_members,
    to_tip_allowed: parent_to_tip_allowed,

    form_id,
    program,
    ...tx
  } = b;

  const prnt: IParent & { type: TToType } = {
    id: parent_id,
    to_id: parent_to_id,
    to_name: parent_to_name,
    to_members: parent_to_members,
    type: parent_to_type,
  };

  const sttl: ISttlmnt = {
    id: parent_settlement.id,
    date: parent_settlement.date,
    currency: parent_settlement.currency,
  };
  /** `sttl*` parts in usd/usdc; `amnt` in the donation's currency */
  const ps: IParts = settled_parts(parent_amount, tx.upusd, parent_settlement);

  const source_p = form_id
    ? form_get(form_id).then(
        (f): ISource => ({ id: form_id, tag: f?.tag ?? undefined })
      )
    : undefined;
  const nav_price_p = nav_ltd().then((x) => x.price);

  const [source, nav_price] = await Promise.all([source_p, nav_price_p]);

  const destinations: IInput[] = [];

  if (prnt.type === "fund") {
    const members_data = await npos_batch_get(prnt.to_members.map((m) => +m));
    const active_members = members_data
      .filter(is_funded_member)
      .map((m) => m.id.toString());
    const n = active_members.length;
    if (n === 0) return { destinations };
    const member_ps = shared_parts(ps, n);
    for (const m of active_members) {
      const i: IInput = {
        id: +m,
        ps: member_ps,
        sttl,
        prnt,
        tx,
        source,
        // donation can't be attributed to npo's program for multi npo fund
        program: undefined,
        nav_price,
      };
      destinations.push(i);
    }
  } else if (parent_to_type === "npo") {
    // an inactive npo is not a destination, same as an inactive fund member
    // above. `settle_npo` skips it too, but only after the caller has counted
    // it — and a caller that counts a destination it never gets has no way to
    // tell "settled" from "recorded against nobody".
    //
    // a *missing* npo still comes through, so `settle_npo` throws on it as it
    // always has: absent and inactive are different problems.
    const npo = await npo_get(+parent_to_id);
    if (npo && npo.active === false) {
      console.warn(`npo:${parent_to_id} inactive, skipping settlement`);
    } else {
      const i: IInput = {
        id: +parent_to_id,
        ps,
        sttl,
        prnt,
        tx,
        source,
        program,
        nav_price,
      };
      destinations.push(i);
    }
  }

  return { destinations };
};
