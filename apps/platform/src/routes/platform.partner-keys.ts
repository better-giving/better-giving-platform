import { eq } from "drizzle-orm";
import * as v from "valibot";
import { user_ctx } from "#/.server/auth";
import { resp } from "@/helpers/https";
import { mint_key, revoke_key, rotate_key } from "$/partner/keys";
import { db } from "$/pg/db";
import { npos } from "$/pg/schema/npo";
import type { Route } from "./+types/platform.partner-keys";

// staff-only by the platform layout's `auth_mdlwr, admin_mdlwr`, which
// react-router runs for this resource route as for any child of it

const NO_STORE = { "cache-control": "no-store" };

const npo_id = v.pipe(v.number(), v.integer(), v.minValue(1));

const Body = v.variant("op", [
  v.object({ op: v.literal("mint"), npo_id }),
  v.object({ op: v.literal("rotate"), npo_id }),
  v.object({ op: v.literal("revoke"), npo_id, key_id: v.string() }),
]);

const refuse = (status: number, message: string) =>
  resp.json({ error: message }, status, NO_STORE);

export const loader = () =>
  new Response(null, { status: 405, headers: { allow: "POST", ...NO_STORE } });

export const action = async ({ request, context }: Route.ActionArgs) => {
  if (request.method !== "POST") return loader();
  const staff = context.get(user_ctx);

  const raw = await request.json().catch(() => undefined);
  const parsed = v.safeParse(Body, raw);
  if (!parsed.success) return refuse(400, v.summarize(parsed.issues));
  const body = parsed.output;

  const [npo] = await db
    .select({ id: npos.id })
    .from(npos)
    .where(eq(npos.id, body.npo_id));
  if (!npo) return refuse(404, `nonprofit ${body.npo_id} not found`);

  switch (body.op) {
    case "mint": {
      const { event_secret, ...minted } = await mint_key(db, {
        npo_id: npo.id,
        minted_by: staff.id,
      });
      return resp.json(
        event_secret ? { ...minted, event_secret } : minted,
        200,
        NO_STORE
      );
    }
    case "rotate": {
      const rotated = await rotate_key(db, {
        npo_id: npo.id,
        rotated_by: staff.id,
      });
      if (!rotated) {
        return refuse(409, "this nonprofit has no key to rotate; mint one");
      }
      const { revoked: _, ...minted } = rotated;
      return resp.json(minted, 200, NO_STORE);
    }
    case "revoke": {
      const revoked = await revoke_key(db, {
        id: body.key_id,
        npo_id: npo.id,
        revoked_by: staff.id,
      });
      if (!revoked) {
        return refuse(404, "no live key with that id for this nonprofit");
      }
      return resp.json({ id: body.key_id, revoked: true }, 200, NO_STORE);
    }
  }
};
