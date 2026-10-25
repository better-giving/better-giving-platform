import { safeParse } from "valibot";
import { fund_id } from "@/campaign/schema";
import { resp, search } from "@/helpers/https";
import { fund_delete, funds_list } from "$/pg/queries/fund";
import type { Route } from "./+types/route";

export const loader = async ({ request }: Route.LoaderArgs) => {
  const { next } = search(request.url);
  const page = await funds_list({
    next,
  });
  return page;
};

export const action = async ({ request }: Route.ActionArgs) => {
  const fd = await request.formData();
  const p = safeParse(fund_id, fd.get("fund_id"));
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const id = p.output;

  await fund_delete(id);
  return resp.json({ success: true });
};
