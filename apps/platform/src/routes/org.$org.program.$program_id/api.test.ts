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
import { seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import { doc_args } from "#/__tests__/fixtures/route-args";
import { campaigns } from "$/pg/schema/campaign";
import { dists } from "$/pg/schema/dist";
import { donation_donors, donations } from "$/pg/schema/donation";
import { npos } from "$/pg/schema/npo";
import { programs } from "$/pg/schema/program";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const report_error = vi.hoisted(() => vi.fn());
vi.mock("$/pg/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (test_db.current!.db as any)[prop];
    },
  }),
}));

vi.mock("#/errors/report", () => ({ report_error }));

import * as campaign_queries from "$/pg/queries/campaign";
import * as donor_queries from "$/pg/queries/donor";
import { loader } from "./api";

const A_PID = globalThis.crypto.randomUUID();
const B_PID = globalThis.crypto.randomUUID();
let npo_a: number;
let npo_b: number;
let creator_id: string;

beforeAll(async () => {
  const { create_test_db } = await import("$/pg/test-utils/pglite");
  test_db.current = await create_test_db();
  creator_id = (await seed_user(test_db.current.db, "maker@x.com"))!.id;
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  const db = test_db.current!.db;
  await db.delete(dists);
  await db.delete(donations);
  await db.delete(campaigns);
  await db.delete(npos);
  npo_a = (await seed_npo(db, { registration_number: "EIN-A" }))!.id;
  npo_b = (await seed_npo(db, { registration_number: "EIN-B" }))!.id;
  await db.insert(programs).values([
    { id: A_PID, npo_id: npo_a, title: "A wells", description_pt: "[]" },
    { id: B_PID, npo_id: npo_b, title: "B wells", description_pt: "[]" },
  ]);
});

/** one settled gift from `email`, designated to `program_id` */
async function seed_gift(id: string, email: string, program_id: string) {
  const db = test_db.current!.db;
  await db.insert(donations).values({
    id,
    upusd: 1,
    status: "settled",
    amount_base: 100,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
    program_id,
  });
  await db.insert(donation_donors).values({ donation_id: id, email });
  await db.insert(dists).values({
    id: `${id}-dist`,
    donation_id: id,
    status: "settled",
    date_created: new Date().toISOString(),
    to_id: npo_a,
    amount_denom: "USD",
  });
}

/** a live campaign in `program_id`, owned by npo a unless overridden */
const seed_campaign = (
  slug: string,
  program_id: string,
  o: Partial<typeof campaigns.$inferInsert> = {}
) =>
  test_db.current!.db.insert(campaigns).values({
    id: slug,
    owner_npo_id: npo_a,
    creator_id,
    name: `Campaign ${slug}`,
    slug,
    status: "live",
    program_id,
    ...o,
  });

const load = (program_id: string, org = String(npo_a), search = "") =>
  (loader as any)({
    params: { org, program_id },
    ...doc_args(
      new Request(`https://x/org/${org}/program/${program_id}${search}`)
    ),
  });

describe("program page", () => {
  it("shows a program on its own nonprofit's page", async () => {
    const d = await load(A_PID);

    expect(d.prog).toMatchObject({ id: A_PID, title: "A wells" });
    expect(d.url).toBe(`https://x/org/${npo_a}/program/${A_PID}`);
  });

  it("counts the donors who gave to this program", async () => {
    await seed_gift("don-1", "jane@x.com", A_PID);
    await seed_gift("don-2", "bob@x.com", A_PID);
    await seed_gift("don-3", "carol@x.com", B_PID);

    expect((await load(A_PID)).donors).toBe(2);
  });

  it("still serves the program and its campaigns without a count when the count fails", async () => {
    const db = test_db.current!.db;
    await db.update(npos).set({ slug: "a-org" }).where(eq(npos.id, npo_a));
    await seed_campaign("wells-run", A_PID);
    report_error.mockClear();
    vi.spyOn(donor_queries, "program_donor_count").mockRejectedValueOnce(
      new Error("donor count down")
    );
    const d = await load(A_PID, "a-org");

    expect(d.prog).toMatchObject({ id: A_PID });
    expect(d.campaigns.map((c: { id: string }) => c.id)).toEqual(["wells-run"]);
    expect(d.donors).toBeNull();
    expect(report_error).toHaveBeenCalledWith(expect.any(Error), {
      endow_id: npo_a,
    });
  });

  it("lists this program's live campaigns, linked under the org's slug", async () => {
    const db = test_db.current!.db;
    await db.update(npos).set({ slug: "a-org" }).where(eq(npos.id, npo_a));
    await seed_campaign("wells-run", A_PID, {
      banner: "https://img/wells.png",
      target_number: 5000,
      created_at: "2026-02-01T00:00:00.000Z",
    });
    await seed_campaign("wells-walk", A_PID, {
      created_at: "2026-01-01T00:00:00.000Z",
    });
    await seed_campaign("wells-draft", A_PID, { status: "draft" });
    await seed_campaign("other-program", B_PID);

    const d = await load(A_PID, "a-org");

    expect(d.campaigns).toEqual([
      {
        id: "wells-run",
        name: "Campaign wells-run",
        to: "/org/a-org/wells-run",
        image: "https://img/wells.png",
        raised: 0,
        target: "5000",
      },
      {
        id: "wells-walk",
        name: "Campaign wells-walk",
        to: "/org/a-org/wells-walk",
        image: null,
        raised: 0,
        target: undefined,
      },
    ]);
  });

  it("skips a campaign whose owner has no slug to link it under", async () => {
    const db = test_db.current!.db;
    await db.update(npos).set({ slug: "a-org" }).where(eq(npos.id, npo_a));
    await seed_campaign("a-run", A_PID);
    await seed_campaign("b-run", A_PID, { owner_npo_id: npo_b });

    const d = await load(A_PID, "a-org");

    expect(d.campaigns.map((c: { id: string }) => c.id)).toEqual(["a-run"]);
  });

  it("still serves the program and its donor count without campaigns when the list fails", async () => {
    const db = test_db.current!.db;
    await db.update(npos).set({ slug: "a-org" }).where(eq(npos.id, npo_a));
    await seed_campaign("wells-run", A_PID);
    await seed_gift("don-1", "jane@x.com", A_PID);
    report_error.mockClear();
    vi.spyOn(
      campaign_queries,
      "campaign_live_for_program"
    ).mockRejectedValueOnce(new Error("campaigns down"));
    const d = await load(A_PID, "a-org");

    expect(d.prog).toMatchObject({ id: A_PID });
    expect(d.donors).toBe(1);
    expect(d.campaigns).toEqual([]);
    expect(report_error).toHaveBeenCalledWith(expect.any(Error), {
      endow_id: npo_a,
    });
  });

  it("301s a published slugged org's id url to its slug url", async () => {
    const db = test_db.current!.db;
    await db
      .update(npos)
      .set({ slug: "a-org", published: true })
      .where(eq(npos.id, npo_a));
    const thrown = await load(A_PID, String(npo_a), "?utm_source=x").catch(
      (e: unknown) => e
    );

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(301);
    expect((thrown as Response).headers.get("location")).toBe(
      `/org/a-org/program/${A_PID}?utm_source=x`
    );
    expect((thrown as Response).headers.get("cache-control")).toBe(
      "public, max-age=3600, s-maxage=86400"
    );
    expect((await load(A_PID, "a-org")).prog).toMatchObject({ id: A_PID });
  });

  it("serves an unpublished slugged org's program at its id url, naming no slug", async () => {
    const db = test_db.current!.db;
    await db
      .update(npos)
      .set({ slug: "hidden-org", published: false })
      .where(eq(npos.id, npo_a));

    const d = await load(A_PID, String(npo_a));

    expect(d.prog).toMatchObject({ id: A_PID });
  });

  it("404s another nonprofit's program under this nonprofit's url", async () => {
    const thrown = await load(B_PID).catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
  });
});
