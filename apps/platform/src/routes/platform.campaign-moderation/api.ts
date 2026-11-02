import { safeParse } from "valibot";
import { fund_id } from "@/campaign/schema";
import { resp, search } from "@/helpers/https";
import { fund_delete, funds_list } from "$/pg/queries/fund";
import { user_names_by_ids } from "$/pg/queries/user";
import type { Route } from "./+types/route";

export const loader = async ({ url }: Route.LoaderArgs) => {
  const { next } = search(url);
  const page = await funds_list({
    next,
  });
  const names = await user_names_by_ids([
    ...new Set(page.items.map((x) => x.creator_id)),
  ]);
  return {
    ...page,
    items: page.items.map((x) => ({
      ...x,
      creator_name: names.get(x.creator_id) ?? null,
    })),
  };
};

export const action = async ({ request }: Route.ActionArgs) => {
  const fd = await request.formData();
  const p = safeParse(fund_id, fd.get("fund_id"));
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const id = p.output;

  await fund_delete(id);
  return resp.json({ success: true });
};
