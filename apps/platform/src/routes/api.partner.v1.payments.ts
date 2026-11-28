import { getDotPath, safeParse } from "valibot";
import { open_key, partner_route } from "$/partner/gate";
import { payment_request } from "$/partner/payment-schema";
import { create_payment } from "$/partner/payments";
import { problem } from "$/partner/problem";
import { db } from "$/pg/db";
import type { Route } from "./+types/api.partner.v1.payments";

export const loader = partner_route(async () => problem("not_found"));

export const action = partner_route(async ({ request }: Route.ActionArgs) => {
  if (request.method !== "POST") return problem("not_found");
  const live = await open_key(db, request, "list_write");
  if (live instanceof Response) return live;

  const body = await request.json().catch(() => undefined);
  if (body === undefined) {
    return problem("invalid_request", { detail: "The body is not JSON." });
  }
  const parsed = safeParse(payment_request, body);
  if (parsed.issues) {
    return problem("invalid_request", {
      errors: parsed.issues.map((i) => ({
        path: getDotPath(i) ?? "",
        message: i.message,
      })),
    });
  }

  return create_payment(db, live.npo_id, parsed.output);
});
