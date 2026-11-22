import { describe, expect, it } from "vitest";
import {
  filter_chips,
  type IChip,
  is_default_filter,
  method_name,
  method_param,
  parse_method,
  parse_status,
  status_name,
  status_param,
  without_method,
  without_status,
} from "./constants";

const ALL_STATUS = "settled,awaiting,unpaid,refunded,failed,closed".split(
  ","
) as never;

describe("parse_status", () => {
  it("falls back to settled for nothing, empty or unknown", () => {
    expect(parse_status(null)).toEqual(["settled"]);
    expect(parse_status("")).toEqual(["settled"]);
    expect(parse_status(",,")).toEqual(["settled"]);
    expect(parse_status("bogus,nope")).toEqual(["settled"]);
  });

  it("trims, lowercases, drops unknowns, de-duplicates and orders", () => {
    expect(parse_status(" Failed , awaiting,failed,bogus ")).toEqual([
      "awaiting",
      "failed",
    ]);
  });

  it("reads all as every status", () => {
    expect(parse_status("all")).toEqual(ALL_STATUS);
    expect(parse_status("settled,ALL")).toEqual(ALL_STATUS);
  });

  it("keeps the single values of the earlier urls", () => {
    expect(parse_status("closed")).toEqual(["closed"]);
  });
});

describe("parse_method", () => {
  it("is no filter for nothing, empty, all or unknown", () => {
    expect(parse_method(null)).toEqual([]);
    expect(parse_method("")).toEqual([]);
    expect(parse_method("all")).toEqual([]);
    expect(parse_method("stripe,all")).toEqual([]);
    expect(parse_method("bogus")).toEqual([]);
  });

  it("is no filter when every method is named", () => {
    expect(parse_method("other,match,stocks,crypto,daf,paypal,stripe")).toEqual(
      []
    );
  });

  it("orders and de-duplicates", () => {
    expect(parse_method("crypto, Stripe,crypto,x")).toEqual([
      "stripe",
      "crypto",
    ]);
  });
});

describe("params", () => {
  it("omits the defaults", () => {
    expect(status_param(["settled"])).toBeNull();
    expect(method_param([])).toBeNull();
    expect(is_default_filter(["settled"], [])).toBe(true);
  });

  it("writes lists, and all for every status", () => {
    expect(status_param(["awaiting", "failed"])).toBe("awaiting,failed");
    expect(status_param(ALL_STATUS)).toBe("all");
    expect(method_param(["stripe", "crypto"])).toBe("stripe,crypto");
    expect(is_default_filter(["failed"], [])).toBe(false);
    expect(is_default_filter(["settled"], ["match"])).toBe(false);
  });

  it("round-trips a parsed value", () => {
    const raw = status_param(parse_status("failed,awaiting"));
    expect(parse_status(raw)).toEqual(["awaiting", "failed"]);
  });
});

describe("labels", () => {
  it("names the funnel by its value", () => {
    expect(status_name(["settled"])).toBe("Status filter: Settled");
    expect(status_name(["awaiting", "failed"])).toBe(
      "Status filter: Awaiting funds, Failed"
    );
    expect(status_name(["settled", "awaiting", "failed"])).toBe(
      "Status filter: 3 selected"
    );
    expect(method_name([])).toBe("Method filter: All methods");
    expect(method_name(["crypto"])).toBe("Method filter: Crypto");
  });
});

const labels = (c: IChip[]) => c.map((x) => `${x.prefix ?? ""}${x.label}`);

describe("filter_chips", () => {
  it("has none on the defaults", () => {
    expect(filter_chips(["settled"], [])).toEqual([]);
  });

  it("prefixes the first chip of each group", () => {
    expect(filter_chips(["awaiting", "failed"], ["crypto"])).toEqual([
      {
        group: "status",
        value: "awaiting",
        label: "Awaiting funds",
        prefix: "Status:",
        name: "Awaiting funds",
      },
      {
        group: "status",
        value: "failed",
        label: "Failed",
        prefix: undefined,
        name: "Failed",
      },
      {
        group: "method",
        value: "crypto",
        label: "Crypto",
        prefix: "Method:",
        name: "Crypto",
      },
    ]);
  });

  it("gives Settled a chip once Status is off its default", () => {
    expect(labels(filter_chips(["settled", "failed"], []))).toEqual([
      "Status:Settled",
      "Failed",
    ]);
  });

  it("is one All statuses chip for every status", () => {
    const [chip, ...rest] = filter_chips(ALL_STATUS, []);
    expect(rest).toEqual([]);
    expect(chip).toMatchObject({
      value: null,
      label: "All statuses",
      name: "Status: All statuses",
    });
  });

  it("shows a Method chip per value and none for no filter", () => {
    expect(labels(filter_chips(["settled"], ["stripe", "crypto"]))).toEqual([
      "Method:Stripe",
      "Crypto",
    ]);
  });

  it("collapses four or more values in a group", () => {
    const four = ["settled", "awaiting", "unpaid", "failed"] as never;
    const [s] = filter_chips(four, []);
    expect(s).toMatchObject({
      value: null,
      label: "4 selected",
      name: "Status: 4 selected",
    });
    expect(
      filter_chips(["settled"], ["stripe", "paypal", "daf", "crypto"])
    ).toHaveLength(1);
    // three still show by name
    expect(filter_chips(["settled"], ["stripe", "paypal", "daf"])).toHaveLength(
      3
    );
  });
});

describe("removal", () => {
  it("drops one value", () => {
    expect(without_status(["awaiting", "failed"], "awaiting")).toEqual([
      "failed",
    ]);
    expect(without_method(["stripe", "crypto"], "stripe")).toEqual(["crypto"]);
  });

  it("snaps the last status back to Settled and the last method to none", () => {
    expect(without_status(["failed"], "failed")).toEqual(["settled"]);
    expect(without_method(["crypto"], "crypto")).toEqual([]);
  });

  it("resets a group from a collapsed or All chip", () => {
    expect(without_status(ALL_STATUS, null)).toEqual(["settled"]);
    expect(without_method(["stripe", "paypal", "daf", "crypto"], null)).toEqual(
      []
    );
  });
});
