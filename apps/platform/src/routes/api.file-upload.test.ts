import { beforeEach, describe, expect, test, vi } from "vitest";

const put = vi.hoisted(() => vi.fn());
vi.mock("@vercel/blob", () => ({ put }));
vi.mock("#/.server/auth", () => ({
  get_session: async () => ({ user: { id: "u1" } }),
}));
vi.mock("$/env", () => ({ blob: { read_write_token: "tok" } }));

import { sources_of } from "#/__tests__/conformance/walk";
import { img_spec as funds_img_spec } from "#/pages/funds/common";
import { upload_limits } from "@/constants/upload";
import { fileSpec as fsa_spec } from "./_app.register.$reg_id._steps.3/fsa/types";
import { bannerSpec, logoSpec } from "./admin.$id.organization/schema";
import { img_spec as program_img_spec } from "./admin.$id.program-editor.$program_id/common";
import { action } from "./api.file-upload";
import { avatar_spec } from "./dashboard.edit-profile/use-rhf";

const upload = (body: Blob, filename = "photo.png") =>
  action({
    request: new Request(
      `https://bg.test/api/file-upload?filename=${filename}`,
      { method: "POST", body }
    ),
  } as any) as Promise<any>;

const bytes = (...xs: number[]) => new Uint8Array(xs);
const HTML = "<!doctype html><script>alert(1)</script>";

/** the smallest real opening of each accepted format */
const SIGNED: [string, string, BlobPart[]][] = [
  ["image/jpeg", "a.jpg", [bytes(0xff, 0xd8, 0xff, 0xe0)]],
  [
    "image/png",
    "a.png",
    [bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
  ],
  ["image/webp", "a.webp", ["RIFF", bytes(1, 2, 3, 4), "WEBPVP8 "]],
  ["application/pdf", "a.pdf", ["%PDF-1.7\n"]],
  [
    "image/svg+xml",
    "a.svg",
    [
      '\uFEFF <?xml version="1.0"?>\n<!-- logo -->\n<!DOCTYPE svg>\n<svg xmlns="http://www.w3.org/2000/svg"/>',
    ],
  ],
];

beforeEach(() => {
  put.mockReset();
  put.mockResolvedValue({ url: "https://blob.test/u/photo-abc.png" });
});

describe("file upload", () => {
  test("refuses a type no uploader accepts, storing nothing", async () => {
    const res: Response = await upload(
      new Blob(["<script>"], { type: "text/html" }),
      "page.html"
    );
    expect(res.status).toBe(415);
    expect(put).not.toHaveBeenCalled();
  });

  test.each(Object.keys(upload_limits.types))(
    "refuses a %s file past the cap, storing nothing",
    async (type) => {
      const res: Response = await upload(
        new Blob([new Uint8Array(upload_limits.max_bytes + 1)], { type }),
        "big"
      );
      expect(res.status).toBe(413);
      expect(put).not.toHaveBeenCalled();
    }
  );

  test("stores an accepted file under the type that was checked", async () => {
    const res = await upload(
      new Blob(["%PDF-1.7\n", new Uint8Array(4 * 1024 * 1024 - 9)], {
        type: "application/pdf",
      }),
      "statement.pdf"
    );
    expect(res.data).toEqual({ url: "https://blob.test/u/photo-abc.png" });
    const [path, , opts] = put.mock.calls[0]!;
    expect(path).toBe("u/statement.pdf");
    expect(opts).toMatchObject({ contentType: "application/pdf" });
  });

  test("types an untyped file by its extension when it is one we accept", async () => {
    await upload(new Blob(["%PDF-1.7"]), "statement.PDF");
    expect(put.mock.calls[0]![2]).toMatchObject({
      contentType: "application/pdf",
    });
  });

  test("refuses an untyped file whose extension we don't accept", async () => {
    const res: Response = await upload(new Blob(["<script>"]), "x.html");
    expect(res.status).toBe(415);
    expect(put).not.toHaveBeenCalled();
  });

  test.each(SIGNED)(
    "stores real %s bytes under that type",
    async (type, name, parts) => {
      const res = await upload(new Blob(parts, { type }), name);
      expect(res.data).toEqual({ url: "https://blob.test/u/photo-abc.png" });
      expect(put.mock.calls[0]![2]).toMatchObject({ contentType: type });
    }
  );

  test("refuses html bytes declared as an image", async () => {
    const res: Response = await upload(
      new Blob([HTML], { type: "image/png" }),
      "x.png"
    );
    expect(res.status).toBe(415);
    expect(put).not.toHaveBeenCalled();
  });

  test("refuses html bytes named as a pdf with no declared type", async () => {
    const res: Response = await upload(new Blob([HTML]), "x.pdf");
    expect(res.status).toBe(415);
    expect(put).not.toHaveBeenCalled();
  });

  test("refuses one accepted format declared as another", async () => {
    const res: Response = await upload(
      new Blob(["%PDF-1.7\n"], { type: "image/png" }),
      "x.png"
    );
    expect(res.status).toBe(415);
  });

  test("refuses png bytes labeled jpeg, the mismatch a re-encoded crop makes", async () => {
    const res: Response = await upload(
      new Blob([bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)], {
        type: "image/jpeg",
      }),
      "photo.jpg"
    );
    expect(res.status).toBe(415);
    expect(await res.text()).toBe("file content does not match its type");
    expect(put).not.toHaveBeenCalled();
  });

  test("refuses html that only mentions an svg", async () => {
    const res: Response = await upload(
      new Blob(["<html><svg/></html>"], { type: "image/svg+xml" }),
      "x.svg"
    );
    expect(res.status).toBe(415);
  });

  test("refuses a run of comments with no svg after them, quickly", async () => {
    const t0 = performance.now();
    const res: Response = await upload(
      new Blob(["<!-- x -->".repeat(1000)], { type: "image/svg+xml" }),
      "x.svg"
    );
    expect(res.status).toBe(415);
    expect(performance.now() - t0).toBeLessThan(100);
  });

  test("reads past a doctype carrying an internal subset", async () => {
    const svg =
      '<!DOCTYPE svg [<!ENTITY a "<b>">]><svg xmlns="http://www.w3.org/2000/svg"/>';
    const res = await upload(
      new Blob([svg], { type: "image/svg+xml" }),
      "a.svg"
    );
    expect(res.data).toEqual({ url: "https://blob.test/u/photo-abc.png" });
  });
});

describe("upload size limits", () => {
  // vercel functions refuse a request body over 4.5 MB before the route runs,
  // with no app message — every limit must sit under it
  const VERCEL_BODY_CAP = 4.5e6;

  test("the server cap fits under the platform's body cap", () => {
    expect(upload_limits.max_bytes).toBeLessThan(VERCEL_BODY_CAP);
  });

  test("the fsa dropzone's limit fits under the server cap", () => {
    expect(fsa_spec.mbLimit * 1e6).toBeLessThanOrEqual(upload_limits.max_bytes);
  });
});

describe("client upload limits", () => {
  test.each([
    ["funds img_spec", funds_img_spec([1, 1])],
    ["avatar_spec", avatar_spec],
    ["logoSpec", logoSpec],
    ["bannerSpec", bannerSpec],
    ["program img_spec", program_img_spec([1, 1])],
  ])("the %s image editor limit fits under the server cap", (_, spec) => {
    expect(spec.max_size).toBeGreaterThan(0);
    expect(spec.max_size!).toBeLessThanOrEqual(upload_limits.max_bytes);
  });

  // the recipient-details dropzone spec is inline in the form's JSX, so its
  // literal is read from source
  test("the recipient-details dropzone limit fits under the server cap", () => {
    const form = sources_of(import.meta.url).find((s) =>
      s.file.endsWith("recipient-details/recipient-details-form.tsx")
    );
    const limit = /mbLimit:\s*(\d+(?:\.\d+)?)/.exec(form?.text ?? "")?.[1];
    expect(limit).toBeDefined();
    expect(+limit! * 1e6).toBeLessThanOrEqual(upload_limits.max_bytes);
  });
});
