import { afterEach, describe, expect, test, vi } from "vitest";
import { MAX_EXPIRATION_ISO } from "@/campaign/schema";
import { status } from "./fund-status";

describe("fund status", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const oct_1 = "2027-10-01T00:00:00.000Z";
  const at = (iso: string) => new Date(iso);

  test("an open fund shows the end date its creator picked", () => {
    expect(status(oct_1, true, 0, at("2027-09-29T12:00:00.000Z"))).toEqual({
      active: true,
      text: "ends Oct 1",
    });
    expect(status(oct_1, true, 0, at("2027-09-30T23:59:59.999Z"))).toEqual({
      active: true,
      text: "ends Oct 1",
    });
  });

  test("the end date is the UTC calendar date of the stored expiration", () => {
    const late_oct_1 = "2027-10-01T23:59:59.999Z";
    expect(status(late_oct_1, true, 0, at("2027-09-29T12:00:00.000Z"))).toEqual(
      { active: true, text: "ends Oct 1" }
    );
  });

  test.each([
    "2027-10-01T00:00:00.000Z",
    "2027-10-01T15:00:00.000Z",
    "2027-10-01T23:59:59.999Z",
    "2027-10-02T11:59:59.999Z",
  ])("reads last day once the end date has begun, at %s", (now) => {
    expect(status(oct_1, true, 0, at(now))).toEqual({
      active: true,
      text: "last day",
    });
  });

  test("has expired once its end date has ended everywhere", () => {
    const closing = at("2027-10-02T12:00:00.000Z");
    expect(status(oct_1, true, 0, closing)).toEqual({
      active: false,
      text: "expired",
    });
    expect(status(oct_1, true, 500, closing)).toEqual({
      active: false,
      text: "completed",
    });
  });

  test("names the year only when the end date is in another year", () => {
    expect(
      status(
        "2028-01-15T00:00:00.000Z",
        true,
        0,
        at("2027-12-20T00:00:00.000Z")
      )
    ).toEqual({ active: true, text: "ends Jan 15, 2028" });
  });

  test.each([
    ["no expiration", undefined],
    ["the stored sentinel", MAX_EXPIRATION_ISO],
    [
      "the sentinel round-tripped through unix time",
      "9999-12-31T23:59:59.000Z",
    ],
  ])("has no end-date text for %s", (_, expiry) => {
    expect(status(expiry, true, 0, at("2027-09-29T12:00:00.000Z"))).toEqual({
      active: true,
    });
  });

  test("an inactive fund is closed whatever its end date", () => {
    expect(status(oct_1, false, 0, at("2027-09-29T12:00:00.000Z"))).toEqual({
      active: false,
      text: "closed",
    });
  });

  test("reads the time it is given, not the clock", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("2031-01-01T00:00:00.000Z"));
    expect(status(oct_1, true, 0, at("2027-09-29T12:00:00.000Z"))).toEqual({
      active: true,
      text: "ends Oct 1",
    });
  });
});
