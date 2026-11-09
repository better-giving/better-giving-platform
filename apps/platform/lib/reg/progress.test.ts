import { describe, expect, it } from "vitest";
import { Progress } from "./progress";
import type { IReg } from "./schema";

const base: IReg = {
  id: "reg-1",
  r_id: "applicant@example.com",
  status: "01",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

/** step 1 */
const contact = {
  r_first_name: "Jane",
  r_last_name: "Doe",
  o_name: "Test Org",
  r_org_role: "ceo",
  rm: "search-engines",
} as const;

/** step 2 */
const org = {
  o_website: "https://example.com",
  o_designation: "Charity",
} as const;

/** seeded on the first screen, never re-asked */
const us_identity = {
  o_type: "501c3",
  o_ein: "123456789",
  o_hq_country: "United States",
} as const;

const intl_identity = {
  o_type: "other",
  o_hq_country: "Canada",
  o_registration_number: "abc123",
} as const;

/** step 3 — only reachable with `o_type: "other"` */
const fsa_docs = {
  r_proof_of_identity: "https://example.com/id.pdf",
  o_proof_of_reg: "https://example.com/reg.pdf",
  o_project_description: "aid work",
  o_legal_entity_type: "Nonprofit Corporation",
  o_fsa_signing_url: "https://anvil.test/sign",
  o_fsa_signed_doc_url: "https://example.com/signed.pdf",
} as const;

/** step 4 */
const banking = {
  o_bank_id: "999",
  o_bank_statement: "https://example.com/bank.pdf",
} as const;

const reg = (...parts: Partial<IReg>[]): IReg =>
  Object.assign({}, base, ...parts);

/** with `STRIPE_CONNECT_ROUTING` on unless a case turns it off */
const progress = (r: IReg, routing_on = true) => new Progress(r, routing_on);

describe("Progress.step", () => {
  it("starts a fresh application on contact", () => {
    expect(progress(reg(us_identity)).step).toBe(1);
  });

  it("moves to organization once contact is complete", () => {
    expect(progress(reg(us_identity, contact)).step).toBe(2);
  });

  it("puts a 501(c)(3) with org details straight on banking — there is no step 3 for it", () => {
    const r = progress(reg(us_identity, contact, org));
    expect(r.step).toBe(4);
  });

  it("holds an international org at the agreement until it is signed", () => {
    expect(progress(reg(intl_identity, contact, org)).step).toBe(3);

    const { o_fsa_signed_doc_url: _, ...unsigned } = fsa_docs;
    expect(progress(reg(intl_identity, contact, org, unsigned)).step).toBe(3);
  });

  it("moves an international org to banking once the agreement is signed", () => {
    const r = progress(reg(intl_identity, contact, org, fsa_docs));
    expect(r.step).toBe(4);
  });

  it("reaches review from either branch once banking is done", () => {
    expect(progress(reg(us_identity, contact, org, banking)).step).toBe(5);
    expect(
      progress(reg(intl_identity, contact, org, fsa_docs, banking)).step
    ).toBe(5);
  });

  // without `reg_new`'s seeded country a 501(c)(3) strands at 2, silently
  it("strands a 501(c)(3) at organization when hq country was never seeded", () => {
    const { o_hq_country: _, ...no_country } = us_identity;
    expect(progress(reg(no_country, contact, org, banking)).step).toBe(2);
  });
});

describe("Progress.steps", () => {
  it("marks the agreement done for a 501(c)(3) that never signs one", () => {
    const r = progress(reg(us_identity, contact, org, banking));
    expect(r.steps).toEqual([true, true, true, true]);
  });

  it("leaves the agreement pending for an unsigned international org", () => {
    const r = progress(reg(intl_identity, contact, org));
    expect(r.steps).toEqual([true, true, false, false]);
  });
});

describe("Progress.banking", () => {
  const stripe = { o_stripe_account_id: "acct_123" } as const;

  it("is done with a connected stripe account and no bank", () => {
    const r = progress(reg(us_identity, contact, org, stripe));
    expect(r.step).toBe(5);
    expect(r.steps).toEqual([true, true, true, true]);
    expect(r.banking).toMatchObject({
      o_bank_id: null,
      o_stripe_account_id: "acct_123",
    });
  });

  it("holds a stripe-only applicant on banking while routing is off", () => {
    const r = progress(reg(us_identity, contact, org, stripe), false);
    expect(r.step).toBe(4);
    expect(r.steps).toEqual([true, true, true, false]);
  });

  it("banking_with(false) refuses a stripe-only answer and keeps a bank", () => {
    const stripe_only = progress(reg(us_identity, contact, org, stripe));
    expect(stripe_only.banking_with(false)).toBeUndefined();
    expect(stripe_only.banking_with(true)).toMatchObject({
      o_stripe_account_id: "acct_123",
    });

    const banked = progress(reg(us_identity, contact, org, banking, stripe));
    expect(banked.banking_with(false)).toMatchObject({ o_bank_id: "999" });
  });

  it("stays on banking with neither a bank nor stripe", () => {
    const r = progress(reg(us_identity, contact, org));
    expect(r.step).toBe(4);
    expect(r.banking).toBeUndefined();
  });

  it("needs the bank from a fiscally sponsored org, stripe or not", () => {
    const r = progress(reg(intl_identity, contact, org, fsa_docs, stripe));
    expect(r.step).toBe(4);
    expect(r.banking).toBeUndefined();
  });
});
