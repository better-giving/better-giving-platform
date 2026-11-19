import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./columns";

export const registrations = pgTable(
  "registrations",
  {
    id: text("id").primaryKey(),
    r_id: text("r_id").notNull(),
    status: text("status").$type<"01" | "02" | "03" | "04">(),

    // contact (step 1)
    r_first_name: text("r_first_name"),
    r_last_name: text("r_last_name"),
    r_phone: text("r_phone"),
    r_email: text("r_email"),
    r_org_role: text("r_org_role"),
    r_org_role_other: text("r_org_role_other"),
    r_contact_number: text("r_contact_number"),

    // referral (step 1)
    rm: text("rm"),
    rm_referral_code: text("rm_referral_code"),
    rm_other: text("rm_other"),

    // org (step 2)
    o_name: text("o_name"),
    o_registration_number: text("o_registration_number"),
    o_country: text("o_country"),
    o_hq_country: text("o_hq_country"),
    o_street: text("o_street"),
    o_city: text("o_city"),
    o_state: text("o_state"),
    o_zip: text("o_zip"),
    o_designation: text("o_designation"),
    o_website: text("o_website"),
    o_sdgs: integer("o_sdgs").array(),
    o_active_in_countries: text("o_active_in_countries").array(),

    // org type (step 3)
    o_type: text("o_type").$type<"501c3" | "other">(),

    // documentation (step 4)
    o_ein: text("o_ein"),
    o_legal_entity_type: text("o_legal_entity_type"),
    o_project_description: text("o_project_description"),
    r_proof_of_identity: text("r_proof_of_identity"),
    o_proof_of_reg: text("o_proof_of_reg"),
    o_fsa_signing_url: text("o_fsa_signing_url"),
    o_fsa_signed_doc_url: text("o_fsa_signed_doc_url"),
    // the anvil document-group eid `/api/anvil-doc/$eid` recognises the signed
    // agreement by. written when the etch packet is created, not when it
    // completes: the etch-complete webhook and anvil's redirect to the success
    // page race, so a record written by the webhook lands too late to serve
    // that page. nullable — see `is_fsa_doc_eid` for what stands in when it is
    // null.
    o_fsa_doc_eid: text("o_fsa_doc_eid"),

    // banking (step 5)
    o_bank_id: text("o_bank_id"),
    o_bank_statement: text("o_bank_statement"),
    // stripe connected account; no npos row exists until approval copies it there
    o_stripe_account_id: text("o_stripe_account_id"),
    /** when this registration last saved `o_stripe_account_id`. a disconnect
     * event from before it is a redelivery and leaves the account. null: the
     * account was saved before this was kept, so a disconnect still clears it */
    o_stripe_connected_at: timestamptz("o_stripe_connected_at"),

    // branding
    o_image: text("o_image"),
    o_logo: text("o_logo"),
    o_banner: text("o_banner"),
    o_overview: text("o_overview"),

    // internal
    status_rejected_reason: text("status_rejected_reason"),
    status_approved_npo_id: integer("status_approved_npo_id"),
    created_at: timestamptz("created_at"),
    updated_at: timestamptz("updated_at"),
  },
  (t) => [
    check("status_check", sql`${t.status} IN ('01','02','03','04')`),
    index("registrations_r_id_status_idx").on(t.r_id, t.status, t.updated_at),
    index("registrations_status_updated_idx").on(t.status, t.updated_at),
    // the staff applications list's default order, every status
    index("registrations_updated_at_id_idx").on(t.updated_at.desc(), t.id),
    // every agreement download resolves an eid through this
    index("registrations_o_fsa_doc_eid_idx").on(t.o_fsa_doc_eid),
    // pg_trgm fuzzy search index on org name + id
    index("registrations_search_trgm_idx").using(
      "gin",
      sql`(COALESCE(${t.o_name},'') || ' ' || ${t.id}) gin_trgm_ops`
    ),
  ]
);
