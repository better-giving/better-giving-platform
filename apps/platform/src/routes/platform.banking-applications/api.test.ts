import { describe, expect, it, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";

const row = (id: string, npo_id: number, account_holder: string | null) => ({
  id,
  npo_id,
  status: "under-review",
  account_holder,
});

vi.mock("$/pg/queries/banking", () => ({
  bapps_by_status: async () => ({
    items: [
      row("1", 7, "Harbor Light Food Pantry Inc."),
      row("2", 8, "Dana Whitfield"),
      row("3", 8, null),
    ],
  }),
  npo_legal_names: async () =>
    new Map([
      [7, "Harbor Light Food Pantry"],
      [8, "Riverbend Youth Coding Collective Inc."],
    ]),
}));
vi.mock("$/pg/queries/npo", () => ({ npos_batch_get: async () => [] }));

import { loader } from "./api";

describe("banking applications list loader", () => {
  it("carries each row's holder and whether it matches the nonprofit's legal name", async () => {
    const page = await (loader as any)(
      doc_args(new Request("http://x/platform/banking-applications"))
    );

    expect(
      page.items.map((r: any) => [r.id, r.account_holder, r.holder_match])
    ).toEqual([
      ["1", "Harbor Light Food Pantry Inc.", "match"],
      ["2", "Dana Whitfield", "mismatch"],
      ["3", null, "unknown"],
    ]);
  });
});
