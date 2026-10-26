import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import type { DbOrTx } from "../pg/queries/helpers";
import { user } from "../pg/schema/auth";
import { campaigns } from "../pg/schema/campaign";
import { connector_photo_links } from "../pg/schema/connector";
import { npos } from "../pg/schema/npo";
import { create_test_db, type TestDb } from "../pg/test-utils/pglite";
import { sweep } from "./keys";
import {
  claimed_photo_link,
  consume_photo_link,
  issue_photo_link,
  PHOTO_CLAIM_PENDING_MS,
  PHOTO_LINK_TTL_MS,
  peek_photo_link,
  record_saved_photo,
  release_photo_link,
  saved_photo_link,
} from "./photo-links";

// pglite's drizzle handle differs from neon's only in the result-type HKT
const as_db = (x: unknown) => x as DbOrTx;

const sha256_hex = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const NOW = new Date("2026-10-17T15:00:00.000Z");
const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

let t: TestDb;

beforeAll(async () => {
  t = await create_test_db();
}, 30_000);

afterAll(async () => {
  await t?.client.close();
});

beforeEach(async () => {
  await t.db.delete(connector_photo_links);
  await t.db.delete(campaigns);
  await t.db.delete(npos);
  await t.db.delete(user);
});

const seed_org_campaign = async (ein: string, campaign_id: string) => {
  const npo = (await seed_npo(t.db, {
    name: `Org ${ein}`,
    registration_number: ein,
  }))!;
  const owner = (await seed_user(t.db, `${ein}@test.com`))!;
  await t.db.insert(campaigns).values({
    id: campaign_id,
    owner_npo_id: npo.id,
    creator_id: owner.id,
    name: "Spring drive",
    slug: campaign_id,
  });
  return { npo_id: npo.id, campaign_id };
};

const issue_for = async (ein: string, campaign_id: string) => {
  const seeded = await seed_org_campaign(ein, campaign_id);
  const issued = await issue_photo_link(
    as_db(t.db),
    seeded.npo_id,
    campaign_id,
    NOW
  );
  const [row] = await t.db
    .select({ id: connector_photo_links.id })
    .from(connector_photo_links)
    .where(eq(connector_photo_links.token_hash, sha256_hex(issued!.token)));
  return { ...seeded, token: issued!.token, id: row!.id };
};

// any query through it throws, so a null from it proves no query ran
const untouchable = as_db(
  new Proxy(
    {},
    {
      get() {
        throw new Error("queried the db");
      },
    }
  )
);

const at = (offset_ms: number) => new Date(NOW.getTime() + offset_ms);

describe("issue_photo_link", () => {
  test("returns a 43-char base64url token expiring in 15 minutes and stores only its sha-256", async () => {
    const { npo_id, campaign_id } = await seed_org_campaign("EIN-A", "c-a");

    const issued = await issue_photo_link(
      as_db(t.db),
      npo_id,
      campaign_id,
      NOW
    );

    expect(issued?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(PHOTO_LINK_TTL_MS).toBe(FIFTEEN_MIN_MS);
    expect(new Date(issued!.expires_at).getTime()).toBe(
      NOW.getTime() + FIFTEEN_MIN_MS
    );

    const rows = await t.db.select().from(connector_photo_links);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.token_hash).toBe(sha256_hex(issued!.token));
    expect(row.npo_id).toBe(npo_id);
    expect(row.campaign_id).toBe("c-a");
    expect(row.used_at).toBeNull();
    expect(new Date(row.expires_at).getTime()).toBe(
      NOW.getTime() + FIFTEEN_MIN_MS
    );
    for (const value of Object.values(row)) {
      if (typeof value === "string") expect(value).not.toContain(issued!.token);
    }
  });

  test("issues a different token on every call", async () => {
    const { npo_id, campaign_id } = await seed_org_campaign("EIN-A", "c-a");

    const a = await issue_photo_link(as_db(t.db), npo_id, campaign_id, NOW);
    const b = await issue_photo_link(as_db(t.db), npo_id, campaign_id, NOW);

    expect(a!.token).not.toBe(b!.token);
    expect(await t.db.select().from(connector_photo_links)).toHaveLength(2);
  });

  test("returns null and writes nothing for another org's campaign", async () => {
    const mine = await seed_org_campaign("EIN-A", "c-a");
    await seed_org_campaign("EIN-B", "c-b");

    const issued = await issue_photo_link(as_db(t.db), mine.npo_id, "c-b", NOW);

    expect(issued).toBeNull();
    expect(await t.db.select().from(connector_photo_links)).toHaveLength(0);
  });

  test("returns null for a campaign that doesn't exist", async () => {
    const { npo_id } = await seed_org_campaign("EIN-A", "c-a");

    expect(
      await issue_photo_link(as_db(t.db), npo_id, "c-missing", NOW)
    ).toBeNull();
  });
});

describe("peek_photo_link", () => {
  test("returns the link's id, npo and campaign while it is live", async () => {
    const link = await issue_for("EIN-A", "c-a");

    expect(await peek_photo_link(as_db(t.db), link.token, at(60_000))).toEqual({
      id: link.id,
      npo_id: link.npo_id,
      campaign_id: "c-a",
    });
  });

  test("returns null once the link has expired", async () => {
    const link = await issue_for("EIN-A", "c-a");

    expect(
      await peek_photo_link(as_db(t.db), link.token, at(FIFTEEN_MIN_MS))
    ).toBeNull();
  });

  test("returns null once the link has been used", async () => {
    const link = await issue_for("EIN-A", "c-a");
    await t.db
      .update(connector_photo_links)
      .set({ used_at: NOW.toISOString() })
      .where(eq(connector_photo_links.id, link.id));

    expect(await peek_photo_link(as_db(t.db), link.token, NOW)).toBeNull();
  });

  test("returns null for a well-formed token nobody issued", async () => {
    await issue_for("EIN-A", "c-a");

    expect(await peek_photo_link(as_db(t.db), "A".repeat(43), NOW)).toBeNull();
  });

  test.each([
    ["too short", "abc"],
    ["too long", "A".repeat(44)],
    ["outside base64url", `${"A".repeat(42)}=`],
    ["empty", ""],
  ])(
    "returns null for a malformed token (%s) without querying",
    async (_, token) => {
      expect(await peek_photo_link(untouchable, token, NOW)).toBeNull();
    }
  );
});

describe("consume_photo_link", () => {
  test("claims a live link once, stamping used_at, and a second claim gets null", async () => {
    const link = await issue_for("EIN-A", "c-a");
    const when = at(60_000);

    const first = await consume_photo_link(as_db(t.db), link.token, when);

    expect(first).toEqual({
      id: link.id,
      npo_id: link.npo_id,
      campaign_id: "c-a",
      used_at: when.toISOString(),
    });
    expect(await consume_photo_link(as_db(t.db), link.token, when)).toBeNull();
    expect(await peek_photo_link(as_db(t.db), link.token, when)).toBeNull();
  });

  test("returns null for an expired link and leaves it unused", async () => {
    const link = await issue_for("EIN-A", "c-a");

    expect(
      await consume_photo_link(as_db(t.db), link.token, at(FIFTEEN_MIN_MS + 1))
    ).toBeNull();
    const [row] = await t.db.select().from(connector_photo_links);
    expect(row!.used_at).toBeNull();
  });

  test("returns null for a malformed token without querying", async () => {
    expect(await consume_photo_link(untouchable, "nope", NOW)).toBeNull();
  });

  test("of two concurrent claims exactly one wins", async () => {
    const link = await issue_for("EIN-A", "c-a");

    const results = await Promise.all([
      consume_photo_link(as_db(t.db), link.token, NOW),
      consume_photo_link(as_db(t.db), link.token, NOW),
    ]);

    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });
});

describe("claimed_photo_link", () => {
  test("reads a claim that hasn't recorded a photo until PHOTO_CLAIM_PENDING_MS after it, then nothing", async () => {
    const { token, npo_id } = await issue_for("EIN-A", "c-a");
    expect(await claimed_photo_link(as_db(t.db), token, NOW)).toBeNull();
    await consume_photo_link(as_db(t.db), token, NOW);

    const inside = at(PHOTO_CLAIM_PENDING_MS - 1_000);
    expect(await claimed_photo_link(as_db(t.db), token, inside)).toEqual({
      npo_id,
      campaign_id: "c-a",
    });
    const past = at(PHOTO_CLAIM_PENDING_MS + 1_000);
    expect(await claimed_photo_link(as_db(t.db), token, past)).toBeNull();
  });

  test("reads nothing once the claim has recorded its photo, or for a malformed token", async () => {
    const { token, id } = await issue_for("EIN-A", "c-a");
    const claim = (await consume_photo_link(as_db(t.db), token, NOW))!;
    await record_saved_photo(
      as_db(t.db),
      id,
      claim.used_at,
      "https://blob.test/u/a.png"
    );

    expect(await claimed_photo_link(as_db(t.db), token, NOW)).toBeNull();
    expect(await claimed_photo_link(untouchable, "not a token")).toBeNull();
  });
});

describe("release_photo_link", () => {
  test("reopens a link consumed at the given used_at", async () => {
    const link = await issue_for("EIN-A", "c-a");
    const claimed = await consume_photo_link(as_db(t.db), link.token, NOW);

    await release_photo_link(as_db(t.db), claimed!.id, claimed!.used_at);

    expect(await peek_photo_link(as_db(t.db), link.token, NOW)).toEqual({
      id: link.id,
      npo_id: link.npo_id,
      campaign_id: "c-a",
    });
  });

  test("leaves a link alone when used_at belongs to a different claim", async () => {
    const link = await issue_for("EIN-A", "c-a");
    await consume_photo_link(as_db(t.db), link.token, at(2_000));

    await release_photo_link(as_db(t.db), link.id, at(1_000).toISOString());

    expect(
      await peek_photo_link(as_db(t.db), link.token, at(3_000))
    ).toBeNull();
  });
});

describe("record_saved_photo and saved_photo_link", () => {
  const URL_A = "https://blob.test/u/hero-Ab1.png";

  test("the claim that stored the photo records it, and the token reads it back until a day past its expiry", async () => {
    const { token, id } = await issue_for("EIN-A", "c-a");
    expect(await saved_photo_link(as_db(t.db), token, NOW)).toBeNull();
    const claim = (await consume_photo_link(as_db(t.db), token, NOW))!;

    expect(
      await record_saved_photo(as_db(t.db), id, claim.used_at, URL_A)
    ).toBe(true);
    const [row] = await t.db.select().from(connector_photo_links);
    expect(row).toMatchObject({
      saved_url: URL_A,
      saved_pathname: "/u/hero-Ab1.png",
    });
    const last = at(FIFTEEN_MIN_MS + DAY - 1_000);
    expect(await saved_photo_link(as_db(t.db), token, last)).toMatchObject({
      campaign_id: "c-a",
      saved_url: URL_A,
    });
    const past = at(FIFTEEN_MIN_MS + DAY + 1_000);
    expect(await saved_photo_link(as_db(t.db), token, past)).toBeNull();
  });

  test("another claim's used_at records nothing, and a malformed token reads nothing", async () => {
    const { token, id } = await issue_for("EIN-A", "c-a");
    await consume_photo_link(as_db(t.db), token, NOW);

    expect(
      await record_saved_photo(as_db(t.db), id, at(1).toISOString(), URL_A)
    ).toBe(false);
    expect(await saved_photo_link(as_db(t.db), token, NOW)).toBeNull();
    expect(await saved_photo_link(untouchable, "not a token")).toBeNull();
  });
});

describe("sweep", () => {
  test("deletes unsaved photo links expired more than 24h ago and keeps saved ones", async () => {
    const { npo_id } = await seed_org_campaign("EIN-A", "c-a");
    const link = (
      id: string,
      expires_ms: number,
      used = false,
      saved: string | null = null
    ) => ({
      id,
      token_hash: sha256_hex(id),
      npo_id,
      campaign_id: "c-a",
      expires_at: at(expires_ms).toISOString(),
      used_at: used ? at(expires_ms - 60_000).toISOString() : null,
      saved_url: saved && `https://blob.test${saved}`,
      saved_pathname: saved,
    });
    await t.db
      .insert(connector_photo_links)
      .values([
        link("stale", -DAY - 1_000),
        link("stale-used", -2 * DAY, true),
        link("expired-today", -DAY + 1_000),
        link("live", FIFTEEN_MIN_MS),
        link("stale-saved", -DAY - 1_000, true, "/u/hero-Ab1.png"),
        link("saved-today", -DAY + 1_000, true, "/u/hero-Cd2.png"),
      ]);

    const swept = await sweep(as_db(t.db), NOW);

    expect(swept.photo_links_deleted).toBe(2);
    const rows = await t.db
      .select({ id: connector_photo_links.id })
      .from(connector_photo_links);
    expect(rows.map((r) => r.id).sort()).toEqual([
      "expired-today",
      "live",
      "saved-today",
      "stale-saved",
    ]);
  });
});
