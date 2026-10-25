import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seed_fund } from "#/__tests__/fixtures/funds";
import { encode_date_cursor } from "$/pg/queries/helpers";
import { user } from "$/pg/schema/auth";
import { campaigns } from "$/pg/schema/campaign";
import { dists } from "$/pg/schema/dist";
import { donation_donors, donations } from "$/pg/schema/donation";
import { donation_messages } from "$/pg/schema/donation-message";
import { npo_media, npos } from "$/pg/schema/npo";
import { programs } from "$/pg/schema/program";
import { user_npo_memberships } from "$/pg/schema/user";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const report_error = vi.hoisted(() => vi.fn());
const get_session = vi.hoisted(() =>
  vi.fn(async (_: Request) => ({ user: undefined as any }))
);

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

vi.mock("#/errors/report", () => ({ report_error }));

// .env.test carries a gateway key, so an unmocked pick would call the real gateway
const jev_choice = vi.hoisted(() => vi.fn(async () => null as string | null));
vi.mock("$/jev", () => ({ jev_choice }));

vi.mock("#/.server/auth", async () => ({
  ...(await import("$/auth/test-utils")).make_auth_mock(),
  get_session,
}));

const npo_queries = await import("$/pg/queries/npo");
const program_queries = await import("$/pg/queries/program");
const campaign_queries = await import("$/pg/queries/campaign");
const funds_queries = await import("#/.server/funds");
const { NPO_PUBLIC_KEYS } = npo_queries;
const message_queries = await import("$/pg/queries/donation-message");
const { donation_message_list } = message_queries;
const { headers, loader } = await import("./api");
const { npo_donors } = await import("#/.server/npo-donors");
const donors_api = await import("#/routes/api.npo.$id.donors");
const { create_test_db } = await import("$/pg/test-utils/pglite");

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

const db = () => test_db.current!.db;
let counter = 0;

async function seed_npo(overrides: Partial<typeof npos.$inferInsert> = {}) {
  counter++;
  const [row] = await db()
    .insert(npos)
    .values({
      registration_number: `EIN-LOADER-${counter}`,
      name: `Loader Org ${counter}`,
      slug: `loader-org-${counter}`,
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      published: true,
      ...overrides,
    })
    .returning();
  return row!;
}

/** a settled one-time gift from `email` to the org, worth `upusd` base units a dollar */
async function seed_gift(
  id: string,
  email: string,
  to_id: number,
  campaign_id?: string
) {
  await db().insert(donations).values({
    campaign_id,
    id,
    upusd: 1,
    status: "settled",
    amount_base: 25,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
  });
  await db().insert(donation_donors).values({ donation_id: id, email });
  await db()
    .insert(dists)
    .values({
      id: `${id}-dist`,
      donation_id: id,
      status: "settled",
      date_created: new Date().toISOString(),
      to_id,
      amount_denom: "USD",
    });
}

async function seed_creator() {
  counter++;
  const [row] = await db()
    .insert(user)
    .values({
      id: `creator-${counter}`,
      name: "Cam Creator",
      email: `creator-${counter}@example.com`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      first_name: "Cam",
      last_name: "Creator",
    })
    .returning();
  return row!;
}

/** portable text with one block per paragraph */
const pt = (...paras: string[]) =>
  JSON.stringify(
    paras.map((text, i) => ({
      _type: "block",
      _key: `b${i}`,
      style: "normal",
      markDefs: [],
      children: [{ _type: "span", _key: `s${i}`, text, marks: [] }],
    }))
  );

/** a live campaign the org runs; `story` is its paragraphs as portable text */
async function seed_campaign(
  owner_npo_id: number,
  id: string,
  story: string[] = [],
  overrides: Partial<typeof campaigns.$inferInsert> = {}
) {
  const creator = await seed_creator();
  await db()
    .insert(campaigns)
    .values({
      id,
      owner_npo_id,
      creator_id: creator.id,
      name: `Campaign ${id}`,
      slug: id,
      status: "live",
      description_pt: pt(...story),
      ...overrides,
    });
}

const hours_ago = (h: number) =>
  new Date(Date.now() - h * 3_600_000).toISOString();

/** the loader's answer as it leaves the route: its data plus response init */
const respond = (param: string, search = "") =>
  loader({
    request: new Request(`https://x/org/${param}${search}`),
    params: { org: param },
  } as any);

const load = (param: string, search = "") =>
  respond(param, search).then((r) => r.data);

/** the document's cache-control, composed as react-router does. a route whose
 * loader threw records no loaderData, so its `loaderHeaders` is empty and the
 * thrown response's headers arrive only as `errorHeaders`; a successful load
 * carries its `data()` init headers as `loaderHeaders`. */
function cache_control(outcome: unknown) {
  const threw = outcome instanceof Response;
  const own = new Headers(
    threw
      ? outcome.headers
      : (outcome as Awaited<ReturnType<typeof respond>>).init?.headers
  );
  return new Headers(
    headers({
      loaderHeaders: threw ? new Headers() : own,
      parentHeaders: new Headers(),
      actionHeaders: new Headers(),
      errorHeaders: threw ? own : undefined,
    })
  ).get("cache-control");
}

/** what the loader throws; a loader that answers instead has its deferred
 * reads settled, so a failure here reports before afterAll closes the db */
const thrown = (p: ReturnType<typeof load>) =>
  p.then(
    async (d: {
      funds: Promise<unknown>;
      media: Promise<unknown>;
      programs: Promise<unknown>;
    }) => {
      await Promise.allSettled([d.funds, d.media, d.programs]);
      return d;
    },
    (e: unknown) => e
  );

describe("public npo profile loader", () => {
  it("sends the npo's profile fields and none of its private columns", async () => {
    const [npo] = await test_db
      .current!.db.insert(npos)
      .values({
        registration_number: "EIN-PROFILE",
        name: "Profile Org",
        slug: "profile-org",
        endow_designation: "Charity",
        overview_pt: "[]",
        hq_country: "United States",
        street_address: "1 Main St",
        liq: 1234,
        cash: 567,
        lock_units: 89,
        w_form: "w9-eid",
        referral_id: "REF-PROFILE",
        payout_minimum: 50,
        published: true,
      })
      .returning();

    const d = await load("profile-org");
    // settle the deferred reads before afterAll closes the db under them
    await Promise.all([d.funds, d.media, d.programs]);

    expect(d.npo).toMatchObject({
      id: npo.id,
      name: "Profile Org",
      street_address: "1 Main St",
    });
    expect(Object.keys(d.npo).sort()).toEqual([...NPO_PUBLIC_KEYS].sort());
    expect(d.url).toBe("https://x/org/profile-org");

    // the id url is an alias of a slugged org's profile
    const thrown = await loader({
      request: new Request(`https://x/org/${npo.id}?referrer=R1`),
      params: { org: String(npo.id) },
    } as any).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(301);
    expect((thrown as Response).headers.get("location")).toBe(
      "/org/profile-org?referrer=R1"
    );
    expect((thrown as Response).headers.get("cache-control")).toBe(
      "public, max-age=3600, s-maxage=86400"
    );
  });

  it("still serves the profile when the donor count fails, without a count", async () => {
    const [npo] = await test_db
      .current!.db.insert(npos)
      .values({
        registration_number: "EIN-NO-COUNT",
        name: "No Count Org",
        slug: "no-count-org",
        endow_designation: "Charity",
        overview_pt: "[]",
        hq_country: "United States",
        published: true,
      })
      .returning();
    vi.spyOn(npo_queries, "npo_donor_count").mockRejectedValueOnce(
      new Error("donor count down")
    );

    const d = await load("no-count-org");
    await Promise.all([d.funds, d.media, d.programs]);

    expect(d.npo).toMatchObject({ id: npo!.id, name: "No Count Org" });
    expect(d.donors).toBeNull();
    expect(report_error).toHaveBeenCalledWith(expect.any(Error), {
      endow_id: npo!.id,
    });
  });

  it("counts the org's distinct settled donors", async () => {
    const npo = await seed_npo();
    await seed_gift("don-count-1", "a@example.com", npo.id);
    await seed_gift("don-count-2", "b@example.com", npo.id);

    const d = await load(npo.slug!);
    await Promise.all([d.funds, d.media, d.programs]);

    expect(d.donors).toBe(2);
  });

  it("sends donor messages by name and text only, dropping blank ones", async () => {
    const npo = await seed_npo();
    const org = String(npo.id);
    await seed_gift("don-msg-1", "ana@example.com", npo.id);
    await db()
      .insert(donation_messages)
      .values([
        {
          id: "msg-1",
          donation_id: "don-msg-1",
          npo_id: org,
          donor_name: "Ana",
          donor_message: "Keep going",
          amount: 25,
          date: hours_ago(1),
        },
        {
          id: "msg-blank",
          npo_id: org,
          donor_name: "Ben",
          donor_message: "   ",
          date: hours_ago(2),
        },
        {
          id: "msg-anon",
          npo_id: org,
          donor_name: null,
          donor_message: "Anonymous hello",
          date: hours_ago(3),
        },
        {
          id: "msg-none",
          npo_id: org,
          donor_name: "Cy",
          donor_message: null,
          date: hours_ago(4),
        },
      ]);
    // the feed the loader reads from carries Ana's amount, so a message
    // leaving without one is the loader's doing
    const feed = await donation_message_list(org);
    expect(feed.items.find((m) => m.id === "msg-1")?.amount).toBe(25);

    const d = await load(npo.slug!);
    await Promise.all([d.funds, d.media, d.programs]);

    // toEqual refuses an extra key, so an amount on either item fails it
    expect(d.messages).toEqual([
      { id: "msg-1", name: "Ana", message: "Keep going" },
      { id: "msg-anon", name: "Donor", message: "Anonymous hello" },
    ]);
    // four rows fit one page: nothing further to fetch
    expect(d.messages_next).toBeNull();
  });

  it("still serves the profile when the messages fail, with none and no cursor", async () => {
    const npo = await seed_npo();
    report_error.mockClear();
    const down = new Error("messages down");
    vi.spyOn(message_queries, "donation_message_list").mockRejectedValueOnce(
      down
    );

    const d = await load(npo.slug!);
    await Promise.all([d.funds, d.media, d.programs]);

    expect(d.messages).toEqual([]);
    expect(d.messages_next).toBeNull();
    expect(report_error).toHaveBeenCalledWith(down, { endow_id: npo.id });
  });

  it("shows messages older than a run of blank gifts, and the cursor the donors api resumes from with_message", async () => {
    const npo = await seed_npo();
    const org = String(npo.id);
    // newest first: 12 gifts with no message, then 13 messages
    await db()
      .insert(donation_messages)
      .values(
        Array.from({ length: 25 }, (_, i) => ({
          id: i < 12 ? `gap-blank-${i + 1}` : `gap-msg-${i - 11}`,
          npo_id: org,
          donor_name: `Donor ${i + 1}`,
          donor_message: i < 12 ? "" : `Message ${i - 11}`,
          date: hours_ago(i + 1),
        }))
      );

    const d = await load(npo.slug!);
    await Promise.all([d.funds, d.media, d.programs]);

    expect(d.messages.map((m) => m.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `gap-msg-${i + 1}`)
    );
    expect(d.messages_next).toEqual(expect.any(String));
    const after = await npo_donors(org, d.messages_next!, undefined, true);
    expect(after.items.map((m) => m.id)).toEqual([
      "gap-msg-11",
      "gap-msg-12",
      "gap-msg-13",
    ]);
    expect(after.next).toBeUndefined();
  });

  it("shows only the newest featured videos, up to the limit", async () => {
    const npo = await seed_npo();
    const other = await seed_npo();
    const row = (
      id: string,
      hours: number,
      over: Partial<typeof npo_media.$inferInsert> = {}
    ) => ({
      id,
      npo_id: npo.id,
      url: `https://youtu.be/${id}`,
      type: "video" as const,
      featured: true,
      date_created: hours_ago(hours),
      ...over,
    });
    await db()
      .insert(npo_media)
      .values([
        row("unfeatured", 1, { featured: false }),
        row("album", 2, { type: "album" }),
        row("elsewhere", 3, { npo_id: other.id }),
        row("v1", 10),
        row("v2", 11),
        row("v3", 12),
        row("v4", 13),
        row("v5", 14),
      ]);

    const d = await load(npo.slug!);
    await Promise.all([d.funds, d.programs]);

    expect((await d.media).map((m) => m.id)).toEqual(["v1", "v2", "v3", "v4"]);
  });

  it("sends each campaign as official, with its mark, donate link and story excerpt", async () => {
    const npo = await seed_npo({ logo: "https://img/org-logo.png" });
    await seed_campaign(
      npo.id,
      "cmp-story",
      ["  Clean  water\tfor", "every village.  "],
      {
        logo: "https://img/cmp-logo.png",
      }
    );

    const d = await load(npo.slug!);
    await Promise.all([d.funds, d.media, d.programs]);

    expect(d.campaigns).toEqual([
      expect.objectContaining({
        id: "cmp-story",
        official: true,
        mark: "https://img/cmp-logo.png",
        to: `/org/${npo.slug}/cmp-story`,
        donate_to: `/org/${npo.slug}/cmp-story`,
        excerpt: "Clean water for every village.",
      }),
    ]);
  });

  it("lists a slugless org's live campaign under the org's id", async () => {
    const npo = await seed_npo({ slug: null });
    await seed_campaign(npo.id, "cmp-slugless");

    const d = await load(String(npo.id));
    await Promise.all([d.funds, d.media, d.programs]);

    expect(d.campaigns).toEqual([
      expect.objectContaining({
        id: "cmp-slugless",
        to: `/org/${npo.id}/cmp-slugless`,
        donate_to: `/org/${npo.id}/cmp-slugless`,
      }),
    ]);
  });

  it("sends an owned campaign as official with no partner org, and its end date when it has one", async () => {
    const npo = await seed_npo();
    const ends = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await seed_campaign(npo.id, "cmp-ends", [], {
      created_at: hours_ago(1),
      ends_at: ends,
    });
    await seed_campaign(npo.id, "cmp-open", [], { created_at: hours_ago(2) });

    const d = await load(npo.slug!);
    await Promise.all([d.funds, d.media, d.programs]);

    expect(
      d.campaigns.map((c) => [c.id, c.official, c.with_org, c.ends_at])
    ).toEqual([
      ["cmp-ends", true, null, ends],
      ["cmp-open", true, null, null],
    ]);
  });

  it("gives a campaign the org's logo as its mark and the org's banner as its image, unless it has its own", async () => {
    const npo = await seed_npo({
      logo: "https://img/org-logo.png",
      image: "https://img/org-banner.png",
    });
    await seed_campaign(npo.id, "cmp-bare", [], { created_at: hours_ago(1) });
    await seed_campaign(npo.id, "cmp-own", [], {
      created_at: hours_ago(2),
      logo: "https://img/cmp-logo.png",
      banner: "https://img/cmp-banner.png",
    });

    const d = await load(npo.slug!);
    await Promise.all([d.funds, d.media, d.programs]);

    expect(d.campaigns.map((c) => [c.id, c.mark, c.image])).toEqual([
      ["cmp-bare", "https://img/org-logo.png", "https://img/org-banner.png"],
      ["cmp-own", "https://img/cmp-logo.png", "https://img/cmp-banner.png"],
    ]);
  });

  it("cuts a long story on a word boundary within 160 characters, and sends none as empty", async () => {
    const npo = await seed_npo();
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`);
    await seed_campaign(npo.id, "cmp-long", [words.join(" ")], {
      created_at: hours_ago(1),
    });
    await seed_campaign(npo.id, "cmp-none", [], { created_at: hours_ago(2) });

    const d = await load(npo.slug!);
    await Promise.all([d.funds, d.media, d.programs]);

    const [long, none] = d.campaigns;
    expect(long!.excerpt.length).toBeLessThanOrEqual(160);
    expect(long!.excerpt).toMatch(/…$/);
    // whole words only: the text before the ellipsis is a prefix of the story
    const kept = long!.excerpt.slice(0, -1).split(" ");
    expect(kept).toEqual(words.slice(0, kept.length));
    expect(kept.length).toBeGreaterThan(20);
    expect(none!.excerpt).toBe("");
  });

  it("counts each campaign's distinct settled donors as its supporters", async () => {
    const npo = await seed_npo();
    await seed_campaign(npo.id, "cmp-backed", [], { created_at: hours_ago(1) });
    await seed_campaign(npo.id, "cmp-quiet", [], { created_at: hours_ago(2) });
    await seed_gift("don-cmp-1", "ana@example.com", npo.id, "cmp-backed");
    await seed_gift("don-cmp-2", "ANA@example.com", npo.id, "cmp-backed");
    await seed_gift("don-cmp-3", "ben@example.com", npo.id, "cmp-backed");
    const counts = vi.spyOn(campaign_queries, "campaign_donor_counts");

    const d = await load(npo.slug!);
    await Promise.all([d.funds, d.media, d.programs]);

    // email as stored, like the org's donor count: ana and ANA are two
    expect(d.campaigns.map((c) => [c.id, c.supporters])).toEqual([
      ["cmp-backed", 3],
      ["cmp-quiet", 0],
    ]);
    // one grouped read for every card, not one per campaign
    expect(counts).toHaveBeenCalledOnce();
  });

  it("still serves its campaigns when their supporter counts fail, without counts, reporting once", async () => {
    const npo = await seed_npo();
    await seed_campaign(npo.id, "cmp-down-a", [], { created_at: hours_ago(1) });
    await seed_campaign(npo.id, "cmp-down-b", [], { created_at: hours_ago(2) });
    report_error.mockClear();
    const down = new Error("campaign counts down");
    vi.spyOn(campaign_queries, "campaign_donor_counts").mockRejectedValueOnce(
      down
    );

    const d = await load(npo.slug!);
    await Promise.all([d.funds, d.media, d.programs]);

    expect(d.campaigns.map((c) => [c.id, c.supporters])).toEqual([
      ["cmp-down-a", null],
      ["cmp-down-b", null],
    ]);
    expect(report_error).toHaveBeenCalledOnce();
    expect(report_error).toHaveBeenCalledWith(down, { endow_id: npo.id });
  });

  it("answers 404 for an unpublished org to an anonymous visitor, kept out of shared caches", async () => {
    const npo = await seed_npo({ published: false });
    get_session.mockResolvedValueOnce({ user: undefined });

    const res = await respond(npo.slug!).catch((e: unknown) => e);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(404);
    expect(cache_control(res)).toBe("private, no-store");
  });

  it("answers 404 for an unpublished org to a signed-in admin of another org, kept out of shared caches", async () => {
    const npo = await seed_npo({ published: false });
    const other = await seed_npo();
    const outsider = await seed_creator();
    await db()
      .insert(user_npo_memberships)
      .values({ user_id: outsider.id, npo_id: other.id });
    get_session.mockResolvedValueOnce({ user: outsider });

    const res = await respond(npo.slug!).catch((e: unknown) => e);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(404);
    expect(cache_control(res)).toBe("private, no-store");
  });

  it("shows an unpublished org to its own admin and to a platform admin, kept out of shared caches", async () => {
    const npo = await seed_npo({ published: false });
    const member = await seed_creator();
    await db()
      .insert(user_npo_memberships)
      .values({ user_id: member.id, npo_id: npo.id });
    const platform_admin = { ...(await seed_creator()), role: "admin" };

    for (const viewer of [member, platform_admin]) {
      get_session.mockResolvedValueOnce({ user: viewer });
      const res = await respond(npo.slug!);
      await Promise.all([res.data.funds, res.data.media, res.data.programs]);

      expect(res.data.npo.id).toBe(npo.id);
      expect(cache_control(res)).toBe("private, no-store");
    }
  });

  it("answers an unpublished org's id and case aliases with a private 404, not a 301 that names its slug", async () => {
    const npo = await seed_npo({ published: false, slug: "hidden-org" });

    for (const param of [String(npo.id), "HIDDEN-ORG"]) {
      get_session.mockResolvedValueOnce({ user: undefined });
      const res = await respond(param).catch((e: unknown) => e);

      expect(res).toBeInstanceOf(Response);
      expect((res as Response).status).toBe(404);
      expect(cache_control(res)).toBe("private, no-store");
    }
  });

  it("shows an unpublished org to its admin at its id url, kept out of shared caches", async () => {
    const npo = await seed_npo({ published: false });
    const member = await seed_creator();
    await db()
      .insert(user_npo_memberships)
      .values({ user_id: member.id, npo_id: npo.id });
    get_session.mockResolvedValueOnce({ user: member });

    const res = await respond(String(npo.id));
    await Promise.all([res.data.funds, res.data.media, res.data.programs]);

    expect(res.data.npo.id).toBe(npo.id);
    expect(cache_control(res)).toBe("private, no-store");
  });

  it("serves a published org to the shared cache without reading the session", async () => {
    const npo = await seed_npo();
    get_session.mockClear();

    const res = await respond(npo.slug!);
    await Promise.all([res.data.funds, res.data.media, res.data.programs]);

    expect(res.data.npo.id).toBe(npo.id);
    expect(cache_control(res)).toBe(
      "public, s-maxage=60, stale-while-revalidate=300"
    );
    expect(get_session).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown org, by slug or by id", async () => {
    for (const param of ["no-such-org", "999999"]) {
      const res = await thrown(load(param));
      expect(res).toBeInstanceOf(Response);
      expect((res as Response).status).toBe(404);
    }
  });

  it("301s a slug in another case to the stored one, keeping the query", async () => {
    const npo = await seed_npo({ slug: "acme" });

    const res = await thrown(load("ACME", "?referrer=R1"));
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(301);
    expect((res as Response).headers.get("location")).toBe(
      `/org/${npo.slug}?referrer=R1`
    );
    expect((res as Response).headers.get("cache-control")).toBe(
      "public, max-age=3600, s-maxage=86400"
    );
  });

  it("answers 404 for an inactive org, by slug or by id, not the id redirect", async () => {
    const npo = await seed_npo({ active: false });

    for (const param of [npo.slug!, String(npo.id)]) {
      const res = await thrown(load(param));
      expect(res).toBeInstanceOf(Response);
      expect((res as Response).status).toBe(404);
    }
  });
});

describe("profile shape", () => {
  it("measures what the page shows: story, hero fields, and each kind of item it renders", async () => {
    const npo = await seed_npo({
      name: " Shape Org ",
      tagline: "  Water first ",
      // "We dig wells.\n\nAnd schools." as plain text, once trimmed
      overview_pt: pt("  We dig wells.", "And schools.  "),
      image: "https://img/banner.png",
      logo: null,
    });
    await seed_campaign(npo.id, "shape-cmp-1", [], {
      created_at: hours_ago(1),
    });
    await seed_campaign(npo.id, "shape-cmp-2", [], {
      created_at: hours_ago(2),
    });
    const creator = await seed_creator();
    const fund = { npo_owner: npo.id, creator_id: creator.id, published: true };
    await seed_fund(db(), { ...fund, id: "shape-fund-open" });
    await seed_fund(db(), { ...fund, id: "shape-fund-off", active: false });
    await seed_fund(db(), {
      ...fund,
      id: "shape-fund-ended",
      expiration: "2020-01-01T00:00:00.000Z",
    });
    await db().insert(programs).values({
      id: "shape-prog",
      npo_id: npo.id,
      title: "Wells",
      description_pt: "[]",
    });
    await db()
      .insert(npo_media)
      .values(
        ["shape-v1", "shape-v2", "shape-v3"].map((id) => ({
          id,
          npo_id: npo.id,
          // the third isn't on YouTube, so the page shows no player for it
          url:
            id === "shape-v3"
              ? "https://vimeo.com/123"
              : `https://youtu.be/${id}-abcd`,
          type: "video" as const,
          featured: true,
        }))
      );

    const d = await load(npo.slug!);

    expect(d.shape).toEqual({
      story_chars: 27,
      tagline_chars: 11,
      name_chars: 9,
      has_banner: true,
      has_logo: false,
      campaigns: 2,
      fundraisers: 1,
      programs: 1,
      videos: 2,
    });
    // a short story and six items, with no word from Jev
    expect([d.layout, d.layout_by]).toEqual(["hub", "threshold"]);
  });

  it("counts no programs when their read fails, and still serves the page with the failure for its section", async () => {
    const npo = await seed_npo();
    await seed_campaign(npo.id, "shape-down-cmp");
    await db().insert(programs).values({
      id: "shape-down-prog",
      npo_id: npo.id,
      title: "Wells",
      description_pt: "[]",
    });
    const down = new Error("programs down");
    vi.spyOn(program_queries, "npo_programs").mockRejectedValueOnce(down);

    const d = await load(npo.slug!);

    expect(d.npo.id).toBe(npo.id);
    expect(d.shape).toMatchObject({ campaigns: 1, programs: 0 });
    await expect(d.programs).rejects.toBe(down);
    await Promise.all([d.funds, d.media]);
  });

  it("keeps and counts the campaigns when the fundraisers' read fails, flagging the give list", async () => {
    const npo = await seed_npo();
    await seed_campaign(npo.id, "shape-funds-down-cmp");
    vi.spyOn(funds_queries, "get_funds_npo_memberof").mockRejectedValueOnce(
      new Error("funds down")
    );

    const d = await load(npo.slug!);
    await Promise.allSettled([d.funds, d.media, d.programs]);

    expect(d.lists.give.map((g) => g.id)).toEqual(["shape-funds-down-cmp"]);
    expect(d.lists.failed.give).toBe(true);
    expect(d.shape).toMatchObject({ campaigns: 1, fundraisers: 0 });
  });

  it("sends the layout's lists resolved, a campaign without the org's banner, and a failed read flagged", async () => {
    const npo = await seed_npo({ image: "https://img/org-banner.png" });
    await seed_campaign(npo.id, "lists-cmp", ["Coats for all."], {
      created_at: hours_ago(1),
      target_number: 100,
    });
    const creator = await seed_creator();
    await seed_fund(db(), {
      id: "lists-fund",
      npo_owner: npo.id,
      creator_id: creator.id,
      published: true,
    });
    vi.spyOn(program_queries, "npo_programs").mockRejectedValueOnce(
      new Error("programs down")
    );

    const before = Date.now();
    const d = await load(npo.slug!);
    await Promise.allSettled([d.funds, d.media, d.programs]);

    expect(d.lists.give.map((g) => [g.kind, g.id, g.image, g.goal])).toEqual([
      ["campaign", "lists-cmp", null, 100],
      ["supporter", "lists-fund", "https://img.co/banner.png", null],
    ]);
    expect(d.lists.failed).toEqual({
      give: false,
      programs: true,
      videos: false,
    });
    expect(d.lists.programs).toEqual([]);
    expect(d.now).toBeGreaterThanOrEqual(before);
    expect(d.now).toBeLessThanOrEqual(Date.now());
  });

  it("gives an org with no story and nothing listed the card, with no word from Jev", async () => {
    const npo = await seed_npo({ tagline: "Water first" });

    const d = await load(npo.slug!);
    await Promise.all([d.funds, d.media, d.programs]);

    expect([d.layout, d.layout_by]).toEqual(["card", "threshold"]);
  });

  it("takes the layout Jev picks from the measures", async () => {
    // no story and no items: the thresholds would say card
    const npo = await seed_npo();
    jev_choice.mockClear().mockResolvedValueOnce("letter");

    const d = await load(npo.slug!);
    await Promise.all([d.funds, d.media, d.programs]);

    expect([d.layout, d.layout_by]).toEqual(["letter", "jev"]);
    expect(jev_choice).toHaveBeenCalledWith(d.shape, expect.anything());
  });
});

describe("donor message paging", () => {
  const message = (org: string, id: string, date: string) => ({
    id,
    npo_id: org,
    donor_name: id,
    donor_message: `from ${id}`,
    date,
  });

  /** every page from the first, following `next` until it runs out */
  async function all_pages(
    org: string,
    opts: { limit: number; campaign_id?: string; with_message?: boolean }
  ) {
    const pages: string[][] = [];
    let next: string | undefined;
    do {
      const page = await donation_message_list(org, { ...opts, next });
      pages.push(page.items.map((m) => m.id));
      next = page.next;
    } while (next && pages.length < 10);
    return pages;
  }

  it("pages past a row sharing the page's last timestamp, showing each once", async () => {
    const org = String((await seed_npo()).id);
    const tied = "2026-03-01T10:00:00.123456Z";
    await db()
      .insert(donation_messages)
      .values([
        message(org, "tie-newest", "2026-03-01T11:00:00.000Z"),
        message(org, "tie-a", tied),
        message(org, "tie-b", tied),
        message(org, "tie-oldest", "2026-03-01T09:00:00.000Z"),
      ]);

    const pages = await all_pages(org, { limit: 2 });

    expect(pages).toEqual([
      ["tie-newest", "tie-b"],
      ["tie-a", "tie-oldest"],
    ]);
  });

  it("pages a date-only cursor from an older client to the rows strictly older than it", async () => {
    const org = String((await seed_npo()).id);
    const edge = "2026-04-01T10:00:00.123456Z";
    await db()
      .insert(donation_messages)
      .values([
        message(org, "legacy-newer", "2026-04-01T11:00:00.000Z"),
        message(org, "legacy-at-edge", edge),
        message(org, "legacy-older-1", "2026-04-01T09:00:00.000Z"),
        message(org, "legacy-older-2", "2026-04-01T08:00:00.000Z"),
      ]);

    const page = await donation_message_list(org, {
      limit: 1,
      next: encode_date_cursor(edge),
    });

    expect(page.items.map((m) => m.id)).toEqual(["legacy-older-1"]);
    // and what it hands back resumes in the new form, past the older row
    const after = await donation_message_list(org, {
      limit: 1,
      next: page.next,
    });
    expect(after.items.map((m) => m.id)).toEqual(["legacy-older-2"]);
    expect(after.next).toBeUndefined();
  });

  it("pages one campaign's messages newest first, a page at a time, leaving the org's others out", async () => {
    const npo = await seed_npo();
    const org = String(npo.id);
    await seed_campaign(npo.id, "msgcmp-paged");
    await seed_campaign(npo.id, "msgcmp-other");
    const tied = "2026-05-01T10:00:00.123456Z";
    const gifts: [string, string | undefined][] = [
      ["msgcmp-1", "msgcmp-paged"],
      ["msgcmp-2", "msgcmp-paged"],
      ["msgcmp-3", "msgcmp-paged"],
      ["msgcmp-4", "msgcmp-paged"],
      ["msgcmp-elsewhere", "msgcmp-other"],
      ["msgcmp-none", undefined],
    ];
    for (const [id, campaign] of gifts) {
      await seed_gift(`don-${id}`, `${id}@example.com`, npo.id, campaign);
    }
    const dated = (id: string, date: string) => ({
      ...message(org, id, date),
      donation_id: `don-${id}`,
    });
    await db()
      .insert(donation_messages)
      .values([
        dated("msgcmp-elsewhere", "2026-05-01T12:30:00.000Z"),
        dated("msgcmp-1", "2026-05-01T12:00:00.000Z"),
        dated("msgcmp-none", "2026-05-01T11:30:00.000Z"),
        dated("msgcmp-2", tied),
        dated("msgcmp-3", tied),
        dated("msgcmp-4", "2026-05-01T09:00:00.000Z"),
      ]);

    const pages = await all_pages(org, {
      limit: 2,
      campaign_id: "msgcmp-paged",
    });

    expect(pages).toEqual([
      ["msgcmp-1", "msgcmp-3"],
      ["msgcmp-2", "msgcmp-4"],
    ]);
  });

  /** the blank forms a row arrives in: settlement's "", a donor's whitespace, none */
  const blanks = ["", "   ", "\n\t", null];

  it("fills a page with_message from messages older than a run of blank rows", async () => {
    const org = String((await seed_npo()).id);
    await db()
      .insert(donation_messages)
      .values([
        ...Array.from({ length: 12 }, (_, i) => ({
          ...message(org, `run-blank-${i + 1}`, hours_ago(i + 1)),
          donor_message: blanks[i % blanks.length],
        })),
        message(org, "run-msg-1", hours_ago(13)),
        message(org, "run-msg-2", hours_ago(14)),
        message(org, "run-msg-3", hours_ago(15)),
      ]);

    const page = await donation_message_list(org, {
      limit: 10,
      with_message: true,
    });

    expect(page.items.map((m) => m.id)).toEqual([
      "run-msg-1",
      "run-msg-2",
      "run-msg-3",
    ]);
    expect(page.next).toBeUndefined();
  });

  it("pages every row, blank ones included, without with_message", async () => {
    const org = String((await seed_npo()).id);
    await db()
      .insert(donation_messages)
      .values([
        message(org, "all-1", hours_ago(1)),
        ...blanks.map((donor_message, i) => ({
          ...message(org, `all-blank-${i + 1}`, hours_ago(i + 2)),
          donor_message,
        })),
      ]);

    const pages = await all_pages(org, { limit: 3 });

    expect(pages).toEqual([
      ["all-1", "all-blank-1", "all-blank-2"],
      ["all-blank-3", "all-blank-4"],
    ]);
  });

  it("pages with_message through blanks and tied timestamps, each message once, newest first", async () => {
    const org = String((await seed_npo()).id);
    const tied = "2026-06-01T10:00:00.123456Z";
    const at = (h: number) =>
      `2026-06-01T${String(h).padStart(2, "0")}:00:00.000Z`;
    const blank = (id: string, date: string, i: number) => ({
      ...message(org, id, date),
      donor_message: blanks[i % blanks.length],
    });
    await db()
      .insert(donation_messages)
      .values([
        message(org, "mix-1", at(15)),
        blank("mix-blank-1", at(14), 0),
        blank("mix-blank-2", at(13), 1),
        message(org, "mix-2", at(12)),
        blank("mix-blank-3", tied, 2),
        message(org, "mix-tie-a", tied),
        message(org, "mix-tie-b", tied),
        blank("mix-blank-4", tied, 3),
        blank("mix-blank-5", at(9), 0),
        message(org, "mix-3", at(8)),
        blank("mix-blank-6", at(7), 1),
      ]);

    const pages = await all_pages(org, { limit: 2, with_message: true });

    expect(pages).toEqual([
      ["mix-1", "mix-2"],
      ["mix-tie-b", "mix-tie-a"],
      ["mix-3"],
    ]);
  });
});

describe("donors api", () => {
  /** every page of `/api/npo/:id/donors` from the first, following `next` */
  async function api_pages(org: string, query: Record<string, string> = {}) {
    const pages: string[][] = [];
    let next: string | undefined;
    do {
      const q = new URLSearchParams({ ...query, ...(next ? { next } : {}) });
      const res = (await donors_api.loader({
        params: { id: org },
        request: new Request(`http://localhost/api/npo/${org}/donors?${q}`),
      } as any)) as Response;
      const page: { items: { id: string }[]; next?: string } = await res.json();
      pages.push(page.items.map((m) => m.id));
      next = page.next;
    } while (next && pages.length < 10);
    return pages;
  }

  /** 11 blank rows between the newest message and the next one */
  async function seed_gap(prefix: string) {
    const org = String((await seed_npo()).id);
    await db()
      .insert(donation_messages)
      .values([
        {
          id: `${prefix}-msg-1`,
          npo_id: org,
          donor_message: "first",
          date: hours_ago(1),
        },
        ...Array.from({ length: 11 }, (_, i) => ({
          id: `${prefix}-blank-${String(i + 1).padStart(2, "0")}`,
          npo_id: org,
          donor_message: "",
          date: hours_ago(i + 2),
        })),
        {
          id: `${prefix}-msg-2`,
          npo_id: org,
          donor_message: "second",
          date: hours_ago(13),
        },
      ]);
    return org;
  }

  /** the donors feed as a resource route answers it: a Response, or the one it
   * throws, for `id` with an optional `campaign_id` */
  const donors_feed = (id: number | string, campaign_id?: string) =>
    (
      donors_api.loader({
        params: { id: String(id) },
        request: new Request(
          `http://localhost/api/npo/${id}/donors${
            campaign_id ? `?campaign_id=${campaign_id}` : ""
          }`
        ),
      } as any) as Promise<Response>
    ).catch((e: unknown) => e as Response);

  it("404s an unpublished org's campaign feed for an anonymous visitor, and an inactive org's", async () => {
    const npo = await seed_npo({ published: false });
    const cmp = `api-cmp-feed-${npo.id}`;
    await seed_campaign(npo.id, cmp);
    expect((await donors_feed(npo.id, cmp)).status).toBe(404);

    const off = await seed_npo({ active: false });
    const off_cmp = `api-cmp-off-${off.id}`;
    await seed_campaign(off.id, off_cmp);
    expect((await donors_feed(off.id, off_cmp)).status).toBe(404);
  });

  it("serves an unpublished org's campaign feed to its own admin and a platform admin, kept out of shared caches", async () => {
    const npo = await seed_npo({ published: false });
    const cmp = `api-cmp-admin-${npo.id}`;
    await seed_campaign(npo.id, cmp);
    const member = await seed_creator();
    await db()
      .insert(user_npo_memberships)
      .values({ user_id: member.id, npo_id: npo.id });
    const platform_admin = { ...(await seed_creator()), role: "admin" };

    for (const viewer of [member, platform_admin]) {
      get_session.mockResolvedValueOnce({ user: viewer });
      const res = await donors_feed(npo.id, cmp);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("answers 404 for an unpublished or inactive org's whole feed to an anonymous visitor", async () => {
    for (const o of [{ published: false }, { active: false }]) {
      const org = String((await seed_npo(o)).id);
      await db()
        .insert(donation_messages)
        .values({
          id: `api-hidden-${org}`,
          npo_id: org,
          donor_message: "hi",
          date: hours_ago(1),
        });

      expect((await donors_feed(org)).status).toBe(404);
    }
  });

  it("serves an unpublished org's whole feed to its own admin, kept out of shared caches", async () => {
    const npo = await seed_npo({ published: false });
    const member = await seed_creator();
    await db()
      .insert(user_npo_memberships)
      .values({ user_id: member.id, npo_id: npo.id });
    get_session.mockResolvedValueOnce({ user: member });

    const res = await donors_feed(npo.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("serves only messages, paged by them, given with_message=1", async () => {
    const org = await seed_gap("api-only");

    const pages = await api_pages(org, { with_message: "1" });

    expect(pages).toEqual([["api-only-msg-1", "api-only-msg-2"]]);
  });

  it("serves every row, blank ones included, without with_message", async () => {
    const org = await seed_gap("api-all");

    const pages = await api_pages(org);

    expect(pages.flat()).toHaveLength(13);
    expect(pages[0]).toEqual([
      "api-all-msg-1",
      ...Array.from(
        { length: 9 },
        (_, i) => `api-all-blank-${String(i + 1).padStart(2, "0")}`
      ),
    ]);
  });
});
