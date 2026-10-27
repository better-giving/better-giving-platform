import { safeParse } from "valibot";
import { afterEach, describe, expect, it, vi } from "vitest";
import { npos_search } from "@/npo/schema";
import { fetch_endows } from "./endowment-selector";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fund member search", () => {
  it("asks for each org's logo and shows it, falling back to its card image", async () => {
    const fetch_spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        page: 1,
        pages: 1,
        items: [
          { id: 1, name: "Has logo", logo: "l.png", card_img: "c.png" },
          { id: 2, name: "Card only", logo: null, card_img: "c2.png" },
          { id: 3, name: "Neither", logo: null, card_img: null },
        ],
      })
    );

    const opts = await fetch_endows("", new AbortController().signal);

    const url = new URL(String(fetch_spy.mock.calls[0][0]), "http://x");
    expect(url.searchParams.get("fields")?.split(",")).toContain("logo");
    // /api/npos answers a field outside its picklist with a 400
    expect(
      safeParse(npos_search, Object.fromEntries(url.searchParams)).issues
    ).toBeUndefined();
    expect(opts).toEqual([
      { id: 1, name: "Has logo", logo: "l.png" },
      { id: 2, name: "Card only", logo: "c2.png" },
      { id: 3, name: "Neither", logo: undefined },
    ]);
  });
});
