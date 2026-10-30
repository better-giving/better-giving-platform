import {
  registration_approved,
  registration_new,
  registration_rejected,
} from "emails";
import { auth } from "#/.server/auth/auth";
import { mint_resume_link } from "#/.server/auth/resume-link";
import { report_error } from "#/errors/report";
import type { CompanyProperties, ContactProperties } from "@/hubspot";
import type { IRegCreatedPayload } from "@/queue";
import { Progress } from "@/reg/progress";
import type { IReg } from "@/reg/schema";
import { send_email, send_email_or_throw } from "$/email";
import { base_url, hubspot } from "$/env";
import { bg_sales } from "$/kit/slack";
import { wise } from "$/kit/wise";
import { reg_get } from "$/pg/queries/registration";
import { REFERRALS, ROLES } from "./constants";
import {
  create_deal,
  update_or_create_company,
  update_or_create_contact,
} from "./hubspot";

export async function handle_reg_created(r: IRegCreatedPayload) {
  // the row itself is deliberate: the lead form answers identically whether the
  // address is known, so refusing to write one would restore the enumeration
  // oracle. the mail is the only part a stranger actually receives, so it is
  // the part withheld — a verified account never started this registration and
  // must not be told it did.
  //
  // both halves must hold. `unproven` alone would silence the mail an ordinary
  // applicant needs (it carries the reference id `resume_application` takes),
  // and a verified address alone says nothing about who started this — every
  // wizard applicant is signed in, hence verified.
  if (r.unproven) {
    const ctx = await auth.$context;
    const found = await ctx.internalAdapter.findUserByEmail(
      r.r_id.trim().toLowerCase()
    );
    if (found?.user.emailVerified) {
      console.info(`reg:${r.id} registration_new skipped - verified account`);
      return;
    }
  }

  /* the reference alone is not a way back — `resume_application` only takes it
   * from someone already signed in — so the mail carries the application
   * itself. read at send time rather than trusted from the payload: the step is
   * derived from the answers on the row, and the row is the only thing that
   * knows them. a row that has since been deleted still gets a mail; the wizard
   * is what tells them it is gone. */
  const reg = await reg_get(r.id);
  const to = `/register/${r.id}/${reg ? new Progress(reg).step : 1}`;

  /* two audiences, one mail. an applicant who is already signed in has a
   * session and needs no key — a plain link lands them on the step, and the
   * wizard's own gate handles them if the session lapsed.
   *
   * only the unproven one gets a token, and only ever here: past the guard
   * above, no verified account owns this address. minting for the other cohort
   * would mail a long-lived second key to a proven account, which is the thing
   * `draft-grant` exists to refuse. */
  const resume_url = r.unproven
    ? await mint_resume_link({ email: r.r_id, redirect_to: to })
    : new URL(to, base_url).toString();

  const { node, subject } = registration_new.template({
    reference_id: r.id,
    resume_url,
  });
  const res = await send_email_or_throw({
    to: [r.r_id],
    node,
    subject,
  });
  console.info(res.id);
}

export async function handle_reg_updated(reg: IReg) {
  let ctp: ContactProperties | undefined;
  let cmp: CompanyProperties | undefined;

  const prog = new Progress(reg);
  const c = prog.contact;

  if (c) {
    ctp = {
      email: c.r_id,
      firstname: c.r_first_name,
      lastname: c.r_last_name,
      contract_phone_number: c.r_contact_number ?? "Not specified",
      contact_role_in_organisation: ROLES[c.r_org_role] || "Other",
      hubspot_owner_id: hubspot.owner_id,
      n501c_or_charitable_registration: "Yes",
      contact_role: "Charity contact",
    };
    cmp = {
      name: c.o_name,
      point_of_contact__initial_goal_: "deprecated:not specified",
      how_did_you_find_out_about_us_: REFERRALS[c.rm || "other"] || "Other",
      angel_giving_registration_number: reg.id,
      hubspot_owner_id: hubspot.owner_id,
    };
  }
  const o = prog.org;
  if (o && cmp) {
    cmp.website = o.o_website;
    cmp.country = o.o_hq_country;
  }

  const dfsa = prog.docs_fsa;
  if (dfsa && ctp) {
    ctp.identification_documentation = dfsa.r_proof_of_identity;
  }

  if (dfsa && cmp) {
    cmp.proof_of_charity_registration_documentation = dfsa.o_proof_of_reg;
    cmp.ein_or_charity_registration_number = dfsa.o_registration_number;
  }

  const dein = prog.docs_ein;
  if (dein && ctp) {
    ctp.identification_documentation = "not applicable";
  }

  if (dein && cmp) {
    cmp.ein_or_charity_registration_number = dein.o_ein;
    cmp.proof_of_charity_registration_documentation = "not applicable";
    cmp.fiscal_sponsorship_agreement_signed_document = "not applicable";
  }

  const fsa_signed = prog.fsa_signed;
  if (fsa_signed && cmp) {
    cmp.fiscal_sponsorship_agreement_signed_document =
      fsa_signed.o_fsa_signed_doc_url;
  }

  if (reg.status === "02") {
    // at-most-once, so a refused post is reported and left: the deal and the
    // contact sync below still run.
    try {
      const res = await bg_sales.send_alert({
        from: `registration lambda:${reg.env}`,
        title: "New application submitted for review",
        fields: [
          { name: "Registration id", value: reg.id },
          { name: "NPO name", value: reg.o_name || "missing" },
        ],
      });
      console.info(res.status, res.statusText);
    } catch (err) {
      report_error(err, { reg_id: reg.id });
    }
    const deal = await create_deal(reg.o_name || "missing");
    console.info(deal);
  }

  // the swallowing send, and an at-most-once kind behind it: a redelivery would
  // file a second hubspot deal for the same application, and a throw here would
  // skip the contact/company sync at the foot of this function. a refused status
  // mail is reported and left rather than re-driving everything around it.
  if (reg.status === "04") {
    const { node, subject } = registration_rejected.template({
      registrant_first_name: reg.r_first_name || "there",
      rejection_reason: reg.status_rejected_reason || "not specified",
    });
    const res = await send_email({ node, subject, to: [reg.r_id] });
    console.info(res.data?.id);
  }

  if (reg.status === "03") {
    const npo_id = reg.status_approved_npo_id;
    if (npo_id == null) {
      report_error(new Error("approved registration has no npo id"), {
        reg_id: reg.id,
      });
    }
    const { node, subject } = registration_approved.template({
      registrant_first_name: reg.r_first_name || "there",
      org_name: reg.o_name || undefined,
      endow_id: npo_id?.toString(),
      base_url,
    });

    const res = await send_email({ node, subject, to: [reg.r_id] });
    console.info(res.data?.id);
  }

  // below the status mails and caught, on an at-most-once kind: a wise error
  // costs the crm its bank fields, not the applicant their mail.
  const bnk = prog.banking;
  const wacc =
    bnk &&
    cmp &&
    (await wise.v2_account(+bnk.o_bank_id).catch((err) => {
      report_error(err, { reg_id: reg.id, during: "hubspot bank fields" });
    }));
  if (bnk && cmp && wacc) {
    const { address, accountNumber, name, details } = wacc;

    cmp.bank_account_number = `${accountNumber || "not specified"}`;
    cmp.bank_name = name.fullName || "not specified";
    cmp.bank_address = `${address?.city}, ${address?.country}`;
    cmp.bank_name =
      details.abartn ||
      details.BIC ||
      details.bankCode ||
      details.swiftCode ||
      "not specified";
    cmp.bank_statament = bnk.o_bank_statement;
  }

  if (ctp) {
    const contact = await update_or_create_contact(reg.r_id, ctp);
    console.info(`hubspot contact:${contact?.id}`);
  }

  if (cmp) {
    const company = await update_or_create_company(reg.id, cmp);
    console.info(`hubspot company:${company?.id}`);
  }
}
