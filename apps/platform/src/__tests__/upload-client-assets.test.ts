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
const fetch_mock = vi.fn<(req: Request) => Promise<Response>>();

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

describe("r2", () => {
  test("an existing object is skipped", async () => {
    await writeFile(path.join(dir, "a-1.js"), "x");
    fetch_mock.mockResolvedValue(res(200));
    await upload_client_assets(BASE, { dir, env: ENV });
    expect(fetch_mock).toHaveBeenCalledTimes(1);
    expect(fetch_mock.mock.calls[0][0].method).toBe("HEAD");
    expect(fetch_mock.mock.calls[0][0].url).toBe(
      "https://acct.r2.cloudflarestorage.com/bg-platform-assets/assets/a-1.js"
    );
  });

  test("a missing object is PUT with type and cache headers; maps are skipped", async () => {
    await writeFile(path.join(dir, "sub", "a-1.css"), "x");
    await writeFile(path.join(dir, "a-1.js.map"), "x");
    fetch_mock.mockImplementation(async (req) =>
      res(req.method === "HEAD" ? 404 : 200)
    );
    await upload_client_assets(BASE, { dir, env: ENV });
    const methods = fetch_mock.mock.calls.map(([r]) => r.method);
    expect(methods).toEqual(["HEAD", "PUT"]);
    const put_req = fetch_mock.mock.calls[1][0];
    expect(put_req.url).toContain("/assets/sub/a-1.css");
    expect(put_req.headers.get("content-type")).toBe("text/css");
    expect(put_req.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable"
    );
  });

  test("a HEAD error other than 404 throws", async () => {
    await writeFile(path.join(dir, "a-1.js"), "x");
    fetch_mock.mockResolvedValue(res(403));
    await expect(upload_client_assets(BASE, { dir, env: ENV })).rejects.toThrow(
      /HEAD assets\/a-1\.js answered 403/
    );
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
