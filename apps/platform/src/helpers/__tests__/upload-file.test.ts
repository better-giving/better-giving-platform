import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { upload_document, uploadFile } from "../upload-file";

const sent = vi.fn<typeof fetch>();

beforeEach(() => {
  // the helper reaches for `window`, which a node run doesn't have
  vi.stubGlobal("window", globalThis);
  sent
    .mockReset()
    .mockImplementation(async () =>
      Response.json({ url: "https://store.example/stored.pdf" })
    );
  vi.stubGlobal("fetch", sent);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const request = () => {
  const [input, init] = sent.mock.calls[0]!;
  return { url: new URL(String(input), "https://bg.test"), init };
};

describe("uploadFile", () => {
  test.each(["document", "image"] as const)(
    "posts the file to the %s upload, named by its filename",
    async (kind) => {
      const file = new File(["bytes"], "bank & statement #1.pdf");
      const url = await uploadFile(file, kind);

      const { url: target, init } = request();
      expect(target.pathname).toBe("/api/file-upload");
      expect(target.searchParams.get("kind")).toBe(kind);
      expect(target.searchParams.get("filename")).toBe(
        "bank & statement #1.pdf"
      );
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(file);
      expect(url).toBe("https://store.example/stored.pdf");
    }
  );

  test("throws the response when the server refuses the file", async () => {
    const refusal = new Response("nope", { status: 415 });
    sent.mockResolvedValue(refusal);
    await expect(uploadFile(new File(["x"], "a.svg"), "document")).rejects.toBe(
      refusal
    );
  });
});

describe("upload_document", () => {
  test("is an upload of kind document", async () => {
    await upload_document(new File(["x"], "id.pdf"));
    expect(request().url.searchParams.get("kind")).toBe("document");
  });
});
