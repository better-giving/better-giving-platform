import { describe, expect, test, vi } from "vitest";

// every registered route module is imported at server boot, and
// [openapi.json] imports the spec: a schema the converter can't express must
// fail that one route, not the server
vi.mock("./wire-schema", () => ({
  wire_schema: () => {
    throw new Error("unexpressible action");
  },
}));

describe("openapi document", () => {
  test("a converter failure fails the build of the document, not module load", async () => {
    const spec = await import("./spec");

    expect(() => spec.openapi_doc("https://better.giving")).toThrow(
      "unexpressible action"
    );
  });
});
