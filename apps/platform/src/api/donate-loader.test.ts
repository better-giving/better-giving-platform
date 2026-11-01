import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";
import { NPO_PUBLIC_KEYS } from "$/pg/queries/npo";
import { npos } from "$/pg/schema/npo";
import { programs } from "$/pg/schema/program";
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

vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock({
    session: { user: null },
  })
);

const { loader } = await import("./donate-loader");
const { create_test_db } = await import("$/pg/test-utils/pglite");

let counter = 0;

async function seed_npo(name: string) {
  counter++;
  const [row] = await test_db
    .current!.db.insert(npos)
    .values({
      registration_number: `EIN-${counter}`,
      name,
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
    })
    .returning();
  return row;
}

async function seed_program(npo_id: number, title: string) {
  const id = crypto.randomUUID();
  await test_db.current!.db.insert(programs).values({
    id,
    npo_id,
    title,
    description_pt: "{}",
    created_at: new Date().toISOString(),
  });
  return id;
}

async function load_key(id: string, program_id?: string) {
  const qs = program_id ? `?programId=${program_id}` : "";
  const request = new Request(`https://x/donate/${id}${qs}`);
  const res: any = await loader({
    ...doc_args(request),
    params: { id },
  } as any);
  return res.data;
}

async function load(npo_id: number, program_id?: string) {
  return load_key(String(npo_id), program_id);
}

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await test_db.current!.db.delete(programs);
  await test_db.current!.db.delete(npos);
});

describe("donate loader program", () => {
  it("renders the npo's page without another npo's program", async () => {
    const recipient = await seed_npo("Recipient");
    const other = await seed_npo("Other");
    const foreign = await seed_program(other.id, "Other's Program");

    const d = await load(recipient.id, foreign);

    expect(d.endow.name).toBe("Recipient");
    expect(d.program).toBeUndefined();
  });

  it("keeps the npo's own program", async () => {
    const recipient = await seed_npo("Recipient");
    const own = await seed_program(recipient.id, "Own Program");

    const d = await load(recipient.id, own);

    expect(d.program).toMatchObject({ id: own, title: "Own Program" });
  });
});

describe("donate loader npo", () => {
  it("sends the npo's display fields and none of its private columns", async () => {
    const npo = await seed_npo("Recipient");
    await test_db
      .current!.db.update(npos)
      .set({
        liq: 1234,
        cash: 567,
        lock_units: 89,
        w_form: "w9-eid",
        referral_id: `REF-${npo.id}`,
        payout_minimum: 50,
      })
      .where(eq(npos.id, npo.id));

    const d = await load(npo.id);

    expect(d.endow).toMatchObject({ id: npo.id, name: "Recipient" });
    expect(Object.keys(d.endow).sort()).toEqual([...NPO_PUBLIC_KEYS].sort());
  });
});

describe("donate loader org slug", () => {
  it("renders the same page for the slug as for the numeric id", async () => {
    const npo = await seed_npo("Recipient");
    await test_db
      .current!.db.update(npos)
      .set({ slug: "helping-hands" })
      .where(eq(npos.id, npo.id));

    const by_slug = await load_key("helping-hands");
    const by_id = await load(npo.id);

    expect(by_slug.endow).toEqual(by_id.endow);
    expect(by_slug.id).toBe(npo.id);
    expect(by_slug.arrived).toBe("helping-hands");
    expect(by_id.arrived).toBe(String(npo.id));
  });

  it("keeps a program query on a numeric id", async () => {
    const npo = await seed_npo("Recipient");
    const own = await seed_program(npo.id, "Own Program");

    const d = await load(npo.id, own);

    expect(d.program).toMatchObject({ id: own, title: "Own Program" });
    expect(d.arrived).toBe(String(npo.id));
  });

  it("is not found for an unknown slug or id", async () => {
    const slug = await load_key("no-such-slug").catch((e: unknown) => e);
    const id = await load_key("404000").catch((e: unknown) => e);

    expect(slug).toBeInstanceOf(Response);
    expect((slug as Response).status).toBe(404);
    expect(id).toBeInstanceOf(Response);
    expect((id as Response).status).toBe(404);
  });

  it("resolves a stored slug that matches a route", async () => {
    const npo = await seed_npo("Routed");
    await test_db
      .current!.db.update(npos)
      .set({ slug: "donate" })
      .where(eq(npos.id, npo.id));

    const d = await load_key("donate");

    expect(d.endow.id).toBe(npo.id);
    expect(d.endow.name).toBe("Routed");
    expect(d.arrived).toBe("donate");
  });

  it("is not found when a reserved word matches no nonprofit", async () => {
    const res = await load_key("org").catch((e: unknown) => e);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(404);
  });

  it("resolves a number-like value as an id", async () => {
    const npo = await seed_npo("Numbered");
    expect(npo.id).not.toBe(999001);
    await test_db
      .current!.db.update(npos)
      .set({ slug: "999001" })
      .where(eq(npos.id, npo.id));

    const as_id = await load_key("999001").catch((e: unknown) => e);
    const by_real_id = await load(npo.id);

    expect(as_id).toBeInstanceOf(Response);
    expect((as_id as Response).status).toBe(404);
    expect(by_real_id.endow.id).toBe(npo.id);
    expect(by_real_id.endow.name).toBe("Numbered");
  });
});

describe("donate loader inactive npo", () => {
  it("is not found once the npo is deactivated, like its profile page", async () => {
    const npo = await seed_npo("Closed");
    await test_db
      .current!.db.update(npos)
      .set({ active: false })
      .where(eq(npos.id, npo.id));

    const res = await load(npo.id).catch((e: unknown) => e);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(404);
  });
});
