import { type ActionFunction, href, redirect } from "react-router";
import { safeParse } from "valibot";
import { get_session, to_auth } from "#/.server/auth";
import { gen_fsa_signing_url } from "#/.server/registration/gen-fsa-signing-url";
import { reg_id_from_signer_eid } from "#/.server/registration/helpers";
import { wizard_exit } from "#/pages/registration/data/step-loader";
import { resp } from "@/helpers/https";
import { msg } from "@/queue";
import type { IFsaSigner, IReg } from "@/reg";
import { Progress } from "@/reg/progress";
import { fsa_docs_or_signer, type IFsaDocs, reg_id } from "@/reg/schema";
import { stripe as stripe_env } from "$/env";
import { enqueue } from "$/kit/queue";
import { reg_fsa_packet, reg_get } from "$/pg/queries/registration";

/** who signs, and over which documents: the ones posted by the documentation
 * form, or the ones already on the row when the sign-result page asks for the
 * packet again. */
const signer_of = (reg: IReg, docs_or_eid: IFsaDocs | string): IFsaSigner => {
  const prog = new Progress(reg, stripe_env.connect_routing);
  let r: Progress["org"];
  let docs: IFsaDocs;
  if (typeof docs_or_eid === "string") {
    const d = prog.docs_fsa;
    if (!d) {
      throw resp.status(
        400,
        `registration: ${reg.id} doesn't contain fsa docs`
      );
    }
    r = d;
    docs = {
      o_registration_number: d.o_registration_number,
      o_legal_entity_type: d.o_legal_entity_type,
      o_project_description: d.o_project_description,
      o_proof_of_reg: d.o_proof_of_reg,
      r_proof_of_identity: d.r_proof_of_identity,
    };
  } else {
    r = prog.org_type;
    if (!r) {
      throw resp.status(
        400,
        `registration not ready for FSA signing: ${reg.id}`
      );
    }
    docs = docs_or_eid;
  }
  return {
    first_name: r.r_first_name,
    last_name: r.r_last_name,
    email: reg.r_id,
    role: r.r_org_role === "other" ? (r.r_org_role_other ?? "") : r.r_org_role,
    org_name: r.o_name,
    org_hq_country: r.o_hq_country,
    docs,
  };
};

/** the step 3 documentation form and the sign-result page's retry both post
 * here: the first with the documents as json, the second with the signer eid
 * of a packet it wants reissued. */
export const action: ActionFunction = async ({ request, params, url }) => {
  const { user } = await get_session(request);
  if (!user) return to_auth(url);

  const content_type = request.headers.get("content-type");
  const payload =
    content_type === "application/json"
      ? await request.json()
      : await request.formData().then((fv) => fv.get("signer_eid")?.toString());

  const p1 = safeParse(fsa_docs_or_signer, payload);
  if (p1.issues) throw resp.status(400, p1.issues[0].message);
  const docs_or_eid = p1.output;

  let rid: string;
  if (typeof docs_or_eid === "string") {
    rid = await reg_id_from_signer_eid(docs_or_eid);
  } else {
    const p2 = safeParse(reg_id, params.reg_id);
    if (p2.issues) throw resp.status(400, p2.issues[0].message);
    rid = p2.output;
  }

  const reg = await reg_get(rid);
  if (!reg) throw resp.status(404, `registration not found: ${rid}`);
  if (reg.r_id !== user.email && user.role !== "admin") {
    throw resp.status(403);
  }

  // read-side only, so nothing is written before anvil: a packet for an
  // application in review or approved is one nobody should be signing. the
  // packet write re-checks it.
  const exit = wizard_exit(reg, 3);
  if (exit) return redirect(exit);
  const signer = signer_of(reg, docs_or_eid);

  const from = new URL(url);
  from.pathname = href("/register/:reg_id/sign-result", { reg_id: rid });
  from.search = "";

  const { url: signing_url, doc_eid } = await gen_fsa_signing_url(
    rid,
    signer,
    from.toString()
  );

  /* the packet anvil just minted asserts the identity read above. a reset
   * committing while it was being minted leaves the row carrying a different
   * one, so the packet is dropped rather than recorded; so is one for a row
   * submitted meanwhile, which goes where the step loader would send it. */
  const packet = await reg_fsa_packet(rid, reg.updated_at, {
    ...(typeof docs_or_eid === "string" ? {} : docs_or_eid),
    o_fsa_signing_url: signing_url,
    o_fsa_doc_eid: doc_eid,
  });
  if (!packet.won) {
    const moved = packet.row && wizard_exit(packet.row, 3);
    if (moved) return redirect(moved);
    throw resp.status(409, "application changed while signing");
  }

  await enqueue(msg("reg-updated", packet.row));

  return redirect(signing_url);
};
