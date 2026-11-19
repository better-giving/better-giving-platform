import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BlobNotFoundError, head, put } from "@vercel/blob";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { upload_client_assets } from "../../utils/upload-client-assets";

vi.mock("@vercel/blob", () => ({
  BlobNotFoundError: class BlobNotFoundError extends Error {},
  head: vi.fn(),
  put: vi.fn(),
}));

const ENV = {
  ASSETS_S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  ASSETS_S3_BUCKET: "bg-platform-assets",
  ASSETS_S3_ACCESS_KEY_ID: "id",
  ASSETS_S3_SECRET_ACCESS_KEY: "secret",
};
const BASE = "https://assets.better.giving/";
const BLOB_BASE = "https://abc123.public.blob.vercel-storage.com/";

let dir: string;
const fetch_mock = vi.fn<(req: Request | string) => Promise<Response>>();

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "assets-"));
  await mkdir(path.join(dir, "sub"));
  vi.stubGlobal("fetch", fetch_mock);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  vi.unstubAllGlobals();
  fetch_mock.mockReset();
  await rm(dir, { recursive: true, force: true });
});

const res = (status: number) => new Response(null, { status });
const req_at = (i: number) => fetch_mock.mock.calls[i][0] as Request;
const served = (body: string, type: string) =>
  new Response(body, { status: 200, headers: { "content-type": type } });

// signed s3 calls arrive as Requests; the probe is a plain string url
function serve(o: {
  head?: number;
  put?: number;
  get: (url: string) => Response;
}) {
  fetch_mock.mockImplementation(async (req) => {
    if (typeof req === "string") return o.get(req);
    if (req.method === "HEAD") return res(o.head ?? 200);
    return res(o.put ?? 200);
  });
}

describe("r2", () => {
  test("an existing object is skipped", async () => {
    await writeFile(path.join(dir, "a-1.js"), "x");
    serve({ get: () => served("x", "text/javascript") });
    await upload_client_assets(BASE, { dir, env: ENV, probe_delay_ms: 0 });
    expect(fetch_mock).toHaveBeenCalledTimes(2);
    expect(req_at(0).method).toBe("HEAD");
    expect(req_at(0).url).toBe(
      "https://acct.r2.cloudflarestorage.com/bg-platform-assets/assets/a-1.js"
    );
  });

  test("a missing object is PUT with type and cache headers; maps are skipped", async () => {
    await writeFile(path.join(dir, "sub", "a-1.css"), "x");
    await writeFile(path.join(dir, "a-1.js.map"), "x");
    serve({ head: 404, get: () => served("x", "text/css") });
    await upload_client_assets(BASE, { dir, env: ENV, probe_delay_ms: 0 });
    const methods = fetch_mock.mock.calls.map(([r]) =>
      typeof r === "string" ? "GET" : r.method
    );
    expect(methods).toEqual(["HEAD", "PUT", "GET"]);
    const put_req = req_at(1);
    expect(put_req.url).toContain("/assets/sub/a-1.css");
    expect(put_req.headers.get("content-type")).toBe("text/css");
    expect(put_req.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable"
    );
  });

  test("a failed PUT throws", async () => {
    await writeFile(path.join(dir, "a-1.js"), "x");
    serve({ head: 404, put: 403, get: () => res(500) });
    await expect(upload_client_assets(BASE, { dir, env: ENV })).rejects.toThrow(
      /PUT assets\/a-1\.js answered 403/
    );
  });

  test("a HEAD error other than 404 throws", async () => {
    await writeFile(path.join(dir, "a-1.js"), "x");
    fetch_mock.mockResolvedValue(res(403));
    await expect(upload_client_assets(BASE, { dir, env: ENV })).rejects.toThrow(
      /HEAD assets\/a-1\.js answered 403/
    );
  });

  describe("probe through the base url", () => {
    const opts = { dir: "", env: ENV, probe_delay_ms: 0 };

    test("passes on 200 with matching bytes, preferring entry.client", async () => {
      await writeFile(path.join(dir, "a-1.js"), "other");
      await writeFile(path.join(dir, "entry.client-9f.js"), "boot");
      const urls: string[] = [];
      serve({
        get: (url) => {
          urls.push(url);
          return served("boot", "text/javascript; charset=utf-8");
        },
      });
      await upload_client_assets(BASE, { ...opts, dir });
      expect(urls).toEqual([`${BASE}assets/entry.client-9f.js`]);
    });

    test("throws after 5 tries on 404, naming base, status and bucket", async () => {
      await writeFile(path.join(dir, "a-1.js"), "x");
      serve({ get: () => res(404) });
      await expect(
        upload_client_assets(BASE, { ...opts, dir })
      ).rejects.toThrow(
        /https:\/\/assets\.better\.giving\/.*"bg-platform-assets".*status 404.*5 tries/
      );
      expect(
        fetch_mock.mock.calls.filter(([r]) => typeof r === "string")
      ).toHaveLength(5);
    });

    test("throws on a byte mismatch", async () => {
      await writeFile(path.join(dir, "a-1.js"), "x");
      serve({ get: () => served("not x", "text/javascript") });
      await expect(
        upload_client_assets(BASE, { ...opts, dir })
      ).rejects.toThrow(/bytes differ/);
    });

    test("throws on a content-type mismatch", async () => {
      await writeFile(path.join(dir, "a-1.js"), "x");
      serve({ get: () => served("x", "application/octet-stream") });
      await expect(
        upload_client_assets(BASE, { ...opts, dir })
      ).rejects.toThrow(/content-type "application\/octet-stream"/);
    });
  });

  test("an unknown extension throws before any request", async () => {
    await writeFile(path.join(dir, "a-1.xyz"), "x");
    await expect(upload_client_assets(BASE, { dir, env: ENV })).rejects.toThrow(
      /no Content-Type/
    );
    expect(fetch_mock).not.toHaveBeenCalled();
  });
});

describe("backend choice", () => {
  test("an r2 base with a partial env throws naming the missing vars", async () => {
    const {
      ASSETS_S3_BUCKET: _b,
      ASSETS_S3_SECRET_ACCESS_KEY: _s,
      ...part
    } = ENV;
    await expect(
      upload_client_assets(BASE, { dir, env: part })
    ).rejects.toThrow(/ASSETS_S3_BUCKET, ASSETS_S3_SECRET_ACCESS_KEY/);
  });

  test("an r2 base with no S3 env throws", async () => {
    await expect(upload_client_assets(BASE, { dir, env: {} })).rejects.toThrow(
      /missing ASSETS_S3_ENDPOINT/
    );
  });

  test("a blob base with no S3 env uses blob", async () => {
    await writeFile(path.join(dir, "a-1.xyz"), "x");
    vi.mocked(head).mockRejectedValue(new BlobNotFoundError());
    await upload_client_assets(BLOB_BASE, { dir, env: {} });
    expect(head).toHaveBeenCalledWith(`${BLOB_BASE}assets/a-1.xyz`);
    expect(put).toHaveBeenCalledTimes(1);
    expect(fetch_mock).not.toHaveBeenCalled();
  });

  test("a blob base with the full S3 env still uses blob and says so", async () => {
    await writeFile(path.join(dir, "a-1.js"), "x");
    vi.mocked(head).mockResolvedValue({} as never);
    await upload_client_assets(BLOB_BASE, { dir, env: ENV });
    expect(head).toHaveBeenCalledTimes(1);
    expect(fetch_mock).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("ASSETS_S3_* ignored")
    );
  });
});
