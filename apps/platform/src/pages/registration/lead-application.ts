import { valibotResolver } from "@hookform/resolvers/valibot";
import { data, redirect } from "react-router";
import { getValidatedFormData } from "remix-hook-form";
import * as v from "valibot";
import {
  check_email_url,
  client_ip,
  consume,
  create_unverified_user,
  get_session,
  issue_draft_grant,
  type Quota,
  request_login_link,
} from "#/.server/auth";
import { report_undefined } from "#/errors/report";
import type { IDuplicate } from "#/pages/registration/identity";
import { new_application_for } from "#/pages/registration/new-application";
import { evaluate_org } from "#/routes/_app.signup._index/evaluate";
import { resp } from "@/helpers/https";
import type { IRegStartFv } from "@/reg";
import type { ILeadErrors, ILeadInvalid, ILeadValues } from "@/reg/lead";
import { reg_start_fv } from "@/reg/schema";

export type { ILeadErrors, ILeadInvalid, ILeadValues };

const email_fv = v.pipe(
  v.string(),
  v.trim(),
  v.toLowerCase(),
  v.email("Enter a valid work email address.")
);

const o_name_fv = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, "Enter your organization's name.")
);

const identity_fields = [
  "o_ein",
  "o_hq_country",
  "o_registration_number",
] as const;

/** a failure is never a redirect — the form keeps what was typed, marks what
 * has to change, and answers 4xx so it is never mistaken for a landing. */
const invalid = (
  errors: ILeadErrors,
  values: ILeadValues,
  extra: Pick<ILeadInvalid, "signed_in_as" | "message"> = {}
) => data<ILeadInvalid>({ errors, values, ...extra }, { status: 400 });

const THROTTLED = "Too many submissions. Please try again in a few minutes.";

const str = (fd: FormData, k: string) => fd.get(k)?.toString() ?? "";

/** how many submissions one anonymous source may push past validation.
 *
 * A unit here is dearer than the account row gated in `create_unverified_user`
 * — an external spam call, a registrations row, and a `reg-created`
 * notification to a real inbox — so the ceiling sits under that one's 60, and
 * on this path it is the binding constraint of the two. Applications are
 * per-organization rather than per-person, so even a carrier-NAT pool produces
 * far fewer of them than signups do; a script crosses this in under a second. */
export const LEAD_PER_IP: Quota = { max: 40, window_s: 60 * 60 };

/** and how many one signed-in account may. an order of magnitude tighter than
 * the anonymous ceiling, and it can be: keyed by account, shared egress stops
 * mattering — ten colleagues in one building are ten keys — so this is sized on
 * what one applicant really does, which is start one application and
 * occasionally a second. */
export const LEAD_PER_USER: Quota = { max: 10, window_s: 60 * 60 };

/** The identity parser is remix-hook-form's, and it JSON-parses every value
 * it is handed — the wizard's own start screen posts through `createFormData`,
 * so its values arrive pre-stringified. These pages are plain `<Form>` posts,
 * where an all-digit EIN or registration number would parse to a *number* and
 * fault as "required". Re-encode so both entry points hand the parser the
 * same thing. */
const rhf_encoded = (fd: FormData): FormData => {
  const out = new FormData();
  for (const [k, val] of fd.entries()) {
    out.append(k, typeof val === "string" ? JSON.stringify(val) : val);
  }
  return out;
};

/** The marketing pages' one conversion point: a lead becomes the application
 * `new_application` would have written anyway plus an unverified account, and
 * lands on the wizard's contact step holding a draft grant.
 *
 * The address is not proven yet, so no session is *authority* here — the one
 * thing a session decides is whether this browser can act as the address at
 * all, which it must, or the wizard bounces them the moment they arrive. */
export async function lead_application(
  request: Request,
  url: URL,
  fd: FormData
) {
  // honeypot: offscreen and out of the tab order, so only a bot fills it.
  // a bare 400 rather than a field message — naming it teaches the bot.
  if (fd.get("middle_name")) {
    console.warn("Honeypot triggered - potential bot submission detected");
    throw resp.status(400);
  }

  const values: ILeadValues = {
    o_name: str(fd, "o_name"),
    o_ein: str(fd, "o_ein"),
    o_hq_country: str(fd, "o_hq_country"),
    o_registration_number: str(fd, "o_registration_number"),
    email: str(fd, "email"),
  };

  const errors: ILeadErrors = {};

  const name = v.safeParse(o_name_fv, values.o_name);
  if (name.issues) errors.o_name = name.issues[0].message;

  const mail = v.safeParse(email_fv, values.email);
  if (mail.issues) errors.email = mail.issues[0].message;

  // the identity is `reg_start_fv`'s — the same schema and the same messages
  // the wizard's own start screen faults on. parsed here, ahead of any write,
  // so a bad EIN or a missing country costs no row.
  const encoded = rhf_encoded(fd);
  const fv = await getValidatedFormData<IRegStartFv>(
    encoded,
    valibotResolver(reg_start_fv)
  );
  if (fv.errors) {
    const marked = fv.errors as Record<string, { message?: string }>;
    for (const k of identity_fields) {
      const m = marked[k]?.message;
      if (m) errors[k] = m;
    }
    /* `o_type` is a hidden input neither form lets anyone change, and nothing
     * else in the schema has a field to carry a message. a fault outside the
     * identity is a malformed post, not a correction anyone could make — it
     * gets the honeypot's answer and reaches no write. */
    const unnamed = Object.keys(marked).some(
      (k) => !identity_fields.some((f) => f === k)
    );
    if (unnamed) throw resp.status(400);
  }

  if (name.issues || mail.issues || Object.keys(errors).length) {
    return invalid(errors, values);
  }

  const email = mail.output;
  const o_name = name.output;

  const { user: signed_in } = await get_session(request);

  if (signed_in && signed_in.email !== email) {
    /* the row would be written under an address this browser cannot then act
     * as: every loader past here answers to the session, and it is somebody
     * else's. stop before anything exists to be stranded. */
    // no field is wrong, so no field is marked — the mismatch is reported as
    // itself and the form words the two ways out of it
    return invalid({}, values, { signed_in_as: signed_in.email });
  }

  /* Everything past here costs: an external spam call, a registrations row,
   * and a notification mail to a real inbox. This caps how much of that one
   * anonymous source can spend. Placed after validation on purpose — a typo
   * someone is fixing must not spend their quota, and a malformed post reaches
   * no write anyway.
   *
   * The two keys are not interchangeable and must not be collapsed into one.
   * An anonymous poster can only be keyed by source address, which is why that
   * ceiling has to be loose — carrier-grade NAT puts thousands of subscribers
   * behind one address. A signed-in one is keyed by account, which makes NAT
   * irrelevant and is what lets its ceiling be far tighter. Keying a session by
   * ip would reinstate exactly the false positive the loose anonymous ceiling
   * exists to avoid; exempting a session instead would leave one verified
   * account free to burn unbounded spam calls and notifications, which banning
   * only answers after somebody notices.
   *
   * Answers visibly, unlike every other throttle in this flow, and that is safe
   * *because the trigger is address-independent*. It fires on volume from one
   * poster and never on anything about the address being applied for, so it
   * cannot answer "does this address exist" and is no oracle — the property to
   * protect is that the response never varies with the address, not that it is
   * identical to success. It answers on the form, values kept and no field
   * marked, because the poster is usually a person who can simply wait; the
   * honeypot and the malformed post keep their bare 400, since naming those
   * would coach a bot.
   *
   * Do NOT "fix" this into a silent success: producing one means writing the
   * row, and the row, the notification and the spam call are the whole cost
   * this exists to refuse. The silent throttles downstream are silent because
   * their triggers *are* address-dependent — that is the distinction. */
  const ip = client_ip(request.headers);
  const bucket = signed_in
    ? { key: `lead-application:user:${signed_in.id}`, quota: LEAD_PER_USER }
    : ip
      ? { key: `lead-application:ip:${ip}`, quota: LEAD_PER_IP }
      : null;
  if (bucket && !consume(bucket.key, bucket.quota)) {
    return invalid({}, values, { message: THROTTLED });
  }

  // an organization applies here, not a person — so the organization prompt,
  // whose verdict on the name lands on `o_name`, the only name field here.
  const evl = await evaluate_org({ o_name, email }).catch(report_undefined);

  if (evl?.is_spam) {
    return invalid(
      evl.field === "email"
        ? { email: evl.explanation }
        : { o_name: evl.explanation },
      values
    );
  }

  /* the application is written before the account. `registrations.r_id` is an
   * address, not a foreign key, so the order is ours to pick — and this way a
   * duplicate identity or an unwritable row leaves no account behind with
   * nothing attached to it. */
  const res = await new_application_for(
    request,
    url,
    encoded,
    { email, unproven: !signed_in },
    o_name
  );

  if (!(res instanceof Response)) {
    const dup = (res as Partial<IDuplicate>).duplicate;
    if (!dup) throw resp.status(400, "could not start the application");
    // the duplicate gate answers on the identity that matched, so that is the
    // field the applicant would have to change to get past it.
    const msg = `${dup.name} is already registered with us. Sign in to your account to manage it.`;
    return invalid(
      fd.get("o_type") === "501c3"
        ? { o_ein: msg }
        : { o_registration_number: msg },
      values
    );
  }

  const to = res.headers.get("location");
  // `new_application_for` answers a non-redirect Response only by throwing
  // status — anything else is not ours to interpret.
  if (!to) throw res;

  if (signed_in) {
    // signed in as the address they typed: proven already, and the wizard is
    // open to them as themselves. nothing to mail, nothing to grant.
    return res;
  }

  const acct = await create_unverified_user({
    email,
    headers: request.headers,
  });

  if (acct.status === "created") {
    res.headers.append("set-cookie", await issue_draft_grant(acct.user_id));
    return res;
  }

  /* `existing` and `verified` answer identically on purpose: whether an
   * address already finished signing up is not this form's to disclose. a
   * grant is only ever minted for an account just created, so both get the
   * link instead — which is also how the real owner reaches the application
   * that was just started for them.
   *
   * `throttled` rides the same answer, which is what keeps the quota from
   * becoming its own oracle: being over the limit and being an address that
   * already exists are the same screen. */
  const headers = new Headers();
  for (const c of res.headers.getSetCookie()) headers.append("set-cookie", c);
  await request_login_link({
    email,
    redirect_to: to,
    headers: request.headers,
  });
  return redirect(check_email_url({ email, redirect_to: to }), { headers });
}
