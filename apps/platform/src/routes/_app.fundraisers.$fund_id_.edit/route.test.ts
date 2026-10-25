import { describe, expect, it } from "vitest";
import { loader } from "./route";

const location = (r: Response) => [
  r.status,
  r.headers.get("location"),
  r.headers.get("cache-control"),
];
const MOVED = "public, max-age=3600, s-maxage=86400";
const call = (path: string, fund_id: string) =>
  loader({
    params: { fund_id },
    request: new Request(`https://x${path}`),
  } as never);

describe("old /fundraisers/:fund_id/edit url", () => {
  it("301s to /campaigns/:fund_id/edit, keeping the id and query", async () => {
    expect(
      location(await call("/fundraisers/fund-live/edit", "fund-live"))
    ).toEqual([301, "/campaigns/fund-live/edit", MOVED]);
    expect(
      location(await call("/fundraisers/fund-live/edit?tab=2", "fund-live"))
    ).toEqual([301, "/campaigns/fund-live/edit?tab=2", MOVED]);
  });
});
