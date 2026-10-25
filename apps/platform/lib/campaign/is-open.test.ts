import { describe, expect, test } from "vitest";
import { fund_closes_at, fund_is_open, fund_item_is_open } from "./is-open";

const now = new Date("2027-09-23T12:00:00.000Z");

describe("fund_is_open", () => {
  test("an active fund with no expiration is open", () => {
    expect(fund_is_open({ active: true, expiration: null }, now)).toBe(true);
    expect(fund_is_open({ active: true }, now)).toBe(true);
  });

  test("an inactive fund is closed however far off its expiration is", () => {
    const f = { active: false, expiration: "2099-01-01T00:00:00.000Z" };
    expect(fund_is_open(f, now)).toBe(false);
  });

  describe("an end date of Oct 1, stored as midnight UTC", () => {
    const f = { active: true, expiration: "2027-10-01T00:00:00.000Z" };

    test("is open late on Oct 1 in Pacific time", () => {
      expect(fund_is_open(f, new Date("2027-10-02T06:00:00.000Z"))).toBe(true);
    });

    test("is open until Oct 1 has ended in UTC-12", () => {
      expect(fund_is_open(f, new Date("2027-10-02T11:59:59.999Z"))).toBe(true);
    });

    test("closes once Oct 1 has ended everywhere", () => {
      expect(fund_is_open(f, new Date("2027-10-02T12:00:00.000Z"))).toBe(false);
    });
  });
});

describe("fund_closes_at", () => {
  test.each([
    ["midnight", "2027-10-01T00:00:00.000Z"],
    ["a time of day", "2027-10-01T15:00:00.000Z"],
    ["the last microsecond of the day", "2027-10-01T23:59:59.999999Z"],
  ])(
    "an Oct 1 expiration stored at %s closes when Oct 1 has ended everywhere",
    (_, expiration) => {
      expect(fund_closes_at(expiration).toISOString()).toBe(
        "2027-10-02T12:00:00.000Z"
      );
    }
  );
});

describe("fund_item_is_open", () => {
  // a list item carries its expiration as unix seconds
  const oct_1 = Date.parse("2027-10-01T00:00:00.000Z") / 1000;

  test("reads an item's expiration on the same rule as a fund's", () => {
    const f = { active: true, expiration: oct_1 };
    expect(fund_item_is_open(f, new Date("2027-10-02T11:59:59.999Z"))).toBe(
      true
    );
    expect(fund_item_is_open(f, new Date("2027-10-02T12:00:00.000Z"))).toBe(
      false
    );
  });

  test("an inactive item is closed", () => {
    expect(fund_item_is_open({ active: false, expiration: oct_1 }, now)).toBe(
      false
    );
  });
});
