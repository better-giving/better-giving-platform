import { describe, expect, test } from "vitest";
import { reg_ineligibility } from "./card-data";

describe("reg_ineligibility", () => {
  test("a registration for a fiscally sponsored org is ineligible as sponsored", () => {
    expect(
      reg_ineligibility({ o_type: "other", o_hq_country: "Philippines" })
    ).toEqual({ reason: "fiscal_sponsored" });
  });

  // the org step hasn't run, so there is no country to judge yet
  test("a registration with no hq country yet has nothing ruling it out", () => {
    expect(reg_ineligibility({ o_type: "501c3", o_hq_country: "" })).toBeNull();
  });

  test("a us 501c3 registration has nothing ruling it out", () => {
    expect(
      reg_ineligibility({ o_type: "501c3", o_hq_country: "United States" })
    ).toBeNull();
  });

  test("a registration outside the transfer set is ineligible for its country", () => {
    expect(
      reg_ineligibility({ o_type: "501c3", o_hq_country: "Philippines" })
    ).toEqual({ reason: "country", hq_country: "Philippines" });
  });
});
