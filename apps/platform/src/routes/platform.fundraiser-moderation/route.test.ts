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

describe("old /platform/fundraiser-moderation url", () => {
  it("301s to /platform/campaign-moderation, keeping the query", async () => {
    expect(location(await call("/platform/fundraiser-moderation"))).toEqual([
      301,
      "/platform/campaign-moderation",
      MOVED,
    ]);
    expect(
      location(await call("/platform/fundraiser-moderation?page=2"))
    ).toEqual([301, "/platform/campaign-moderation?page=2", MOVED]);
  });
});
