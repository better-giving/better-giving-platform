import { data } from "react-router";
import { safeParse } from "valibot";
import { search } from "@/helpers/https";
import { regs_search } from "@/reg/schema";
import { stripe as stripe_env } from "$/env";
import { regs } from "$/pg/queries/registration";
import type { Route } from "./+types/route";

export const loader = async ({ url }: Route.LoaderArgs) => {
  const p = safeParse(regs_search, search(url));

  if (p.issues) {
    throw new Response(p.issues[0].message, { status: 400 });
  }
  const page = await regs(p.output);

  // the step dots are drawn client-side, which cannot read the switch
  return data({ ...page, connect_routing: stripe_env.connect_routing });
};
