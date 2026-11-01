import type { ActionFunction } from "react-router";
import { safeParse } from "valibot";
import { get_session, to_auth } from "#/.server/auth";
import { npo_interest_shares } from "#/.server/npos-interest-share";
import { resp } from "@/helpers/https";
import { interest_log } from "@/liquid/schemas";

export const action: ActionFunction = async ({ request, url }) => {
  const { user } = await get_session(request);
  if (!user) return to_auth(url);
  if (user.role !== "admin") return resp.status(403);

  const body = await request.json().catch(() => undefined);
  if (body === undefined) return resp.status(400, "body is not json");
  const p = safeParse(interest_log, body);
  if (p.issues) return resp.status(400, p.issues[0].message);
  const fv = p.output;

  const shares = await npo_interest_shares({
    start: fv.date_start,
    end: fv.date_end,
  });

  return resp.json(shares);
};
