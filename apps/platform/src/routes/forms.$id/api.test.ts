import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";
import { forms } from "$/pg/schema/form";
import { npos } from "$/pg/schema/npo";
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

const { loader } = await import("./api");
const { create_test_db } = await import("$/pg/test-utils/pglite");

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

describe("public form loader", () => {
  it("sends the recipient's display fields and none of its private columns", async () => {
    const [npo] = await test_db
      .current!.db.insert(npos)
      .values({
        registration_number: "EIN-FORM",
        name: "Recipient",
        endow_designation: "Charity",
        overview_pt: "[]",
        hq_country: "United States",
        hide_bg_tip: true,
        donor_address_required: true,
        liq: 1234,
        cash: 567,
        lock_units: 89,
        w_form: "w9-eid",
        referral_id: "REF-FORM",
        payout_minimum: 50,
      })
      .returning();
    await test_db.current!.db.insert(forms).values({
      id: "form-1",
      name: "Spring drive",
      owner_npo_id: npo.id,
      recipient_npo_id: npo.id,
    });

    const d = await loader({
      ...doc_args(new Request("https://x/forms/form-1")),
      params: { id: "form-1" },
    } as any);

    expect(d.recipient_details).toEqual({
      name: "Recipient",
      hide_bg_tip: true,
      donor_address_required: true,
    });
  });

  it("sends only the form fields the donation widget renders", async () => {
    const [npo] = await test_db
      .current!.db.insert(npos)
      .values({
        registration_number: "EIN-FORM-KEYS",
        name: "Owner",
        endow_designation: "Charity",
        overview_pt: "[]",
        hq_country: "United States",
      })
      .returning();
    await test_db.current!.db.insert(forms).values({
      id: "form-keys",
      name: "Keys drive",
      tag: "internal-campaign-tag",
      owner_npo_id: npo.id,
      recipient_npo_id: npo.id,
      ltd: 9999,
      ltd_count: 42,
    });

    const d = await loader({
      ...doc_args(new Request("https://x/forms/form-keys")),
      params: { id: "form-keys" },
    } as any);

    expect(Object.keys(d).sort()).toEqual(
      [
        "accent_primary",
        "accent_secondary",
        "base_url",
        "defaults",
        "donate_methods",
        "freq_opts",
        "id",
        "increments",
        "name",
        "program_id",
        "program_name",
        "recipient_details",
        "recipient_fund_id",
        "recipient_npo_id",
        "status",
        "success_redirect",
      ].sort()
    );
  });
});
