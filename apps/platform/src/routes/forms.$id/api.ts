import { resp } from "@/helpers/https";
import { type FormRow, form_get } from "$/pg/queries/form";
import { npo_get } from "$/pg/queries/npo";
import type { Route } from "./+types/route";

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export interface IRecipient {
  name: string;
  hide_bg_tip?: boolean;
  donor_address_required?: boolean;
}

// the anonymous, cdn-cached payload: only what the donation widget renders
type FormPublic = Pick<
  FormRow,
  | "id"
  | "name"
  | "status"
  | "accent_primary"
  | "accent_secondary"
  | "donate_methods"
  | "increments"
  | "freq_opts"
  | "defaults"
  | "success_redirect"
  | "recipient_npo_id"
  | "recipient_fund_id"
  | "program_id"
  | "program_name"
>;

export interface ILoader extends FormPublic {
  recipient_details: IRecipient;
  base_url: string;
}

export const loader = async ({ params, url }: Route.LoaderArgs) => {
  const form = await form_get(params.id);
  if (!form) throw resp.err(404, "form not found");

  const x = await npo_get(form.recipient_npo_id ?? 0);
  if (!x) throw resp.err(404, "recipient not found");

  return {
    id: form.id,
    name: form.name,
    status: form.status,
    accent_primary: form.accent_primary,
    accent_secondary: form.accent_secondary,
    donate_methods: form.donate_methods,
    increments: form.increments,
    freq_opts: form.freq_opts,
    defaults: form.defaults,
    success_redirect: form.success_redirect,
    recipient_npo_id: form.recipient_npo_id,
    recipient_fund_id: form.recipient_fund_id,
    program_id: form.program_id,
    program_name: form.program_name,
    recipient_details: {
      name: x.name,
      hide_bg_tip: x.hide_bg_tip,
      donor_address_required: x.donor_address_required,
    },
    base_url: url.origin,
  } satisfies ILoader;
};
