import { $, $req, https_url, org_designation, org_slug } from "../schemas";
import { person_name } from "../schemas/person-name";

export type { OrgDesignation as EndowDesignation, UnSdgNum } from "../schemas";

import * as v from "valibot";
import { max_date, min_date } from "./constants";

const org_roles = [
  "president",
  "vice-president",
  "secretary",
  "treasurer",
  "ceo",
  "cfo",
  "board-member",
  "leadership-team",
  "fundraising-finance",
  "legal",
  "communications",
  "other",
  "executive-director",
] as const;
export const org_role = v.picklist(org_roles, "required");
export type TRole = v.InferOutput<typeof org_role>;

const referral_methods = [
  "referral",
  "better-giving-alliance",
  "discord",
  "facebook",
  "linkedin",
  "medium",
  "press",
  "search-engines",
  "twitter",
  "other",
] as const;

const url = v.pipe($req, v.url("invalid url"));
export const referral_method = v.picklist(referral_methods, "required");
export type TReferralMethod = v.InferOutput<typeof referral_method>;

export const reg_id = v.pipe($, v.uuid("invalid reference number"));

/**
 * 01 - in-progress
 * 02 - in-review
 * 03 - approved
 * 04 - rejected
 */
const statuses = ["01", "02", "03", "04"] as const;
export const status = v.picklist(statuses);
export type TStatus = v.InferOutput<typeof status>;

/** draft and rejected: the applicant's to edit and resubmit. under review and
 * approved belong to review. */
export const EDITABLE: TStatus[] = ["01", "04"];

/**
 * 01 - in-progress
 * 02 - in-review
 * 03 - approved
 * 04 - rejected
 */

/** us ein as collected on the first screen: 9 digits, dashes/spaces tolerated
 * on input and stripped, so what lands in `o_ein` matches what the wizard and
 * `npos.registration_number` hold. */
const ein_9 = v.pipe(
  $req,
  v.transform((x) => x.replace(/[\s-]/g, "")),
  v.regex(/^\d{9}$/, "Enter a valid 9-digit EIN (for example 12-3456789).")
);

const org_types = ["501c3", "other"] as const;
const org_type = v.picklist(org_types);
export type TOrgType = v.InferOutput<typeof org_type>;

/** `o_type`, the identity column it implies, and the hq country all travel as
 * one unit: `Progress` derives the step from which columns are non-null, and
 * `docs_ein` is `undefined` unless `o_type === "501c3"` while `org` is
 * `undefined` without `o_hq_country` — which the org step doesn't ask a US
 * applicant for. Writing any of the three without the others caps the
 * application at a step it can never pass, so they are never separable here.
 * `"United States"` is what the duplicate check matches this branch on and
 * what `npos.hq_country` stores. */
const us_identity = {
  o_type: v.literal("501c3"),
  o_ein: ein_9,
  o_hq_country: v.literal("United States"),
} as const;

const intl_identity = {
  o_type: v.literal("other"),
  o_hq_country: $req,
  o_registration_number: v.pipe($req, v.toLowerCase()),
} as const;

const reg_new_base = {
  r_id: v.pipe($req, v.toLowerCase(), v.email()),
  referrer: v.optional($req),
  /** seeded only when the entry point already collected it — the marketing
   * lead forms ask for it, the wizard's own start screen doesn't. the contact
   * step asks for it either way and prefills from here. */
  o_name: v.optional($req),
} as const;

export const reg_new = v.variant("o_type", [
  v.object({ ...reg_new_base, ...us_identity }),
  v.object({ ...reg_new_base, ...intl_identity }),
]);

/** org type + identity as a form: what the first screen collects to create an
 * application, and what the change-identity screen re-collects to correct one.
 * flat rather than a variant so react-hook-form has one field set to register
 * against; the branch that doesn't apply is dropped by `reg_new` on the
 * server. */
export const reg_start_fv = v.pipe(
  v.object({
    o_type: org_type,
    // the branch that isn't showing submits nothing, so every identity field
    // has to survive its own absence — requiredness is the partialChecks' job
    o_ein: v.optional(
      v.pipe(
        $,
        v.transform((x) => x.replace(/[\s-]/g, ""))
      ),
      ""
    ),
    o_hq_country: v.optional($, ""),
    o_registration_number: v.optional(v.pipe($, v.toLowerCase()), ""),
  }),
  v.forward(
    v.partialCheck(
      [["o_type"], ["o_ein"]],
      (i) => i.o_type !== "501c3" || /^\d{9}$/.test(i.o_ein),
      "Enter a valid 9-digit EIN (for example 12-3456789)."
    ),
    ["o_ein"]
  ),
  v.forward(
    v.partialCheck(
      [["o_type"], ["o_hq_country"]],
      (i) => i.o_type !== "other" || !!i.o_hq_country,
      "Select your country of registration."
    ),
    ["o_hq_country"]
  ),
  v.forward(
    v.partialCheck(
      [["o_type"], ["o_registration_number"]],
      (i) => i.o_type !== "other" || !!i.o_registration_number,
      "Enter your registration number."
    ),
    ["o_registration_number"]
  )
);
export interface IRegStartFv extends v.InferOutput<typeof reg_start_fv> {}

export const reg_resume_fv = v.object({ reference: v.pipe($req, reg_id) });
export interface IRegResumeFv extends v.InferOutput<typeof reg_resume_fv> {}

export interface IRegInternal {
  id: string;
  created_at: string;
  updated_at: string;
  /** @deprecated */
  env?: never;
}

const o_project_description_max_length = 4000;
export const fsa_docs_fv = v.object({
  o_registration_number: v.pipe($req, v.toLowerCase()),
  o_legal_entity_type: $req,
  o_project_description: v.pipe(
    $req,
    v.maxLength(
      o_project_description_max_length,
      ({ requirement }) => `can't be more than ${requirement} chars`
    )
  ),
});

const fsa_docs = v.object({
  ...fsa_docs_fv.entries,
  r_proof_of_identity: url,
  o_proof_of_reg: url,
});

export interface IFsaDocs extends v.InferOutput<typeof fsa_docs> {}
export type IRegNew = v.InferOutput<typeof reg_new>;

export const _update_contact_fv = v.object({
  r_first_name: person_name,
  r_last_name: person_name,
  r_contact_number: v.optional($),
  r_org_role: org_role,
  r_org_role_other: v.optional($req),
  rm: referral_method,
  /** when `referral_method = "referral"` : may be empty */
  rm_referral_code: v.optional($),
  /** when `referral_method = "other"` : may be empty */
  rm_other: v.optional($),
  o_name: $req,
});

const _update_contact = v.object({
  update_type: v.literal("contact"),
  ...v.partial(_update_contact_fv).entries,
});

export interface IUpdateContact extends v.InferOutput<typeof _update_contact> {}

const update_contact = v.pipe(
  _update_contact,
  // referral method - referral
  v.forward(
    v.partialCheck(
      [["rm"], ["rm_referral_code"]],
      (i) => (i.rm === "referral" ? !!i.rm_referral_code : true),
      "required"
    ),
    ["rm_referral_code"]
  ),
  // referral method - other
  v.forward(
    v.partialCheck(
      [["rm"], ["rm_other"]],
      (i) => (i.rm === "other" ? !!i.rm_other : true),
      "required"
    ),
    ["rm_other"]
  ),
  // org role other
  v.forward(
    v.partialCheck(
      [["r_org_role"], ["r_org_role_other"]],
      (i) => (i.r_org_role === "other" ? !!i.r_org_role_other : true),
      "required"
    ),
    ["r_org_role_other"]
  )
);

export const update_org_fv = v.object({
  o_website: https_url({ required: true }),
  o_hq_country: $req,
  o_active_in_countries: v.optional(v.array($)),
  o_designation: org_designation,
  /** optional: an empty slug never holds an application back */
  o_slug: v.optional(org_slug),
});

const update_org = v.object({
  update_type: v.literal("org"),
  ...v.partial(update_org_fv).entries,
  /** cleared is stored as null */
  o_slug: v.optional(
    v.pipe(
      org_slug,
      v.transform((x) => x || null)
    )
  ),
  /** @deprecated */
  o_kyc_donors_only: v.optional(v.boolean()),
  /** @deprecated */
  o_un_sdg: v.optional(v.array(v.number())),
});

export interface IUpdateOrg extends v.InferOutput<typeof update_org> {}

/** org type and the identity column it implies, as they sit on a stored row.
 * Not a member of `reg_update`: `reg_update` is the wizard steps' contract,
 * and these two are written as a unit by `reg_new` at creation and by the
 * change-identity screen afterwards — both on `reg_start_fv`/`ein_9`. */
export interface IRegIdentity {
  o_type?: TOrgType;
  o_ein?: string;
}

const update_fsa_docs = v.object({
  update_type: v.literal("fsa-doc"),
  ...v.partial(fsa_docs).entries,
});
export interface IUpdateFsaDocs extends v.InferOutput<typeof update_fsa_docs> {}

const update_bank_fv = v.object({
  /** wise recipient id */
  o_bank_id: $req,
  o_bank_statement: url,
});

const update_bank = v.object({
  update_type: v.literal("banking"),
  ...v.partial(update_bank_fv).entries,
});

export interface IUpdateBank extends v.InferOutput<typeof update_bank> {}

export const reg_update = v.variant("update_type", [
  update_contact,
  update_org,
  update_fsa_docs,
  update_bank,
]);

export type TRegUpdate = v.InferOutput<typeof reg_update>;

type Attr<T extends { update_type: string }> = Omit<T, "update_type">;

export interface IRegUpdateables
  extends Attr<IUpdateContact>,
    Attr<IUpdateOrg>,
    Attr<IUpdateFsaDocs>,
    Attr<IUpdateBank>,
    IRegIdentity {
  status_rejected_reason?: string;
}

export interface IRegUpdateInternal {
  o_fsa_signing_url?: string;
  o_fsa_signed_doc_url?: string;
  o_fsa_doc_eid?: string;
  /** stripe connected account; approval copies it to `npos.stripe_account_id` */
  o_stripe_account_id?: string | null;
  status: TStatus;
  status_approved_npo_id?: number;
}

export interface IReg
  extends IRegUpdateables,
    IRegUpdateInternal,
    IRegInternal {
  /* the non-updateable half of `IRegNew`. `o_type`/`o_ein`/`o_hq_country`/
   * `o_registration_number` are seeded at creation too, but a stored row may
   * predate them, so they stay optional via `IRegUpdateables`. */
  r_id: string;
  referrer?: string;
}

export const regs_sort_key = v.picklist([
  "o_name",
  "updated_at",
  "o_hq_country",
  "status",
]);
export type TRegsSortKey = v.InferOutput<typeof regs_sort_key>;

export const regs_search = v.pipe(
  v.object({
    next: v.optional(v.string()),
    query: v.optional(v.pipe(v.string(), v.maxLength(100))),
    country: v.optional(v.string()),
    start_date: v.optional(
      v.pipe(v.string(), v.isoTimestamp(), v.minValue(min_date))
    ),
    end_date: v.optional(
      v.pipe(v.string(), v.isoTimestamp(), v.maxValue(max_date))
    ),
    status: v.optional(v.union([v.literal(""), status])),
    sort_key: v.optional(regs_sort_key),
    sort_dir: v.optional(v.picklist(["asc", "desc"])),
  }),
  v.check((x) => {
    if (x.start_date && x.end_date) {
      return x.start_date <= x.end_date;
    }
    return true;
  }, "start date must be less than end date")
);

export interface IRegsSearch extends v.InferInput<typeof regs_search> {}
export interface IRegsSearchObj extends v.InferOutput<typeof regs_search> {}

export const fsa_docs_or_signer = v.union([fsa_docs, $req /** signer eid */]);
