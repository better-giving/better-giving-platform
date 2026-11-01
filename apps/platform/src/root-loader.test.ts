import { describe, expect, it, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";

vi.mock("#/.server/toast", () => ({ getToast: vi.fn() }));

import { reg_cookie } from "#/.server/cookie";
import { loader } from "#/root-loader";

// chromium forbids setting `cookie` on a real Request, so hand the loader the
// two members it reads
const req = (url: string, cookie?: string) =>
  ({
    url,
    headers: new Headers(cookie ? [["cookie", cookie]] : []),
  }) as unknown as Request;

/** set-cookie values a loader result carries */
const set_cookies = (res: any): string[] =>
  new Headers(res?.init?.headers ?? undefined).getSetCookie();

describe("referral attribution cookie", () => {
  it("stores ?referrer for a first-time visitor with no cookies", async () => {
    const res = await loader({
      ...doc_args(req("https://bg.test/register/welcome?referrer=ABC123")),
    } as any);

    const [set_cookie] = set_cookies(res);
    expect(set_cookie).toBeTruthy();
    const rc = await reg_cookie.parse(set_cookie!);
    expect(rc.referrer).toBe("ABC123");
  });

  it("keeps the first unexpired referrer when a second link is clicked", async () => {
    const held = await reg_cookie.serialize({
      referrer: "FIRST",
      referrer_expiry: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const res = await loader({
      ...doc_args(
        req("https://bg.test/register/welcome?referrer=SECOND", held)
      ),
    } as any);

    expect(set_cookies(res)).toHaveLength(0);
  });
});
