import type { ITo } from "@/donations";
import { fund_is_open } from "@/campaign/is-open";
import { fund_get } from "$/pg/queries/fund";
import { npo_get } from "$/pg/queries/npo";

/**
 * @param id - endow id or fund uuid
 * @param opts.open_at - also refuse a fund that is closed (inactive or expired) at this instant
 */
export async function to_fn(
  id: string | number,
  opts: { open_at?: Date } = {}
): Promise<ITo | undefined> {
  //recipient is endowment
  if (typeof id === "number") {
    const npo = await npo_get(id);
    if (!npo) return undefined;
    if (npo.active === false) return undefined;
    const recipient: ITo = {
      to_id: id.toString(),
      to_type: "npo",
      to_name: npo.name,
      to_tip_allowed: !(npo.hide_bg_tip ?? false),
      to_members: [],
    };

    return recipient;
  }

  return fund_get(id).then((data) => {
    if (!data) return undefined;
    if (opts.open_at && !fund_is_open(data, opts.open_at)) return undefined;
    const recipient: ITo = {
      to_id: data.id,
      to_type: "fund",
      to_name: data.name,
      to_tip_allowed: !data.hide_bg_tip,
      to_members: data.members.map((n) => n.toString()),
    };
    return recipient;
  });
}
