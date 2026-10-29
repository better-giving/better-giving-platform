import type { IFund } from "#/types/fund";
import { fund_get_or_slug } from "$/pg/queries/fund";
import { npos_batch_get } from "$/pg/queries/npo";

/** @param id - slug or uuid */
export const get_fund = async (id: string): Promise<IFund | undefined> => {
  const fund = await fund_get_or_slug(id);
  if (!fund) return;

  if (fund.members.length === 0) {
    return { ...fund, members: [] };
  }

  const npos = await npos_batch_get(fund.members);

  return {
    ...fund,
    members: npos.map((m) => ({
      id: m.id,
      // fund pages are publicly cached; an unpublished org's slug stays out
      slug: (m.published && m.slug) || undefined,
      name: m.name,
      logo: m.logo || m.card_img || undefined,
      banner: m.image ?? undefined,
    })),
  };
};
