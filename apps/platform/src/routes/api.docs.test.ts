import { beforeEach, describe, expect, test, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";

const session = vi.hoisted(() => ({
  user: null as { id: string; email: string; role?: string } | null,
}));
const read_doc = vi.hoisted(() => vi.fn());
const holders = vi.hoisted(() => ({
  doc_holders: vi.fn(),
  is_npo_member: vi.fn(),
}));

vi.mock("#/.server/auth", async () => {
  const { redirect } = await import("react-router");
  return {
    get_session: async () => ({ user: session.user ?? undefined }),
    to_auth: () => redirect("/signup"),
  };
});
vi.mock("$/blob-upload", () => ({ DOC_PREFIX: "docs/", read_doc }));
vi.mock("$/pg/queries/doc-holders", () => holders);

import { doc_href } from "@/docs";
import { loader } from "./api.docs";

const OWNER = { id: "u-owner", email: "owner@example.com" };
const STAFF = { id: "u-staff", email: "staff@example.com", role: "admin" };
const OTHER = { id: "u-other", email: "other@example.com" };
const MEMBER = { id: "u-member", email: "member@example.com" };

const PRIVATE =
  "https://store1.private.blob.vercel-storage.com/docs/u-x/id-abc.pdf";
const LEGACY =
  "https://store1.public.blob.vercel-storage.com/u/statement-abc.pdf";

/** the records that name a document: a registration owned by OWNER, and a
 * banking application of nonprofit 7 */
const hold = (ref: string, by: "reg" | "bank" | "none") =>
  holders.doc_holders.mockImplementation(async (r: string) => ({
    reg_owners: by === "reg" && r === ref ? [OWNER.email] : [],
    npo_ids: by === "bank" && r === ref ? [7] : [],
  }));

const open = (ref: string | null) =>
  loader({
    ...doc_args(
      new Request(
        `https://bg.test${ref === null ? "/api/docs" : doc_href(ref)}`
      )
    ),
    params: {},
    context: {},
  } as any) as Promise<Response>;

const stream = (text = "%PDF-1.7") =>
  new Response(text).body as ReadableStream<Uint8Array>;
const found = (contentType = "application/pdf") => ({
  statusCode: 200,
  stream: stream(),
  blob: { contentType },
});

beforeEach(() => {
  session.user = null;
  read_doc.mockReset().mockImplementation(async () => found());
  holders.doc_holders.mockReset().mockResolvedValue({
    reg_owners: [],
    npo_ids: [],
  });
  holders.is_npo_member
    .mockReset()
    .mockImplementation(
      async (id: string, npo_ids: number[]) =>
        id === MEMBER.id && npo_ids.includes(7)
    );
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("legacy-bytes", {
          headers: { "content-type": "application/pdf" },
        })
    )
  );
});

describe("signed out", () => {
  test("is sent to sign in, and nothing is read", async () => {
    hold(PRIVATE, "reg");
    const err = await open(PRIVATE).catch((e) => e);
    expect(err).toBeInstanceOf(Response);
    expect(err.status).toBe(302);
    expect(read_doc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("a private document", () => {
  test("opens for the registrant who owns the registration", async () => {
    session.user = OWNER;
    hold(PRIVATE, "reg");
    const res = await open(PRIVATE);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("%PDF-1.7");
    expect(read_doc).toHaveBeenCalledWith(PRIVATE);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("opens for staff when a record holds it", async () => {
    session.user = STAFF;
    hold(PRIVATE, "reg");
    expect((await open(PRIVATE)).status).toBe(200);
  });

  test("is a 404 for staff when no record holds it", async () => {
    session.user = STAFF;
    hold(PRIVATE, "none");
    expect((await open(PRIVATE)).status).toBe(404);
    expect(read_doc).not.toHaveBeenCalled();
  });

  test("opens a bank statement for the nonprofit's own admins", async () => {
    session.user = MEMBER;
    hold(PRIVATE, "bank");
    expect((await open(PRIVATE)).status).toBe(200);
  });

  test("is a 404, not a 403, for a user of another nonprofit", async () => {
    session.user = OTHER;
    hold(PRIVATE, "bank");
    const res = await open(PRIVATE);
    expect(res.status).toBe(404);
    expect(read_doc).not.toHaveBeenCalled();
  });

  test("is a 404 for another user's registration", async () => {
    session.user = OTHER;
    hold(PRIVATE, "reg");
    expect((await open(PRIVATE)).status).toBe(404);
    expect(read_doc).not.toHaveBeenCalled();
  });

  test("opens for its uploader before any record holds it", async () => {
    session.user = { id: "u-x", email: "x@example.com" };
    hold(PRIVATE, "none");
    expect((await open(PRIVATE)).status).toBe(200);
  });

  test("is a 404 for someone else's unsaved upload", async () => {
    session.user = OTHER;
    hold(PRIVATE, "none");
    expect((await open(PRIVATE)).status).toBe(404);
  });

  test("cannot reach another uploader's folder with an encoded dot segment", async () => {
    session.user = OTHER;
    hold(PRIVATE, "none");
    const sneaky = `https://store1.private.blob.vercel-storage.com/docs/${OTHER.id}/%2e%2e/u-x/id-abc.pdf`;
    expect((await open(sneaky)).status).toBe(404);
    expect(read_doc).not.toHaveBeenCalled();
  });

  test("is a 404 when the file is gone from the store", async () => {
    session.user = OWNER;
    hold(PRIVATE, "reg");
    read_doc.mockResolvedValue(null);
    expect((await open(PRIVATE)).status).toBe(404);
  });

  test("is a 404 when the store refuses the reference", async () => {
    session.user = OWNER;
    hold(PRIVATE, "reg");
    read_doc.mockRejectedValue(new Error("not a blob url"));
    expect((await open(PRIVATE)).status).toBe(404);
  });

  test("downloads, never displays, a type a browser could run", async () => {
    session.user = OWNER;
    hold(PRIVATE, "reg");
    read_doc.mockResolvedValue(found("text/html"));
    const res = await open(PRIVATE);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toBe("attachment");
  });
});

describe("a reference that names nothing", () => {
  test.each([
    ["no ref", null],
    ["not a url", "N/A"],
    ["a url off our stores", "https://evil.example/docs/u-owner/x.pdf"],
    ["a file url", "file:///etc/passwd"],
  ])("is a 404: %s", async (_, ref) => {
    session.user = OWNER;
    expect((await open(ref)).status).toBe(404);
    expect(read_doc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("a row still holding an older stored url", () => {
  test("opens for the registrant, read server-side", async () => {
    session.user = OWNER;
    hold(LEGACY, "reg");
    const res = await open(LEGACY);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("legacy-bytes");
    expect(fetch).toHaveBeenCalledWith(LEGACY, { redirect: "error" });
    expect(read_doc).not.toHaveBeenCalled();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("opens for staff and for the nonprofit's admins", async () => {
    hold(LEGACY, "bank");
    session.user = MEMBER;
    expect((await open(LEGACY)).status).toBe(200);
    hold(LEGACY, "reg");
    session.user = STAFF;
    expect((await open(LEGACY)).status).toBe(200);
  });

  test("is a 404 for anyone else, with nothing fetched", async () => {
    session.user = OTHER;
    hold(LEGACY, "reg");
    expect((await open(LEGACY)).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("is a 404 when no record holds it, even for the staff", async () => {
    session.user = STAFF;
    hold(LEGACY, "none");
    expect((await open(LEGACY)).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("is a 404 when the old file is gone", async () => {
    session.user = OWNER;
    hold(LEGACY, "reg");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 }))
    );
    expect((await open(LEGACY)).status).toBe(404);
  });
});
