import { data } from "react-router";
import { safeParse } from "valibot";
import { search } from "@/helpers/https";
import { regs_search } from "@/reg/schema";
import { regs } from "$/pg/queries/registration";
import type { Route } from "./+types/route";

export const loader = async ({ url }: Route.LoaderArgs) => {
  const p = safeParse(regs_search, search(url));

  if (p.issues) {
    throw new Response(p.issues[0].message, { status: 400 });
  }
  const page = await regs(p.output);

  return data(page);
};
