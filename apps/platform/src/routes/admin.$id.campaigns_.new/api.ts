import { data, href } from "react-router";
import { admin_ctx, user_ctx } from "#/.server/auth";
import { redirectWithSuccess } from "#/.server/toast";
import {
  ORG_SLUG_PROMPT,
  read_body,
  refusal,
  slug_taken,
  slug_taken_message,
  to_fields,
} from "#/routes/admin.$id.campaigns/persist";
import { resp } from "@/helpers/https";
import {
  campaign_create,
  campaign_publish,
  campaign_slug_taken,
} from "$/pg/queries/campaign";
import { npo_get } from "$/pg/queries/npo";
import { npo_programs } from "$/pg/queries/program";
import type { Route } from "./+types/route";

export const loader = async ({ context, url }: Route.LoaderArgs) => {
  const id = context.get(admin_ctx);
  const endow = await npo_get(id);
  if (!endow) throw resp.status(404);
  const programs = await npo_programs(id);
  return {
    endow,
    programs: programs.map((p) => ({ id: p.id, title: p.title })),
    profile_to: href("/admin/:id/organization", { id: String(id) }),
    origin: url.origin,
  };
};

export const action = async ({ request, context }: Route.ActionArgs) => {
  const id = context.get(admin_ctx);
  const user = context.get(user_ctx);
  const endow = await npo_get(id);
  if (!endow) throw resp.status(404);
  if (!endow.slug) return data(refusal(ORG_SLUG_PROMPT), { status: 400 });

  const read = await read_body(request);
  if ("error" in read)
    return data(refusal(read.error, read.field), { status: 400 });
  if (!("body" in read) || !read.body) {
    return data(refusal("Save the campaign before ending it."), {
      status: 400,
    });
  }
  const body = read.body;
  const fields = await to_fields(id, body, endow.hide_bg_tip);
  if ("error" in fields) {
    return data(refusal(fields.error, fields.field), { status: 400 });
  }
  if (await campaign_slug_taken(id, fields.slug)) {
    return data(refusal(slug_taken_message(), "slug"), { status: 400 });
  }

  const campaign_id = crypto.randomUUID();
  try {
    await campaign_create({
      ...fields,
      id: campaign_id,
      owner_npo_id: id,
      creator_id: user.id,
    });
  } catch (err) {
    if (slug_taken(err)) {
      return data(refusal(slug_taken_message(), "slug"), { status: 400 });
    }
    throw err;
  }

  if (body.op === "publish") {
    const live = await campaign_publish(id, campaign_id);
    if (!live) throw resp.status(404);
  }

  const to = href("/admin/:id/campaigns/:campaign_id", {
    id: String(id),
    campaign_id,
  });
  return redirectWithSuccess(
    to,
    body.op === "publish" ? "Campaign is live" : "Campaign saved"
  );
};
