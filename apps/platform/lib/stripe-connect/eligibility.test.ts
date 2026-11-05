import { describe, expect, test } from "vitest";
import {
  connect_ineligibility,
  is_routable,
  routing_npo,
  TRANSFER_COUNTRIES,
  TRANSFER_COUNTRIES_COPY,
} from "./eligibility";

/** the npo row columns routing reads, ready to route */
const row = {
  stripe_account_id: "acct_1" as string | null,
  stripe_charges_enabled: true,
  stripe_payouts_enabled: true,
  stripe_details_submitted: true,
  stripe_requirements_due: [] as string[],
  stripe_deauthorized_at: null as string | null,
  fiscal_sponsored: false,
  hq_country: "United States",
};
type Row = typeof row;

const routable = (patch: Partial<Row> = {}, on = true) =>
  is_routable(routing_npo({ ...row, ...patch }), on);

describe("is_routable", () => {
  test("a ready, unsponsored npo in a supported country routes when the switch is on", () => {
    expect(routable()).toBe(true);
  });

  test("the same npo stays pooled while the switch is off", () => {
    expect(routable({}, false)).toBe(false);
  });

  // a sponsored org isn't the donee, so no stripe state can make it one
  test("a fiscally sponsored npo never routes, however ready its account", () => {
    expect(routable({ fiscal_sponsored: true })).toBe(false);
  });

  // stripe keeps billing a disconnected account's donors but can no longer pay it
  test("an npo that disconnected us stays pooled, however ready its account last read", () => {
    expect(
      routable({ stripe_deauthorized_at: "2026-10-01T00:00:00.000Z" })
    ).toBe(false);
  });

  test.each<[string, Partial<Row>]>([
    ["no connected account", { stripe_account_id: null }],
    ["payouts not enabled", { stripe_payouts_enabled: false }],
    ["details not submitted", { stripe_details_submitted: false }],
    // readiness is connect_status's "ready", the banking page's own word for it
    ["charges not enabled", { stripe_charges_enabled: false }],
  ])("%s stays pooled", (_case, patch) => {
    expect(routable(patch)).toBe(false);
  });

  test.each<[string, string]>([
    // stripe has no self-serve transfer to a full account outside the set
    ["outside the transfer set", "Philippines"],
    // stripe offers icelandic accounts only on the recipient agreement
    ["recipient-only", "Iceland"],
    ["unmappable", "Atlantis"],
  ])("an hq country %s stays pooled", (_case, hq_country) => {
    expect(routable({ hq_country })).toBe(false);
  });

  test.each(["United Kingdom", "switzerland", "Germany", " Norway "])(
    "an hq country of %s routes",
    (hq_country) => {
      expect(routable({ hq_country })).toBe(true);
    }
  );
});

describe("connect_ineligibility", () => {
  test("a fiscally sponsored npo is ineligible as sponsored, whatever its country", () => {
    expect(
      connect_ineligibility({
        fiscal_sponsored: true,
        hq_country: "Philippines",
      })
    ).toEqual({ reason: "fiscal_sponsored" });
  });

  test.each(["Philippines", "Iceland", "Atlantis"])(
    "an hq country of %s is ineligible, carried as stored",
    (hq_country) => {
      expect(
        connect_ineligibility({ fiscal_sponsored: false, hq_country })
      ).toEqual({ reason: "country", hq_country });
    }
  );

  test("an unsponsored npo in the transfer set has nothing ruling it out", () => {
    expect(
      connect_ineligibility({ fiscal_sponsored: false, hq_country: "Germany" })
    ).toBeNull();
  });
});

describe("TRANSFER_COUNTRIES_COPY", () => {
  // the oracle: EU-27 membership, independent of the transfer set
  const EU_27 = [
    "AT",
    "BE",
    "BG",
    "HR",
    "CY",
    "CZ",
    "DK",
    "EE",
    "FI",
    "FR",
    "DE",
    "GR",
    "HU",
    "IE",
    "IT",
    "LV",
    "LT",
    "LU",
    "MT",
    "NL",
    "PL",
    "PT",
    "RO",
    "SK",
    "SI",
    "ES",
    "SE",
  ];
  const codes_by_region: Record<string, string[]> = {
    "the US": ["US"],
    Canada: ["CA"],
    "the UK": ["GB"],
    Switzerland: ["CH"],
    Liechtenstein: ["LI"],
    Norway: ["NO"],
    "EU countries": EU_27,
  };
  const regions = TRANSFER_COUNTRIES_COPY.split(/, | and /);

  test("every region the copy names is one this pin knows", () => {
    expect(regions.filter((r) => !(r in codes_by_region))).toEqual([]);
  });

  test("the copy names exactly the transfer set", () => {
    const named = regions.flatMap((r) => codes_by_region[r] ?? []);
    expect(new Set(named)).toEqual(new Set(TRANSFER_COUNTRIES));
  });
});
