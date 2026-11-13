import { beforeEach, describe, expect, test, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";

const put = vi.hoisted(() => vi.fn());
vi.mock("@vercel/blob", () => ({ put }));
vi.mock("#/.server/auth", () => ({
  get_session: async () => ({ user: { id: "u1" } }),
}));
vi.mock("$/env", () => ({
  blob: { read_write_token: "tok" },
  blob_private: { read_write_token: "priv-tok" },
}));

import { action } from "./api.file-upload";

const upload = (body: Blob, filename: string, kind?: string) =>
  action({
    ...doc_args(
      new Request(
        `https://bg.test/api/file-upload?${kind ? `kind=${kind}&` : ""}filename=${filename}`,
        { method: "POST", body }
      )
    ),
  } as any) as Promise<any>;

const PDF = () => new Blob(["%PDF-1.7\n"], { type: "application/pdf" });
const PNG = () =>
  new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], {
    type: "image/png",
  });
const SVG = () =>
  new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], {
    type: "image/svg+xml",
  });

beforeEach(() => {
  put.mockReset();
  put.mockResolvedValue({ url: "https://blob.test/stored" });
});

describe("upload kinds", () => {
  test("a document is stored privately, random-suffixed and never overwriting", async () => {
    const res = await upload(PDF(), "id.pdf", "document");
    expect(res.data).toEqual({ url: "https://blob.test/stored" });
    const [path, , opts] = put.mock.calls[0]!;
    expect(path).toBe("docs/u1/id.pdf");
    expect(opts).toMatchObject({
      access: "private",
      addRandomSuffix: true,
      allowOverwrite: false,
      token: "priv-tok",
    });
  });

  test("a photo of a document is a document too", async () => {
    await upload(PNG(), "id.png", "document");
    expect(put.mock.calls[0]![2]).toMatchObject({ access: "private" });
  });

  test("a document takes no svg", async () => {
    const res: Response = await upload(SVG(), "x.svg", "document");
    expect(res.status).toBe(415);
    expect(put).not.toHaveBeenCalled();
  });

  test("an image is stored publicly under the upload prefix", async () => {
    await upload(PNG(), "logo.png", "image");
    const [path, , opts] = put.mock.calls[0]!;
    expect(path).toBe("u/logo.png");
    expect(opts).toMatchObject({ access: "public", token: "tok" });
  });

  test("an image upload takes no pdf, so a document can't go down the public path", async () => {
    const res: Response = await upload(PDF(), "id.pdf", "image");
    expect(res.status).toBe(415);
    expect(put).not.toHaveBeenCalled();
  });

  test.each<[string | undefined, string]>([
    [undefined, "missing"],
    ["public", "unknown"],
  ])(
    "refuses an upload whose kind is %s (%s), storing nothing",
    async (kind) => {
      const res: Response = await upload(PDF(), "id.pdf", kind);
      expect(res.status).toBe(400);
      expect(put).not.toHaveBeenCalled();
    }
  );

  test("a document still has its bytes checked against its type", async () => {
    const res: Response = await upload(
      new Blob(["<html></html>"], { type: "application/pdf" }),
      "id.pdf",
      "document"
    );
    expect(res.status).toBe(415);
    expect(put).not.toHaveBeenCalled();
  });
});
