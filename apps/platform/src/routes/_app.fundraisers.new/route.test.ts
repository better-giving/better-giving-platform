import { describe, expect, it } from "vitest";
import { loader } from "./route";

const location = (r: Response) => [
  r.status,
  r.headers.get("location"),
  r.headers.get("cache-control"),
];
const MOVED = "public, max-age=3600, s-maxage=86400";
const call = (path: string) =>
  loader({ request: new Request(`https://x${path}`) } as never);

describe("old /fundraisers/new url", () => {
  it("301s to /campaigns/new, keeping the query", async () => {
    expect(location(await call("/fundraisers/new"))).toEqual([
      301,
      "/campaigns/new",
      MOVED,
    ]);
    expect(location(await call("/fundraisers/new?npo=9"))).toEqual([
      301,
      "/campaigns/new?npo=9",
      MOVED,
    ]);
  });
});
