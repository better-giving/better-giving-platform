import { reg_ineligibility } from "../stripe-connect/card-data";
import type { IReg } from "./schema";

export class Progress {
  r: IReg;
  routing_on: boolean;

  /** @param routing_on - the `STRIPE_CONNECT_ROUTING` switch, which only the
   * server reads, so a client caller takes it from its loader; `step` and
   * `steps` honour it */
  constructor(reg: IReg, routing_on: boolean) {
    this.r = reg;
    this.routing_on = routing_on;
  }

  get init() {
    const { id, r_id } = this.r;
    return { id, r_id: r_id };
  }

  /** step 1 */
  get contact() {
    const {
      r_first_name: fn,
      r_last_name: ln,
      o_name: on,
      r_org_role: or,
      rm,
    } = this.r;

    if (fn && ln && on && or && rm) {
      return {
        ...this.init,
        r_first_name: fn,
        r_last_name: ln,
        o_name: on,
        r_org_role: or,
        r_org_role_other: this.r.r_org_role_other,
        r_contact_number: this.r.r_contact_number,
        rm: rm,
        rm_referral_code: this.r.rm_referral_code,
        rm_other: this.r.rm_other,
      };
    }
    return undefined;
  }

  /** step 2 */
  get org() {
    const $ = this.contact;
    const { o_website: w, o_hq_country: c, o_designation: d } = this.r;
    if (w && c && d && $) {
      return {
        o_website: w,
        o_hq_country: c,
        o_activity_countries: this.r.o_active_in_countries,
        o_designation: d,
        ...$,
      };
    }
    return undefined;
  }

  /** identity seeded on screen 1 — clears with `org`; not a step anyone visits */
  get org_type() {
    const $ = this.org;
    const { o_type: ot } = this.r;
    return $ && ot ? { o_type: ot, ...$ } : undefined;
  }

  /** step 3 fsa  */
  get docs_fsa() {
    const $ = this.org_type;
    if (!$) return undefined;
    const { o_type, ...rest3 } = $;
    if (o_type !== "other") return undefined;

    const {
      r_proof_of_identity: poi,
      o_proof_of_reg: por,
      o_registration_number: rn,
      o_project_description: pd,
      o_legal_entity_type: lt,
    } = this.r;

    if (poi && por && rn && pd && lt) {
      return {
        r_proof_of_identity: poi,
        o_proof_of_reg: por,
        o_registration_number: rn,
        o_project_description: pd,
        o_legal_entity_type: lt,
        o_type,
        ...rest3,
      };
    }

    return undefined;
  }

  /** step 3b fsa */
  get fsa_url() {
    const $ = this.docs_fsa;
    const { o_fsa_signing_url: u } = this.r;
    return u && $ ? { o_fsa_signing_url: u, ...$ } : undefined;
  }

  /** step 3c fsa */
  get fsa_signed() {
    const $ = this.fsa_url;
    const { o_fsa_signed_doc_url: x } = this.r;
    return $ && x ? { o_fsa_signed_doc_url: x, ...$ } : undefined;
  }

  /** 501(c)(3) counterpart of `fsa_signed` — seeded on screen 1, crosses org
   * details into banking; not a step anyone visits */
  get docs_ein() {
    const $ = this.org_type;
    if (!$) return undefined;
    const { o_type, ...rest3 } = $;
    if (o_type !== "501c3") return undefined;

    const { o_ein: n } = this.r;
    return n ? { o_ein: n, o_type, ...rest3 } : undefined;
  }

  /** whether stripe can ever pay this org, fiscal sponsorship and hq country
   * judged; undefined until the identity step is done */
  get stripe_eligible() {
    const $3 = this.fsa_signed || this.docs_ein;
    return $3 && reg_ineligibility($3) === null;
  }

  /** step 4: a saved bank, or a stripe account connected in any status from
   * an org stripe can serve, whatever the `STRIPE_CONNECT_ROUTING` switch */
  get banking() {
    const $3 = this.fsa_signed || this.docs_ein;
    if (!$3) return undefined;
    const { o_bank_id: bid, o_bank_statement: bos } = this.r;
    const acct = this.r.o_stripe_account_id ?? null;
    const bank =
      bid && bos
        ? { o_bank_id: bid, o_bank_statement: bos }
        : { o_bank_id: null, o_bank_statement: null };
    if (!bank.o_bank_id && !(acct && this.stripe_eligible)) return undefined;
    return { ...bank, o_stripe_account_id: acct, ...$3 };
  }

  /** `banking`, less a stripe-only answer while routing is off
   * @param routing_on - the `STRIPE_CONNECT_ROUTING` switch */
  banking_with(routing_on: boolean) {
    const b = this.banking;
    return b && (b.o_bank_id || routing_on) ? b : undefined;
  }

  /** 1 contact · 2 org · 3 fsa agreement · 4 banking · 5 review & submit — only
   * `o_type: "other"` ever sits at 3; the seeded identity satisfies `docs_ein`,
   * so a 501(c)(3) crosses 2 → 4 */
  get step() {
    if (this.banking_with(this.routing_on)) return 5;
    if (this.docs_ein || this.fsa_signed) return 4;
    if (this.org) return 3;
    if (this.contact) return 2;
    return 1;
  }
  /** the four collecting steps, review excluded — index 2 (the agreement) is
   * already true for a 501(c)(3) */
  get steps(): boolean[] {
    return [
      this.contact,
      this.org,
      this.docs_ein || this.fsa_signed,
      this.banking_with(this.routing_on),
    ].map((x) => !!x);
  }
}
