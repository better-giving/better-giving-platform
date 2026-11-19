import { data } from "react-router";
import { safeParse } from "valibot";
import { report_error } from "#/errors/report";
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
  // the step dots are drawn client-side, which cannot read the switch
  const connect_routing = stripe_env.connect_routing;
  try {
    return data({ ...(await regs(p.output)), connect_routing });
  } catch (err) {
    // page 1 failing is the page's failure. a later page failing is not the
    // reviewer's: it comes back as an empty page with no cursor, so the loaded
    // rows stay and the table has nothing more to offer
    if (!p.output.next) throw err;
    report_error(err, { where: "applications list next page" });
    return data({
      items: [],
      next: undefined,
      connect_routing,
      error: true as const,
    });
  }
};
