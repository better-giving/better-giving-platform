import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

vi.mock("$/pg/db", () => ({
  db: new Proxy(
    {},
    {
      get(_, prop) {
        const real = test_db.current?.db;
        if (!real) throw new Error("test_db not initialized");
        return (real as any)[prop];
      },
    }
  ),
}));

const { is_public_url, run } = await import("./migrate-private-docs");
const { create_test_db } = await import("$/pg/test-utils/pglite");
const { registrations } = await import("$/pg/schema/registration");
const { banking_apps } = await import("$/pg/schema/banking");
const { npos } = await import("$/pg/schema/npo");
const { doc_url_aliases } = await import("$/pg/schema/doc-alias");
const { doc_holders } = await import("$/pg/queries/doc-holders");
const { asc, eq } = await import("drizzle-orm");

const OLD_ID = "https://testpublic.public.blob.vercel-storage.com/u/id-aaa.pdf";
const OLD_BANK = "https://testpublic.public.blob.vercel-storage.com/bank-bbb.pdf";
const GONE = "https://testpublic.public.blob.vercel-storage.com/u/gone-ccc.pdf";
const PRIVATE = "https://s.private.blob.vercel-storage.com/docs/u1/new-ddd.pdf";

let npo_id = 0;

beforeAll(async () => {
  test_db.current = await create_test_db();
  const [npo] = await test_db.current.db
    .insert(npos)
    .values({
      registration_number: "EIN-MIG-1",
      name: "Mig Org",
      slug: "mig-org",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
    })
    .returning();
  npo_id = npo!.id;
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

const db = () => test_db.current!.db;

beforeEach(async () => {
  await test_db.current!.client.exec(
    "truncate registrations; truncate banking_apps; truncate doc_url_aliases"
  );
  await db()
    .insert(registrations)
    .values([
      {
        id: "reg-a",
        r_id: "a@example.com",
        r_proof_of_identity: OLD_ID,
        o_proof_of_reg: GONE,
        o_bank_statement: OLD_BANK,
      },
      {
        id: "reg-b",
        r_id: "b@example.com",
        r_proof_of_identity: PRIVATE,
        o_bank_statement: null,
      },
    ]);
  await db()
    .insert(banking_apps)
    .values({ id: "bank-a", npo_id, bank_statement_url: OLD_BANK });
});

const make = () => {
  const logs: string[] = [];
  const records: Record<string, unknown>[] = [];
  const fetch = vi.fn(async (url: string) =>
    url === GONE
      ? new Response("", { status: 404 })
      : new Response("%PDF-1.7", {
          headers: { "content-type": "application/pdf" },
        })
  );
  const put = vi.fn(async (pathname: string) => ({
    url: `https://s.private.blob.vercel-storage.com/${pathname}-sfx`,
  }));
  return {
    logs,
    records,
    fetch,
    put,
    deps: {
      fetch: fetch as unknown as typeof globalThis.fetch,
      put,
      log: (l: string) => logs.push(l),
      record: (e: Record<string, unknown>) => records.push(e),
    },
  };
};

const reg = async (id: string) =>
  (await db().select().from(registrations).where(eq(registrations.id, id)))[0]!;

const opts = (commit: boolean, known = new Map<string, string>()) => ({
  commit,
  batch: 1,
  known,
  token: "tok",
});

describe("is_public_url", () => {
  it("is true only for a url in the original store", () => {
    expect(is_public_url(OLD_ID)).toBe(true);
    expect(is_public_url(PRIVATE)).toBe(false);
    expect(is_public_url(null)).toBe(false);
    expect(is_public_url("N/A")).toBe(false);
  });

  it.each([
    ["a public store's host as a subdomain of another", "https://testpublic.public.blob.vercel-storage.com.evil.example/u/a.pdf"],
    ["a host that only ends like a public store", "https://s.xpublic.blob.vercel-storage.com/u/a.pdf"],
    ["a public store over http", "http://testpublic.public.blob.vercel-storage.com/u/a.pdf"],
    ["the host in the path", "https://evil.example/testpublic.public.blob.vercel-storage.com/u/a.pdf"],
    ["the host in the userinfo", "https://testpublic.public.blob.vercel-storage.com@evil.example/u/a.pdf"],
  ])("is false for %s", (_, url) => {
    expect(is_public_url(url)).toBe(false);
  });
});

describe("dry run", () => {
  it("counts what would move and what is gone, changing and copying nothing", async () => {
    const m = make();
    const sum = await run(opts(false), m.deps);

    // the identity and bank statement on the registration, the statement on
    // the banking application, and the registration proof that is gone
    expect(sum).toEqual({
      to_move: 4,
      moved: 0,
      gone: 1,
      failed: 0,
      changed: 0,
    });
    expect(m.put).not.toHaveBeenCalled();
    expect(m.records).toEqual([]);
    expect(
      m.fetch.mock.calls.every(([, init]: any) => init.method === "HEAD")
    ).toBe(true);
    const [row] = await db()
      .select()
      .from(registrations)
      .where(eq(registrations.id, "reg-a"));
    expect(row!.r_proof_of_identity).toBe(OLD_ID);
  });

  it("logs row ids and counts, never a url or a file name", async () => {
    const m = make();
    await run(opts(false), m.deps);
    const text = m.logs.join("\n");
    expect(text).toContain("registrations reg-a o_proof_of_reg: gone");
    expect(text).not.toMatch(/blob\.vercel-storage|\.pdf|aaa|bbb|ccc/);
  });
});

describe("commit", () => {
  it("copies each file to private storage and rewrites the rows", async () => {
    const m = make();
    const sum = await run(opts(true), m.deps);
    expect(sum).toEqual({
      to_move: 4,
      moved: 3,
      gone: 1,
      failed: 0,
      changed: 0,
    });

    const [a] = await db()
      .select()
      .from(registrations)
      .where(eq(registrations.id, "reg-a"));
    expect(a!.r_proof_of_identity).toMatch(
      /^https:\/\/s\.private\.blob\.vercel-storage\.com\/docs\/migrated\/registrations\/reg-a\/id-aaa\.pdf/
    );
    // a file whose original is gone is left for someone to null
    expect(a!.o_proof_of_reg).toBe(GONE);

    // the same file on two rows is copied once and both rows follow it
    const [b] = await db()
      .select()
      .from(banking_apps)
      .where(eq(banking_apps.id, "bank-a"));
    expect(b!.bank_statement_url).toBe(a!.o_bank_statement);
    expect(m.put).toHaveBeenCalledTimes(2);

    // a row already on the private store is untouched
    const [r] = await db()
      .select()
      .from(registrations)
      .where(eq(registrations.id, "reg-b"));
    expect(r!.r_proof_of_identity).toBe(PRIVATE);

    expect(m.records.map((e) => e.old).sort()).toEqual([OLD_BANK, OLD_ID]);
    expect(m.logs.join("\n")).not.toMatch(/blob\.vercel-storage|\.pdf/);
  });

  it("copies privately, never overwriting, and leaves the originals alone", async () => {
    const m = make();
    await run(opts(true), m.deps);
    for (const [path, , o] of m.put.mock.calls as any[]) {
      expect(path.startsWith("docs/migrated/")).toBe(true);
      expect(o).toMatchObject({
        access: "private",
        addRandomSuffix: true,
        allowOverwrite: false,
        token: "tok",
      });
    }
    expect(
      m.fetch.mock.calls.every(([, init]: any) => init.method === "GET")
    ).toBe(true);
  });

  it("is idempotent: a rerun finds nothing left but the gone file", async () => {
    await run(opts(true), make().deps);
    const again = make();
    const sum = await run(opts(true), again.deps);
    expect(sum).toEqual({
      to_move: 1,
      moved: 0,
      gone: 1,
      failed: 0,
      changed: 0,
    });
    expect(again.put).not.toHaveBeenCalled();
  });

  it("reuses a copy an earlier run recorded, so a crash before the write doesn't copy twice", async () => {
    const known = new Map([[OLD_ID, `${PRIVATE}?earlier`]]);
    const m = make();
    await run(opts(true, known), m.deps);
    const [a] = await db()
      .select()
      .from(registrations)
      .where(eq(registrations.id, "reg-a"));
    expect(a!.r_proof_of_identity).toBe(`${PRIVATE}?earlier`);
    expect(m.put).toHaveBeenCalledTimes(1);
  });

  it("leaves a row alone and reports it when its copy fails", async () => {
    const m = make();
    m.put.mockRejectedValue(new Error("store down"));
    const sum = await run(opts(true), m.deps);
    expect(sum.moved).toBe(0);
    expect(sum.failed).toBeGreaterThan(0);
    const [a] = await db()
      .select()
      .from(registrations)
      .where(eq(registrations.id, "reg-a"));
    expect(a!.r_proof_of_identity).toBe(OLD_ID);
  });

  it("keeps a link to the old url opening, through an alias written with the row", async () => {
    await run(opts(true), make().deps);
    const a = await reg("reg-a");
    expect(
      await db()
        .select()
        .from(doc_url_aliases)
        .orderBy(asc(doc_url_aliases.old_url))
    ).toEqual([
      { old_url: OLD_BANK, new_url: a.o_bank_statement },
      { old_url: OLD_ID, new_url: a.r_proof_of_identity },
    ]);
    expect(await doc_holders(OLD_ID)).toEqual({
      reg_owners: ["a@example.com"],
      npo_ids: [],
    });
    expect(await doc_holders(OLD_BANK)).toEqual({
      reg_owners: ["a@example.com"],
      npo_ids: [npo_id],
    });
  });

  it("neither overwrites nor counts a row edited while its file was copied", async () => {
    const m = make();
    m.put.mockImplementation(async (pathname: string) => {
      if (pathname.endsWith("id-aaa.pdf")) {
        await db()
          .update(registrations)
          .set({ r_proof_of_identity: "edited" })
          .where(eq(registrations.id, "reg-a"));
      }
      return {
        url: `https://s.private.blob.vercel-storage.com/${pathname}-sfx`,
      };
    });
    const sum = await run(opts(true), m.deps);
    expect(sum).toEqual({
      to_move: 4,
      moved: 2,
      gone: 1,
      failed: 0,
      changed: 1,
    });
    expect((await reg("reg-a")).r_proof_of_identity).toBe("edited");
    // no alias to a copy nothing holds
    expect(await doc_holders(OLD_ID)).toEqual({ reg_owners: [], npo_ids: [] });
    expect(m.logs.join("\n")).toContain(
      "registrations reg-a r_proof_of_identity: changed since read"
    );
  });

  it("pages through every row, one batch at a time", async () => {
    const more = ["reg-c", "reg-d", "reg-e"];
    await db()
      .insert(registrations)
      .values(
        more.map((id) => ({
          id,
          r_id: `${id}@example.com`,
          r_proof_of_identity: `https://testpublic.public.blob.vercel-storage.com/u/${id}.pdf`,
        }))
      );
    const m = make();
    const sum = await run(opts(true), m.deps);
    expect(sum).toEqual({
      to_move: 7,
      moved: 6,
      gone: 1,
      failed: 0,
      changed: 0,
    });
    for (const id of more) {
      expect((await reg(id)).r_proof_of_identity).toMatch(
        new RegExp(
          `^https://s\\.private\\..*/docs/migrated/registrations/${id}/`
        )
      );
    }
    expect(
      m.logs.filter((l) => l.startsWith("registrations: rewrote")).length
    ).toBe(4);
  });

  it("reports a batch whose write failed and carries on with the rest", async () => {
    await db().insert(registrations).values({
      id: "reg-c",
      r_id: "c@example.com",
      r_proof_of_identity:
        "https://testpublic.public.blob.vercel-storage.com/u/reg-c.pdf",
    });
    const m = make();
    // a copy at the same url fails the alias's own check, rolling the batch back
    m.put.mockImplementation(async (pathname: string) => ({
      url: pathname.endsWith("reg-c.pdf")
        ? "https://testpublic.public.blob.vercel-storage.com/u/reg-c.pdf"
        : `https://s.private.blob.vercel-storage.com/${pathname}-sfx`,
    }));
    const sum = await run(opts(true), m.deps);
    expect(sum).toEqual({
      to_move: 5,
      moved: 3,
      gone: 1,
      failed: 1,
      changed: 0,
    });
    expect((await reg("reg-c")).r_proof_of_identity).toBe(
      "https://testpublic.public.blob.vercel-storage.com/u/reg-c.pdf"
    );
    const text = m.logs.join("\n");
    expect(text).toContain("registrations: batch reg-c failed");
    expect(text).toMatch(/commit: 5 to move, 3 moved, .*1 failed/);
    expect(text).not.toMatch(/blob\.vercel-storage|\.pdf/);
  });
});
