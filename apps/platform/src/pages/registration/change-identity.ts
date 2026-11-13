import { valibotResolver } from "@hookform/resolvers/valibot";
import { redirect } from "react-router";
import { getValidatedFormData } from "remix-hook-form";
import { safeParse } from "valibot";
import { to_auth } from "#/.server/auth";
import { reg_user } from "#/pages/registration/data/reg-user";
import { wizard_exit } from "#/pages/registration/data/step-loader";
import {
  type IDuplicate,
  identity_payload,
  identity_regnum,
} from "#/pages/registration/identity";
import { resp } from "@/helpers/https";
import { msg } from "@/queue";
import type { IReg, IRegStartFv } from "@/reg";
import { Progress } from "@/reg/progress";
import { EDITABLE, reg_id, reg_new, reg_start_fv } from "@/reg/schema";
import { stripe as stripe_env } from "$/env";
import { enqueue } from "$/kit/queue";
import { db } from "$/pg/db";
import { npo_owned_by_regnum } from "$/pg/queries/npo";
import {
  reg_get,
  reg_update_from,
  type TRegAttrs,
} from "$/pg/queries/registration";

/** corrects the org type + identity of an application that already exists.
 * Only ever updates — the row is the applicant's; a change of mind is not a
 * second application. */
export const change_identity = async (
  request: Request,
  url: URL,
  reg_id_param: string | undefined,
  fd: FormData
) => {
  // opened to a draft grant for the same reason its screen is: correcting a
  // mistyped identity is what a lead needs *before* the address is proven.
  const ru = await reg_user(request, true);
  if (!ru) return to_auth(url);
  const { user } = ru;

  const p1 = safeParse(reg_id, reg_id_param);
  if (p1.issues) throw resp.status(400, p1.issues[0].message);
  const rid = p1.output;

  const fv = await getValidatedFormData<IRegStartFv>(
    fd,
    valibotResolver(reg_start_fv)
  );
  if (fv.errors) return fv;

  const reg = await reg_get(rid);
  if (!reg) throw resp.status(404, `reg:${rid} not found`);
  if (reg.r_id !== user.email && user.role !== "admin") {
    throw resp.status(401);
  }
  // in review and approved are closed to the applicant: the identity a
  // reviewer is reading must not move under them. a rejected one is open: the
  // rejection asks for it to be put right and resubmitted.
  if (!reg.status || !EDITABLE.includes(reg.status)) return closed(reg);

  const p2 = safeParse(reg_new, identity_payload(fv.data, reg.r_id));
  if (p2.issues) throw resp.status(400, p2.issues[0].message);
  const parsed = p2.output;

  // the same gate creating an application passes: a listing with members
  // behind it is the only one that can invite this registrant in.
  const [rn, country] = identity_regnum(parsed);
  const owned = await npo_owned_by_regnum(rn, country);
  if (owned) return { duplicate: { name: owned.name } } satisfies IDuplicate;

  /* the identity columns always travel as a unit (`reg_new`), so all three are
   * written whichever branch is chosen — a legacy row missing one of them
   * recovers by being rewritten whole. What is conditional is the *other*
   * branch's leftovers, which only a switch can strand. */
  const switched = reg.o_type !== parsed.o_type;

  /* evidence is attached to a legal entity, not to an application. A type
   * switch is only one way to name a different entity — a new registration
   * number or a new country does it just as completely, and leaves `o_type`
   * untouched. Re-submitting the identity unchanged strands nothing. */
  const prev_rn =
    reg.o_type === "501c3" ? reg.o_ein : reg.o_registration_number;
  const replaced = switched || rn !== prev_rn || country !== reg.o_hq_country;

  const attrs: TRegAttrs = {
    // back to draft, as any edit of a rejected application is
    status: "01",
    ...(parsed.o_type === "501c3"
      ? {
          o_type: parsed.o_type,
          o_ein: parsed.o_ein,
          o_hq_country: parsed.o_hq_country,
          ...(switched && { o_registration_number: null }),
        }
      : {
          o_type: parsed.o_type,
          o_hq_country: parsed.o_hq_country,
          o_registration_number: parsed.o_registration_number,
          ...(switched && { o_ein: null }),
        }),
  };

  if (replaced) {
    // an agreement signed against a different legal identity is not evidence
    // for this one, in either direction.
    attrs.o_fsa_signing_url = null;
    attrs.o_fsa_signed_doc_url = null;
    // and the eid with them: it is what `is_fsa_doc_eid` recognises the
    // agreement by, so a surviving one keeps the superseded document
    // downloadable by anyone holding its link.
    attrs.o_fsa_doc_eid = null;
    // the two documents that assert something about *the entity*: its legal
    // form and its proof of registration. The project description (what the
    // work is) and the registrant's own ID both survive — neither is a claim
    // about the entity that just changed.
    attrs.o_legal_entity_type = null;
    attrs.o_proof_of_reg = null;
    // banking is deliberately not among them: `o_bank_id`/`o_bank_statement`
    // survive the switch, so `Progress.banking` stays satisfied and step 4
    // never re-prompts. moving the payout is the applicant's to redo there.
  }

  // a submit committing since the read must not be pulled back to draft
  const updated = await reg_update_from(db, rid, EDITABLE, attrs);
  if (!updated.won) return closed(updated.row);
  await enqueue(msg("reg-updated", updated.row));

  /* nothing here maintains step state: `Progress` reads it off the columns, so
   * a 501(c)(3) sitting at banking that becomes international lands back on
   * the agreement on its own, and one that goes the other way skips it. */
  // the guarded write's bare `.returning()` hands back the whole row, so
  // nothing is missing for `.step`; the cast is only IReg's optionals against
  // the columns' nulls, the same mismatch `reg_get` casts through.
  const step = new Progress(
    updated.row as unknown as IReg,
    stripe_env.connect_routing
  ).step;
  return redirect(`../${step}`);
};

/** a row past editing: where its loader would send it, as `update_action` does */
const closed = (row: Parameters<typeof wizard_exit>[0] | null) => {
  const exit = row && wizard_exit(row);
  if (exit) return redirect(exit);
  throw resp.status(
    409,
    "This application can't be edited while it is under review or approved."
  );
};
