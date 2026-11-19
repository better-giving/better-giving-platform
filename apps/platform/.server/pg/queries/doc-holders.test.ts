import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { TestDb } from "../test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

vi.mock("../db", () => ({
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

import { user } from "../schema/auth";
import { banking_apps } from "../schema/banking";
import { doc_url_aliases } from "../schema/doc-alias";
import { npos } from "../schema/npo";
import { registrations } from "../schema/registration";
import { user_npo_memberships } from "../schema/user";
import { create_test_db } from "../test-utils/pglite";
import { doc_holders, is_npo_member } from "./doc-holders";

const POI = "https://s.private.blob.vercel-storage.com/docs/u1/poi-a.pdf";
const POR = "https://s.public.blob.vercel-storage.com/u/por-b.pdf";
const BANK = "https://s.private.blob.vercel-storage.com/docs/u1/bank-c.pdf";
/** where the identity document lived before the job moved it to `POI` */
const OLD_POI = "https://s.public.blob.vercel-storage.com/u/poi-a.pdf";
/** moved to a copy the row no longer holds: the row was edited since */
const OLD_STALE = "https://s.public.blob.vercel-storage.com/u/stale.pdf";
const BANK_B = "https://s.private.blob.vercel-storage.com/docs/u2/bank-b.pdf";
const OLD_BANK_B = "https://s.public.blob.vercel-storage.com/bank-b.pdf";

let npo_id = 0;
let npo_b = 0;

beforeAll(async () => {
  test_db.current = await create_test_db();
  const db = test_db.current.db;
  const [npo] = await db
    .insert(npos)
    .values({
      registration_number: "EIN-DOCS-1",
      name: "Docs Org",
      slug: "docs-org",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
    })
    .returning();
  npo_id = npo!.id;
  const [b] = await db
    .insert(npos)
    .values({
      registration_number: "EIN-DOCS-2",
      name: "Other Org",
      slug: "other-org",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
    })
    .returning();
  npo_b = b!.id;
  await db.insert(user).values({
    id: "member-1",
    name: "Mem Ber",
    email: "member-1@example.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    first_name: "Mem",
    last_name: "Ber",
  });
  await db.insert(user_npo_memberships).values({ user_id: "member-1", npo_id });
  await db.insert(registrations).values({
    id: "reg-1",
    r_id: "owner@example.com",
    r_proof_of_identity: POI,
    o_proof_of_reg: POR,
    o_bank_statement: BANK,
  });
  await db.insert(banking_apps).values([
    { id: "bank-1", npo_id, bank_statement_url: BANK },
    { id: "bank-2", npo_id: npo_b, bank_statement_url: BANK_B },
  ]);
  await db.insert(doc_url_aliases).values([
    { old_url: OLD_POI, new_url: POI },
    { old_url: OLD_STALE, new_url: "https://s.private/docs/u1/replaced.pdf" },
    { old_url: OLD_BANK_B, new_url: BANK_B },
  ]);
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

describe("doc_holders", () => {
  test.each([
    ["identity", POI],
    ["proof of registration (an older url)", POR],
  ])("a registration's %s names its owner only", async (_, ref) => {
    expect(await doc_holders(ref)).toEqual({
      reg_owners: ["owner@example.com"],
      npo_ids: [],
    });
  });

  test("a bank statement names the registration and the nonprofit", async () => {
    expect(await doc_holders(BANK)).toEqual({
      reg_owners: ["owner@example.com"],
      npo_ids: [npo_id],
    });
  });

  test("a url a record held before its document moved names the same holders", async () => {
    expect(await doc_holders(OLD_POI)).toEqual(await doc_holders(POI));
    expect(await doc_holders(OLD_BANK_B)).toEqual({
      reg_owners: [],
      npo_ids: [npo_b],
    });
  });

  test("an old url whose copy no record holds any more names nobody", async () => {
    expect(await doc_holders(OLD_STALE)).toEqual({
      reg_owners: [],
      npo_ids: [],
    });
  });

  test("a reference no record holds names nobody", async () => {
    expect(await doc_holders("https://s.private/docs/u1/none.pdf")).toEqual({
      reg_owners: [],
      npo_ids: [],
    });
  });
});

describe("is_npo_member", () => {
  test("is true for a member of one of the nonprofits", async () => {
    expect(await is_npo_member("member-1", [npo_id + 1, npo_id])).toBe(true);
  });

  test("is false for a non-member, and for no nonprofits at all", async () => {
    expect(await is_npo_member("someone-else", [npo_id])).toBe(false);
    expect(await is_npo_member("member-1", [])).toBe(false);
  });

  test("a member of one nonprofit is refused another nonprofit's document", async () => {
    for (const ref of [BANK_B, OLD_BANK_B]) {
      const h = await doc_holders(ref);
      expect(h.reg_owners).toEqual([]);
      expect(await is_npo_member("member-1", h.npo_ids)).toBe(false);
    }
  });
});
