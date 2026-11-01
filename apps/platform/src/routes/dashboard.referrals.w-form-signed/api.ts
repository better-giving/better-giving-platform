import { user_ctx } from "#/.server/auth";
import { weld_data_fn } from "#/.server/registration/weld-data";
import { resp } from "@/helpers/https";
import { user_update, user_w_form_weld_eid } from "$/pg/queries/user";
import type { Route } from "./+types/route";

export interface LoaderData {
  doc_eid: string;
}

export const loader = async ({ context, url }: Route.LoaderArgs) => {
  const user = context.get(user_ctx);
  const q = url.searchParams;
  const weld_data_eid = q.get("weldDataEid");
  if (!weld_data_eid) throw new Response(null, { status: 400 });

  // anvil hands the eid back through the query string of a form nothing
  // authenticated, so the eid is a claim, not proof. the only trustworthy link
  // between a submission and a person is the one the server wrote before
  // sending them to the form. a null/absent record means nothing was minted
  // for this session and there is nothing to match — refuse.
  const minted = await user_w_form_weld_eid(user.email);
  // checked before anvil is asked anything: a stranger's eid must not even
  // reach the api, let alone reach `w_form` and unlock the download guard.
  if (!minted || minted !== weld_data_eid) throw resp.status(403);

  const { documentGroup } = await weld_data_fn(weld_data_eid);
  // the eid is minted before the signer opens the form, so a match here does
  // not mean they finished it. no document group means no document to file
  // under `w_form` and none to download.
  if (!documentGroup?.eid) throw resp.status(409, "tax form not submitted");

  await user_update(user.email, { w_form: documentGroup.eid });

  return { doc_eid: documentGroup.eid } satisfies LoaderData;
};
