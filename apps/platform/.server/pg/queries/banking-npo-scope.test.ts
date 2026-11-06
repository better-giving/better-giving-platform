import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { banking_apps } from "../schema/banking";
import { npos } from "../schema/npo";
import type { TestDb } from "../test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
vi.mock("../db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (test_db.current!.db as any)[prop];
    },
  }),
}));

const {
  bapp_delete,
  bapp_delete_guarded,
  bapp_put,
  bapp_set_default,
  npo_default_bapp,
} = await import("./banking");

let own: number;
let other: number;

beforeAll(async () => {
  const { create_test_db } = await import("../test-utils/pglite");
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

const npo = (registration_number: string) => ({
  registration_number,
  name: registration_number,
  endow_designation: "Charity" as const,
  overview_pt: "[]",
  hq_country: "United States",
});

const bapp = (
  id: string,
  npo_id: number,
  status: "default" | "approved" | "under-review"
) => ({ id, npo_id, status });

const status_of = async (id: string) => {
  const [row] = await test_db
    .current!.db.select({ status: banking_apps.status })
    .from(banking_apps)
    .where(eq(banking_apps.id, id));
  return row?.status;
};

beforeEach(async () => {
  const db = test_db.current!.db;
  await db.delete(npos);
  const [a, b] = await db
    .insert(npos)
    .values([npo("EIN-OWN"), npo("EIN-OTHER")])
    .returning();
  own = a!.id;
  other = b!.id;
  await db
    .insert(banking_apps)
    .values([
      bapp("own-default", own, "default"),
      bapp("own-approved", own, "approved"),
      bapp("own-review", own, "under-review"),
      bapp("other-approved", other, "approved"),
    ]);
});

describe("bapp_set_default", () => {
  test("promotes the npo's approved method and demotes its old default", async () => {
    expect(await bapp_set_default("own-approved", own)).toBe(true);

    expect(await status_of("own-approved")).toBe("default");
    expect(await status_of("own-default")).toBe("approved");
  });

  test("another npo's method is not promoted and the caller's default stays", async () => {
    expect(await bapp_set_default("other-approved", own)).toBe(false);

    expect(await status_of("other-approved")).toBe("approved");
    expect(await status_of("own-default")).toBe("default");
  });

  test("a method still under review is not promoted", async () => {
    expect(await bapp_set_default("own-review", own)).toBe(false);

    expect(await status_of("own-review")).toBe("under-review");
    expect(await status_of("own-default")).toBe("default");
  });
});

describe("bapp_delete", () => {
  test("deletes the npo's own method", async () => {
    expect(await bapp_delete("own-approved", own)).toBe(true);
    expect(await status_of("own-approved")).toBeUndefined();
  });

  test("leaves another npo's method in place", async () => {
    expect(await bapp_delete("other-approved", own)).toBe(false);
    expect(await status_of("other-approved")).toBe("approved");
  });
});

describe("bapp_delete_guarded", () => {
  test("refuses the default while the npo has an approved method", async () => {
    expect(await bapp_delete_guarded("own-default", own)).toBe("refused");

    expect(await status_of("own-default")).toBe("default");
    expect(await status_of("own-approved")).toBe("approved");
  });

  test("deletes the default once no approved method could replace it", async () => {
    await test_db
      .current!.db.delete(banking_apps)
      .where(eq(banking_apps.id, "own-approved"));

    expect(await bapp_delete_guarded("own-default", own)).toBe("deleted");
    expect(await status_of("own-default")).toBeUndefined();
  });

  test("deletes a non-default method beside the default", async () => {
    expect(await bapp_delete_guarded("own-approved", own)).toBe("deleted");
    expect(await status_of("own-approved")).toBeUndefined();
    expect(await status_of("own-default")).toBe("default");
  });

  test("another npo's method is not found and stays", async () => {
    expect(await bapp_delete_guarded("other-approved", own)).toBe("not_found");
    expect(await status_of("other-approved")).toBe("approved");
  });
});

describe("bapp_put", () => {
  test("a retried submit of the same method is a no-op, not a key violation", async () => {
    const row = { id: "retry", npo_id: own, status: "under-review" as const };
    expect(await bapp_put(test_db.current!.db as any, row)).toBe(true);
    expect(await bapp_put(test_db.current!.db as any, row)).toBe(false);

    expect(await status_of("retry")).toBe("under-review");
  });
});

describe("npo_default_bapp", () => {
  test("the default row wins over other approved rows", async () => {
    expect((await npo_default_bapp(own))?.id).toBe("own-default");
  });

  test("an approved bank with no default flag is the one that pays", async () => {
    await test_db
      .current!.db.delete(banking_apps)
      .where(eq(banking_apps.id, "own-default"));

    expect((await npo_default_bapp(own))?.id).toBe("own-approved");
  });

  test("two approved banks and no default stay unpicked", async () => {
    const db = test_db.current!.db;
    await db.delete(banking_apps).where(eq(banking_apps.id, "own-default"));
    await db
      .insert(banking_apps)
      .values(bapp("own-approved-2", own, "approved"));

    expect(await npo_default_bapp(own)).toBeUndefined();
  });

  test("a bank still under review is not one", async () => {
    const db = test_db.current!.db;
    await db.delete(banking_apps).where(eq(banking_apps.npo_id, own));
    await db
      .insert(banking_apps)
      .values(bapp("own-review-2", own, "under-review"));

    expect(await npo_default_bapp(own)).toBeUndefined();
  });
});
