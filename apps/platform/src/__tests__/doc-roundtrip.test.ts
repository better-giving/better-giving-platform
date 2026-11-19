import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";

const session = vi.hoisted(() => ({ id: "u-up" }));
vi.mock("#/.server/auth", () => ({
  get_session: async () => ({ user: { id: session.id } }),
}));
// the one db read `can_read_doc` makes: no record holds the document yet
vi.mock("$/pg/queries/doc-holders", () => ({
  doc_holders: async () => ({ reg_owners: [], npo_ids: [] }),
  is_npo_member: async () => false,
}));

import { action } from "#/routes/api.file-upload";
import { can_read_doc, doc_source, may_store_doc } from "$/doc-access";

/** the part of Vercel's blob api `put` talks to, served locally (the sdk reads
 * `VERCEL_BLOB_API_URL`): it answers with the url of the stored object, on the
 * host of the store the bearer token belongs to (`vercel_blob_rw_<store
 * id>_<secret>`), private or public as the request asked, at the pathname the
 * request gave plus a random suffix */
const puts: string[] = [];
const vercel_blob_api = createServer((req, res) => {
  const headers = new Headers(req.headers as Record<string, string>);
  const store = headers.get("authorization")?.split("_")[3]?.toLowerCase();
  const access = headers.get("x-vercel-blob-access");
  const pathname = new URL(req.url!, "http://x").searchParams.get("pathname")!;
  puts.push(`${access} ${pathname}`);
  const stored = pathname.replace(/(\.[^.]+)$/, "-RANDOM$1");
  const url = `https://${store}.${access}.blob.vercel-storage.com/${stored}`;
  req.resume();
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        url,
        downloadUrl: `${url}?download=1`,
        pathname: stored,
        contentType: headers.get("x-content-type"),
        contentDisposition: "inline",
        etag: "etag",
      })
    );
  });
});

beforeAll(async () => {
  await new Promise<void>((ok) => vercel_blob_api.listen(0, "127.0.0.1", ok));
  const { port } = vercel_blob_api.address() as AddressInfo;
  vi.stubEnv("VERCEL_BLOB_API_URL", `http://127.0.0.1:${port}`);
});
afterAll(() => {
  vi.unstubAllEnvs();
  vercel_blob_api.close();
});
beforeEach(() => {
  session.id = "u-up";
  puts.length = 0;
});

const upload = async (
  kind: "document" | "image",
  body: BlobPart,
  name: string
) => {
  const res = await action({
    ...doc_args(
      new Request(
        `https://bg.test/api/file-upload?kind=${kind}&filename=${name}`,
        {
          method: "POST",
          body: new Blob([body]),
        }
      )
    ),
  } as any);
  return (res as any).data.url as string;
};

describe("a document the upload route stored", () => {
  test("is read back as a private document of its uploader", async () => {
    const url = await upload("document", "%PDF-1.7\n", "statement.pdf");

    // the route really went to the api, on the private store
    expect(puts).toEqual(["private docs/u-up/statement.pdf"]);
    const src = doc_source(url);
    expect(src?.source).toBe("private");
    expect(src?.path).toMatch(/^docs\/u-up\/statement-RANDOM\.pdf$/);
  });

  test("opens for its uploader and no one else, before any record holds it", async () => {
    const url = await upload("document", "%PDF-1.7\n", "statement.pdf");
    const { path } = doc_source(url)!;

    expect(
      await can_read_doc({ id: "u-up", email: "up@example.com" }, url, path)
    ).toBe(true);
    expect(
      await can_read_doc({ id: "u-other", email: "o@example.com" }, url, path)
    ).toBe(false);
  });

  test("may be saved on a record by its uploader and no one else", async () => {
    const url = await upload("document", "%PDF-1.7\n", "statement.pdf");

    expect(may_store_doc("u-up", url, null)).toBe(true);
    expect(may_store_doc("u-other", url, null)).toBe(false);
  });
});

describe("an image the upload route stored", () => {
  test("is not a private document, so no one can save it as one", async () => {
    const url = await upload(
      "image",
      Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      "logo.png"
    );

    expect(url).toContain(".public.blob.");
    expect(doc_source(url)?.source).not.toBe("private");
    expect(may_store_doc("u-up", url, null)).toBe(false);
  });
});
