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

describe("old /fundraisers url", () => {
  it("301s to /campaigns, keeping the query", async () => {
    expect(location(await call("/fundraisers"))).toEqual([
      301,
      "/campaigns",
      MOVED,
    ]);
    expect(location(await call("/fundraisers?page=2"))).toEqual([
      301,
      "/campaigns?page=2",
      MOVED,
    ]);
  });
});
