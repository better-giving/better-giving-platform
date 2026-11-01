import { and, eq } from "drizzle-orm";
import { href } from "react-router";
import * as v from "valibot";
import { get_session, to_auth } from "#/.server/auth";
import { dataWithSuccess } from "#/.server/toast";
import { to_freqs } from "@/helpers/donation";
import { resp } from "@/helpers/https";
import { db } from "$/pg/db";
import { type FormRow, form_get, form_update } from "$/pg/queries/form";
import { fund_get } from "$/pg/queries/fund";
import { npo_get } from "$/pg/queries/npo";
import { user_npo_memberships } from "$/pg/schema/user";
import type { Route } from "./+types/route";
import { schema } from "./types";

export interface IRecipient {
  name: string;
  members: string[];
  program?: { id: string; title: string };
  hide_bg_tip?: boolean;
}

export interface ILoader extends FormRow {
  back_url: string;
  base_url: string;
  recipient_details: IRecipient;
}

const recipient_fn = async (
  npo_id: number | null,
  fund_id: string | null
): Promise<IRecipient | undefined> => {
  if (fund_id) {
    const x = await fund_get(fund_id);
    if (!x) return;
    return {
      name: x.name,
      members: x.members.map((x) => x.toString()),
    };
  }

  if (npo_id) {
    const x = await npo_get(npo_id);
    if (!x) return;
    return { name: x.name, members: [], hide_bg_tip: x.hide_bg_tip };
  }
};

export const loader = async ({ request, params, url }: Route.LoaderArgs) => {
  const { user } = await get_session(request);
  if (!user) return to_auth(url);

  const form = await form_get(params.id);
  if (!form) throw resp.err(404, "form not found");

  const is_email_owner = form.owner_user_id === user.id;
  const is_npo_owner =
    user.role === "admin" ||
    (form.owner_npo_id
      ? await db
          .select({ npo_id: user_npo_memberships.npo_id })
          .from(user_npo_memberships)
          .where(
            and(
              eq(user_npo_memberships.user_id, user.id),
              eq(user_npo_memberships.npo_id, form.owner_npo_id)
            )
          )
          .limit(1)
          .then((r) => !!r[0])
      : false);
  if (!is_email_owner && !is_npo_owner) {
    throw resp.err(403, "forbidden");
  }

  const recipient_details = await recipient_fn(
    form.recipient_npo_id,
    form.recipient_fund_id
  );
  if (!recipient_details) throw resp.err(404, "recipient not found");

  const { origin: base_url } = url;
  const back_path = form.owner_user_id
    ? href("/dashboard/forms")
    : href("/admin/:id/forms", { id: String(form.owner_npo_id) });
  const back_url = `${base_url}${back_path}`;

  return { ...form, back_url, base_url, recipient_details } satisfies ILoader;
};

export const action = async ({ request, params, url }: Route.ActionArgs) => {
  const json = await request.json();
  const p = v.safeParse(schema, json);
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const fv = p.output;

  const { user } = await get_session(request);
  if (!user) return to_auth(url);

  const form = await form_get(params.id);
  if (!form) throw resp.err(404, "form not found");

  const is_email_owner = form.owner_user_id === user.id;
  const is_npo_owner =
    user.role === "admin" ||
    (form.owner_npo_id
      ? await db
          .select({ npo_id: user_npo_memberships.npo_id })
          .from(user_npo_memberships)
          .where(
            and(
              eq(user_npo_memberships.user_id, user.id),
              eq(user_npo_memberships.npo_id, form.owner_npo_id)
            )
          )
          .limit(1)
          .then((r) => !!r[0])
      : false);
  if (!is_email_owner && !is_npo_owner) {
    throw resp.err(403, "forbidden");
  }

  if (fv.type === "adv") {
    await form_update(params.id, {
      success_redirect: fv.success_redirect,
    });
    return dataWithSuccess(null, "Form updated");
  }

  const { target_smart, target_number } = ((x) => {
    switch (x.type) {
      case "smart":
        return { target_smart: true as const, target_number: null };
      case "fixed":
        return { target_smart: null, target_number: +x.value };
      case "none":
        return { target_smart: null, target_number: null };
    }
  })(fv.target);

  await form_update(params.id, {
    accent_primary: fv.accent_primary,
    accent_secondary: fv.accent_secondary,
    donate_methods: fv.methods.filter((m) => !m.disabled).map((m) => m.id),
    increments: fv.increments,
    target_smart,
    target_number,
    tag: fv.tag,
    freq_opts: to_freqs(fv.frequencies),
  });

  return dataWithSuccess(null, "Form updated");
};
