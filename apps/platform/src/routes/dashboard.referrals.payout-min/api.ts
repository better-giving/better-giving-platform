import { type ActionFunction, redirect } from "react-router";
import * as v from "valibot";
import { user_ctx } from "#/.server/auth";
import { config } from "#/pages/user-dashboard/referrals/config";
import { resp } from "@/helpers/https";
import { user_get, user_update } from "$/pg/queries/user";
import type { Route } from "./+types/route";

export const loader = async ({ context }: Route.LoaderArgs) => {
  const user = context.get(user_ctx);
  const db_user = await user_get(user.email);
  return { pay_min: db_user?.pay_min?.toString() };
};

/** the request body is the bare amount as `text/plain`, and `+body` maps a
 * non-numeric one to `NaN` rather than failing — so it is parsed, not coerced.
 * the floor comes off the same constant `route.tsx` enforces in the browser:
 * `pay_min` is the threshold a referrer's balance must reach, and the payout
 * flow is not written for one below it. */
const pay_min = v.pipe(
  v.string(),
  v.trim(),
  v.transform(Number),
  v.number(),
  v.finite("pay_min must be a number"),
  // the `pay_min` column is an integer: postgres refuses "100.5" outright
  v.integer("pay_min must be whole dollars"),
  v.minValue(config.pay_min, `pay_min floor is $${config.pay_min}`)
);

export const action: ActionFunction = async ({ request, context }) => {
  const user = context.get(user_ctx);

  const p = v.safeParse(pay_min, await request.text());
  if (p.issues) throw resp.status(400, p.issues[0].message);
  await user_update(user.email, { pay_min: p.output });

  return redirect("..", {
    headers: {
      "x-remix-revalidate": "1",
      "cache-control": "no-cache",
    },
  });
};
