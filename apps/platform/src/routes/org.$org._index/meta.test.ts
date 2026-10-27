import type { MetaDescriptor } from "react-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { base_url } from "#/constants/env";
import { npos } from "$/pg/schema/npo";
import { registrations } from "$/pg/schema/registration";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

// .env.test carries a gateway key, so an unmocked layout pick would call the real gateway
vi.mock("$/jev", () => ({ jev_choice: async () => null }));

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
// the unpublished case is a previewer's render; a published org never asks
vi.mock("#/.server/can-preview", () => ({ can_preview: async () => true }));
vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: unknown) => Component,
  createClientLoaderCache: () => undefined,
}));

const { loader, meta } = await import("./route");
const { create_test_db } = await import("$/pg/test-utils/pglite");

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

type Descriptor = MetaDescriptor & Record<string, unknown>;

/** the meta a crawler reads for `/org/<param>`, from the real loader */
async function meta_of(param: string) {
  const { data: d } = await loader({
    request: new Request(`${base_url}/org/${param}`),
    params: { org: param },
  } as never);
  await Promise.all([d.funds, d.media, d.programs]);
  return (meta as any)({ loaderData: d }) as Descriptor[];
}

async function seed(
  label: string,
  slug?: string,
  o: Partial<typeof npos.$inferInsert> = {}
) {
  const [row] = await test_db
    .current!.db.insert(npos)
    .values({
      registration_number: `EIN-META-${label}`,
      name: `Meta ${label}`,
      tagline: `Tagline ${label}`,
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      published: true,
      ...(slug ? { slug } : {}),
      ...o,
    })
    .returning();
  return row!;
}

const urls_of = (ds: Descriptor[]) => ({
  canonical: ds.find((d) => d.rel === "canonical")?.href,
  og: ds.find((d) => d.property === "og:url")?.content,
  twitter: ds.find((d) => d.property === "twitter:url")?.content,
});

interface ITrail {
  itemListElement: { position: number; name: string; item: string }[];
}

const lds_of = (ds: Descriptor[]) =>
  ds
    .filter((d) => "script:ld+json" in d)
    .map((d) => d["script:ld+json"] as Record<string, any>);

const trail_of = (ds: Descriptor[]) => {
  const ld = lds_of(ds).find((x) => x["@type"] === "BreadcrumbList");
  if (!ld) throw new Error("no breadcrumb json-ld");
  return (ld as ITrail).itemListElement;
};

const ngo_of = (ds: Descriptor[]) => {
  const ld = lds_of(ds).find((x) => x["@type"] === "NGO");
  if (!ld) throw new Error("no NGO json-ld");
  return ld;
};

const describedby_of = (ds: Descriptor[]) =>
  ds.filter((d) => d.rel === "describedby");

describe("org profile meta", () => {
  it("names /org/<slug> as canonical, og url and last breadcrumb for an org with a slug", async () => {
    await seed("slugged", "meta-slugged");
    const ds = await meta_of("meta-slugged");
    const url = `${base_url}/org/meta-slugged`;

    expect(urls_of(ds)).toEqual({ canonical: url, og: url, twitter: url });
    expect(ds[0]).toEqual({ title: "Meta slugged - Better Giving" });
    expect(trail_of(ds)).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: base_url },
      {
        "@type": "ListItem",
        position: 2,
        name: "Marketplace",
        item: `${base_url}/marketplace`,
      },
      { "@type": "ListItem", position: 3, name: "Meta slugged", item: url },
    ]);
  });

  it("names /org/<id> while the org has no slug", async () => {
    const npo = await seed("bare");
    const ds = await meta_of(String(npo.id));
    const url = `${base_url}/org/${npo.id}`;

    expect(urls_of(ds)).toEqual({ canonical: url, og: url, twitter: url });
    expect(trail_of(ds).at(-1)).toMatchObject({ name: "Meta bare", item: url });
  });

  it("describes a published 501(c)(3) as an NGO an agent can donate to", async () => {
    const npo = await seed("ngo", "meta-ngo", {
      logo: "https://cdn.example/logo.png",
      image: "https://cdn.example/banner.png",
      street_address: "1 Main St",
      url: "https://meta-ngo.org",
      social_media_urls: { facebook: "https://facebook.com/meta-ngo" },
    });
    await test_db.current!.db.insert(registrations).values({
      id: "reg-meta-ngo",
      r_id: "reg-meta-ngo@test.com",
      status: "03",
      o_type: "501c3",
      o_ein: "12-3456789",
      status_approved_npo_id: npo.id,
    });
    const ds = await meta_of("meta-ngo");
    const url = `${base_url}/org/meta-ngo`;

    expect(ngo_of(ds)).toEqual({
      "@context": "https://schema.org",
      "@type": "NGO",
      "@id": `${url}#org`,
      name: "Meta ngo",
      url,
      logo: "https://cdn.example/logo.png",
      image: "https://cdn.example/banner.png",
      description: "Tagline ngo",
      address: {
        "@type": "PostalAddress",
        addressCountry: "United States",
        streetAddress: "1 Main St",
      },
      sameAs: ["https://meta-ngo.org", "https://facebook.com/meta-ngo"],
      taxID: "12-3456789",
      nonprofitStatus: "Nonprofit501c3",
      potentialAction: {
        "@type": "DonateAction",
        recipient: { "@id": `${url}#org` },
        target: [
          {
            "@type": "EntryPoint",
            urlTemplate: `${base_url}/donate/${npo.id}`,
          },
          {
            "@type": "EntryPoint",
            name: "Better Giving donation MCP server",
            urlTemplate: `${base_url}/agents/mcp`,
            encodingType: "application/json",
          },
        ],
      },
      subjectOf: [
        {
          "@type": "WebPage",
          name: "Better Giving agent guide",
          url: `${base_url}/agents`,
        },
        {
          "@type": "CreativeWork",
          name: "llms.txt",
          url: `${base_url}/llms.txt`,
          encodingFormat: "text/plain",
        },
      ],
    });
    expect(describedby_of(ds)).toEqual([
      {
        tagName: "link",
        rel: "describedby",
        type: "text/plain",
        href: `${base_url}/llms.txt`,
      },
    ]);
  });

  it("falls back to the story's excerpt and the us registration number", async () => {
    const story = JSON.stringify([
      {
        _type: "block",
        _key: "a",
        style: "normal",
        markDefs: [],
        children: [
          { _type: "span", _key: "b", text: "We dig wells.", marks: [] },
        ],
      },
    ]);
    await seed("story", "meta-story", { tagline: null, overview_pt: story });
    const ngo = ngo_of(await meta_of("meta-story"));

    expect(ngo.description).toBe("We dig wells.");
    expect(ngo.taxID).toBe("EIN-META-story");
    expect(ngo).not.toHaveProperty("nonprofitStatus");
  });

  it("gives a previewer of an unpublished org no structured data", async () => {
    const npo = await seed("hidden", undefined, { published: false });
    const ds = await meta_of(String(npo.id));

    expect(ds[0]).toEqual({ title: "Meta hidden - Better Giving" });
    expect(lds_of(ds)).toEqual([]);
    expect(describedby_of(ds)).toEqual([]);
  });
});
