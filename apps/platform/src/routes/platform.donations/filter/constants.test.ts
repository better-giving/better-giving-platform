import { describe, expect, it } from "vitest";
import {
  is_default_filter,
  method_chip,
  method_name,
  method_param,
  method_summary,
  parse_method,
  parse_status,
  status_chip,
  status_name,
  status_param,
  status_summary,
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
  it("lists one or two by name and collapses three or more", () => {
    expect(status_summary(["awaiting", "failed"])).toBe(
      "Awaiting funds, Failed"
    );
    expect(status_summary(["settled", "awaiting", "failed"])).toBe(
      "3 statuses"
    );
    expect(status_summary(ALL_STATUS)).toBe("All statuses");
    expect(method_summary([])).toBe("All methods");
    expect(method_summary(["stripe", "crypto", "daf"])).toBe("3 methods");
  });

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

  it("shows a chip value by name, a count, or All", () => {
    expect(status_chip(["settled"])).toBe("Settled");
    expect(status_chip(["awaiting", "failed"])).toBe("2");
    expect(status_chip(ALL_STATUS)).toBe("All");
    expect(method_chip([])).toBe("All");
    expect(method_chip(["crypto"])).toBe("Crypto");
    expect(method_chip(["crypto", "stripe"])).toBe("2");
  });
});
