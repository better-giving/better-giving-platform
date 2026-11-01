import { safeParse } from "valibot";
import { resp } from "@/helpers/https";
import { $int_gte1 } from "@/schemas";
import { npo_get } from "$/pg/queries/npo";
import type { Route } from "./+types/route";

export interface LoaderData {
  base_url: string;
  logo?: string;
}

export const loader = async ({ params, url }: Route.LoaderArgs) => {
  const p = safeParse($int_gte1, params.id);
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const id = p.output;
  const base_url = url.origin;
  const npo = await npo_get(id);
  if (!npo) throw resp.status(404);

  return {
    base_url,
    logo: npo.logo ?? undefined,
  } satisfies LoaderData;
};
