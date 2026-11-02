import { describe, expect, test, vi } from "vitest";

vi.mock("$/pg/queries/fund", () => ({
  fund_delete: vi.fn(),
  funds_list: vi.fn(async () => ({
    items: [
      {
        id: "f1",
        name: "One",
        creator_id: "u-named",
        created_at: "2026-10-01",
      },
      { id: "f2", name: "Two", creator_id: "u-gone", created_at: "2026-09-01" },
    ],
    next: "cursor",
  })),
}));
const names_mock = vi.hoisted(() =>
  vi.fn(async (_ids: string[]) => new Map([["u-named", "Ann"]]))
);
vi.mock("$/pg/queries/user", () => ({ user_names_by_ids: names_mock }));

import { loader } from "./api";

describe("campaign moderation loader", () => {
  test("names each campaign's creator, and keeps the id for one it cannot name", async () => {
    const page = await loader({
      // loaders take the parsed `url` (react-router v8 future flag), not `request`
      url: new URL("https://x.test/platform/campaign-moderation"),
    } as any);

    expect(names_mock).toHaveBeenCalledWith(["u-named", "u-gone"]);
    expect(page.next).toBe("cursor");
    expect(page.items.map((i) => [i.creator_id, i.creator_name])).toEqual([
      ["u-named", "Ann"],
      ["u-gone", null],
    ]);
  });
});
