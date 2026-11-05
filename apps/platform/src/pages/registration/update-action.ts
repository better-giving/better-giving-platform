import { type ActionFunction, redirect, replace } from "react-router";
import { safeParse } from "valibot";
import { check_email_url, request_login_link, to_auth } from "#/.server/auth";
import { reg_user } from "#/pages/registration/data/reg-user";
import { wizard_exit } from "#/pages/registration/data/step-loader";
import { GRANT_UPDATE_TYPE, steps } from "#/pages/registration/routes";
import { resp } from "@/helpers/https";
import { msg } from "@/queue";
import type { IReg } from "@/reg";
import { Progress } from "@/reg/progress";
import {
  EDITABLE,
  reg_id,
  reg_update as reg_update_schema,
} from "@/reg/schema";
import { stripe as stripe_env } from "$/env";
import { enqueue } from "$/kit/queue";
import { db } from "$/pg/db";
import {
  reg_get,
  reg_update_from,
  type TRegAttrs,
} from "$/pg/queries/registration";

const changed = <T extends boolean | string | number | undefined>(a: T, b: T) =>
  a != null && b != null && a !== b;

export interface IUpdateActionOpts {
  /** the contact step: reachable by a draft-grant holder, whose address is not
   * proven yet. finishing it is what asks for the proof. */
  registrant?: boolean;
  /** redirect to `next` even when the application is already complete, where
   * a save otherwise goes straight to the summary. banking: its saved state is
   * where the stripe card shows. the redirect replaces the history entry, so
   * a `next` that is the posting step itself leaves no duplicate behind Back. */
  next_always?: boolean;
}

/** `next` is a function where the step it hands off to depends on the
 * application itself — org details branches on `o_type` (see `after_org`). */
export const update_action =
  (
    next: string | ((reg: IReg) => string),
    opts?: IUpdateActionOpts
  ): ActionFunction =>
  async ({ request, params, url }) => {
    const ru = await reg_user(request, !!opts?.registrant);
    if (!ru) return to_auth(url);
    const { user, grant } = ru;

    const p1 = safeParse(reg_id, params.reg_id);
    if (p1.issues) return resp.fail(400, p1.issues[0].message);
    const rid = p1.output;
    const p2 = safeParse(reg_update_schema, await request.json());
    if (p2.issues) return resp.fail(400, p2.issues[0].message);
    const upd8 = p2.output;

    // the grant opens the contact step and nothing else — the later steps'
    // fields are not its to write, whichever url the post lands on.
    if (grant && upd8.update_type !== GRANT_UPDATE_TYPE) throw resp.status(403);

    const reg = await reg_get(rid);
    if (!reg) throw resp.status(404, `reg:${rid} not found`);

    if (reg.r_id !== user.email && user.role !== "admin") {
      throw resp.status(401);
    }

    const { update_type, ...fields } = upd8;
    const attrs: TRegAttrs = { ...fields, status: "01" as const };

    //resets
    const prog = new Progress(reg, stripe_env.connect_routing);
    const done_fsa_url = prog.fsa_url;

    const contact_changed =
      update_type === GRANT_UPDATE_TYPE &&
      (changed(reg.r_first_name, upd8.r_first_name) ||
        changed(reg.r_last_name, upd8.r_last_name) ||
        changed(reg.o_name, upd8.o_name) ||
        changed(reg.r_org_role, upd8.r_org_role));

    // a change in fsa country -> US doesn't mean NPO is 501c3
    if (done_fsa_url && contact_changed) {
      attrs.o_fsa_signing_url = null;
      attrs.o_fsa_signed_doc_url = null;
      // the eid is what `is_fsa_doc_eid` recognises the agreement by, so it is
      // also what keeps the download open to anyone holding the link. leaving
      // it behind revokes the record and not the capability.
      attrs.o_fsa_doc_eid = null;
    }

    /* identity + its resets are change-identity.ts's, not a step's */

    const updated = await reg_update_from(db, rid, EDITABLE, attrs);
    if (!updated.won) {
      // a tab left open past submit or approval: where its loader would send it
      const exit = updated.row && wizard_exit(updated.row);
      if (exit) return redirect(exit);
      throw resp.status(
        409,
        "This application can't be edited while it is under review or approved."
      );
    }
    await enqueue(msg("reg-updated", updated.row));

    /* the address is asked to prove itself here rather than at the marketing
     * form: a lead that never finished this step is one we mailed nothing. */
    if (grant) {
      const to = `/register/${rid}/${steps.org_details}`;
      await request_login_link({
        email: user.email,
        redirect_to: to,
        headers: request.headers,
      });
      return redirect(check_email_url({ email: user.email, redirect_to: to }));
    }

    if (prog.step === 5 && !opts?.next_always)
      return redirect(`../${steps.summary}`);
    const to = `../${typeof next === "string" ? next : next(reg)}`;
    return opts?.next_always ? replace(to) : redirect(to);
  };
