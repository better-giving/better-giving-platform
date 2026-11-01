import type { ActionFunction, LoaderFunction } from "react-router";
import { get_session } from "#/.server/auth";
import { sign_recipient } from "#/.server/wise-grant";
import { report_error } from "#/errors/report";
import { resp } from "@/helpers/https";
import { wise } from "$/env";

/** what the bank-details form is allowed to ask Wise, and nothing else.
 *
 * This route forwards to Wise under *our* api token, so the caller's reach is
 * whatever this list says it is — an unlisted path would let a signed-in user
 * drive our whole Wise account (balances, transfers, profile) through it.
 * Matched against the path after `{{profileId}}` is substituted. */
const ALLOWED: ReadonlyArray<{ method: string; path: RegExp }> = [
  // the currency picker
  { method: "GET", path: /^v1\/currencies$/ },
  // a quote, then the account fields that quote's corridor requires
  { method: "POST", path: /^v3\/profiles\/\d+\/quotes$/ },
  { method: "GET", path: /^v1\/quotes\/[\w-]+\/account-requirements$/ },
  { method: "POST", path: /^v1\/quotes\/[\w-]+\/account-requirements$/ },
  // the recipient the form exists to create
  { method: "POST", path: /^v1\/accounts$/ },
  // per-field async checks wise itself names in `validationAsync.url`
  { method: "GET", path: /^v1\/validators\/[\w-]+$/ },
];

export const loader: LoaderFunction = ({ request, params, url }) => {
  return handle_request(request, url, params);
};

export const action: ActionFunction = ({ request, params, url }) => {
  return handle_request(request, url, params);
};

async function handle_request(
  request: Request,
  url: URL,
  params: { "*"?: string }
): Promise<ReturnType<typeof loader | typeof action>> {
  const METHOD = request.method;

  if (METHOD === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // this route has no parent layout, so nothing else guards it. every screen
  // that mounts `BankDetails` is session-only — registration step 4 passes
  // `allow_grant: false`, the other two sit behind `auth_mdlwr`.
  const { user } = await get_session(request);
  if (!user) return resp.fail(401, "Sign in to continue");

  const path = params["*"]?.replace(/{{profileId}}/g, wise.profile_id) ?? "";
  if (!ALLOWED.some((a) => a.method === METHOD && a.path.test(path))) {
    return resp.fail(403, "Not allowed");
  }

  try {
    const body = await request.text();
    const payload = body?.replace(/"{{profileId}}"/g, wise.profile_id);

    const h = copy_headers(request.headers, [
      "accept-minor-version",
      "content-type",
    ]);
    h.set("authorization", `Bearer ${wise.api_token}`);

    const res = await fetch(`${wise.api_url}/${path}${url.search || ""}`, {
      method: METHOD,
      body: payload || undefined,
      headers: h,
    });

    const json = await res.json();

    // a created recipient carries proof of who created it — see `wise-grant`.
    // additive, so a browser running older js just ignores the extra key.
    if (res.ok && path === "v1/accounts" && typeof json?.id === "number") {
      return resp.json(
        { ...json, bg_grant: await sign_recipient(user.id, json.id) },
        res.status
      );
    }
    return resp.json(json, res.status);
  } catch (err: any) {
    report_error(err, { path: params["*"] });
    return resp.status(500);
  }
}

export const copy_headers = (source: Headers, names: string[]) => {
  const h = new Headers();
  for (const n of names) {
    const v = source.get(n);
    if (v) h.set(n, v);
  }
  return h;
};
