import { describe, expect, test } from "vitest";
import {
  agents_link,
  campaign_jsonld,
  fund_jsonld,
  org_jsonld,
} from "./schema-org";

const BASE = "https://www.better.giving";

const agents = [
  {
    "@type": "WebPage",
    name: "Better Giving agent guide",
    url: "https://www.better.giving/agents",
  },
  {
    "@type": "CreativeWork",
    name: "llms.txt",
    url: "https://www.better.giving/llms.txt",
    encodingFormat: "text/plain",
  },
];

describe("org_jsonld", () => {
  test("a published 501(c)(3) with every field filled", () => {
    expect(
      org_jsonld({
        base_url: BASE,
        id: 42,
        url: "https://www.better.giving/org/acme",
        name: "Acme",
        logo: "https://cdn.example/logo.png",
        image: "https://cdn.example/banner.png",
        description: "Clean water for all",
        country: "United States",
        street_address: "1 Main St, Springfield",
        ein: "12-3456789",
        registration_number: "EIN-ACME",
        website: "https://acme.org",
        socials: {
          facebook: "https://facebook.com/acme",
          twitter: undefined,
          linkedin: "",
        },
      })
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "NGO",
      "@id": "https://www.better.giving/org/acme#org",
      name: "Acme",
      url: "https://www.better.giving/org/acme",
      logo: "https://cdn.example/logo.png",
      image: "https://cdn.example/banner.png",
      description: "Clean water for all",
      address: {
        "@type": "PostalAddress",
        addressCountry: "United States",
        streetAddress: "1 Main St, Springfield",
      },
      sameAs: ["https://acme.org", "https://facebook.com/acme"],
      taxID: "12-3456789",
      nonprofitStatus: "Nonprofit501c3",
      potentialAction: {
        "@type": "DonateAction",
        recipient: { "@id": "https://www.better.giving/org/acme#org" },
        target: [
          {
            "@type": "EntryPoint",
            urlTemplate: "https://www.better.giving/donate/42",
          },
          {
            "@type": "EntryPoint",
            name: "Better Giving donation MCP server",
            urlTemplate: "https://www.better.giving/agents/mcp",
            encodingType: "application/json",
          },
        ],
      },
      subjectOf: agents,
    });
  });

  test("a bare international org leaves out every field it lacks", () => {
    const ld = org_jsonld({
      base_url: BASE,
      id: 7,
      url: "https://www.better.giving/org/7",
      name: "Bare",
      logo: "",
      image: null,
      description: "",
      country: "Kenya",
      street_address: null,
      ein: null,
      registration_number: "KE-123",
      website: undefined,
      socials: { facebook: undefined, instagram: "" },
    });

    expect(Object.keys(ld)).toEqual([
      "@context",
      "@type",
      "@id",
      "name",
      "url",
      "address",
      "potentialAction",
      "subjectOf",
    ]);
    expect(ld.address).toEqual({
      "@type": "PostalAddress",
      addressCountry: "Kenya",
    });
    expect(holes(ld)).toEqual([]);
  });

  test("an org with no country carries no address", () => {
    const ld = org_jsonld({
      base_url: BASE,
      id: 7,
      url: "https://www.better.giving/org/7",
      name: "Bare",
      country: null,
    });
    expect(ld).not.toHaveProperty("address");
    expect(holes(ld)).toEqual([]);
  });

  test.each([
    {
      case: "an approved 501(c)(3) ein wins over the registration number",
      ein: " 12-3456789 ",
      country: "United States",
      tax: { taxID: "12-3456789", nonprofitStatus: "Nonprofit501c3" },
    },
    {
      case: "a us org without an approved ein shows its registration number",
      ein: null,
      country: "United States",
      tax: { taxID: "EIN-ACME" },
    },
    {
      case: "an international org's registration number is not a tax id",
      ein: null,
      country: "Canada",
      tax: {},
    },
  ])("$case", ({ ein, country, tax }) => {
    const ld = org_jsonld({
      base_url: BASE,
      id: 1,
      url: "https://www.better.giving/org/acme",
      name: "Acme",
      country,
      ein,
      registration_number: "EIN-ACME",
    });
    expect({
      taxID: ld.taxID,
      nonprofitStatus: ld.nonprofitStatus,
    }).toEqual({ taxID: undefined, nonprofitStatus: undefined, ...tax });
  });
});

describe("campaign_jsonld", () => {
  const input = {
    base_url: BASE,
    url: "https://www.better.giving/org/acme/winter",
    name: "Winter drive",
    description: "Coats for every kid.",
    image: "https://cdn.example/hero.png",
    raised: 1250.5,
    goal: 5000,
    org: {
      url: "https://www.better.giving/org/acme",
      name: "Acme",
      logo: "https://cdn.example/mark.png",
      ein: "12-3456789",
      website: "https://acme.org",
    },
  };

  test("a public campaign with a goal", () => {
    expect(campaign_jsonld(input)).toEqual({
      "@context": "https://schema.org",
      "@type": "WebPage",
      url: "https://www.better.giving/org/acme/winter",
      name: "Winter drive",
      about: {
        "@type": "Project",
        "@id": "https://www.better.giving/org/acme/winter#campaign",
        name: "Winter drive",
        description: "Coats for every kid.",
        image: "https://cdn.example/hero.png",
        url: "https://www.better.giving/org/acme/winter",
        parentOrganization: {
          "@type": "NGO",
          "@id": "https://www.better.giving/org/acme#org",
          name: "Acme",
          url: "https://www.better.giving/org/acme",
          logo: "https://cdn.example/mark.png",
          sameAs: ["https://acme.org"],
          taxID: "12-3456789",
          nonprofitStatus: "Nonprofit501c3",
        },
        additionalProperty: [
          {
            "@type": "PropertyValue",
            name: "Fundraising goal",
            value: { "@type": "MonetaryAmount", currency: "USD", value: 5000 },
          },
          {
            "@type": "PropertyValue",
            name: "Amount raised",
            value: {
              "@type": "MonetaryAmount",
              currency: "USD",
              value: 1250.5,
            },
          },
        ],
        potentialAction: {
          "@type": "DonateAction",
          recipient: { "@id": "https://www.better.giving/org/acme#org" },
          target: [
            {
              "@type": "EntryPoint",
              urlTemplate: "https://www.better.giving/org/acme/winter",
            },
            {
              "@type": "EntryPoint",
              name: "Better Giving donation MCP server",
              urlTemplate: "https://www.better.giving/agents/mcp",
              encodingType: "application/json",
            },
          ],
        },
      },
      subjectOf: agents,
    });
  });

  test("a campaign without a goal reports only what it raised, $0 included", () => {
    const ld = campaign_jsonld({
      ...input,
      raised: 0,
      goal: null,
      org: { url: input.org.url, name: "Acme", ein: null },
    });
    const about = ld.about as Record<string, unknown>;
    expect(about.additionalProperty).toEqual([
      {
        "@type": "PropertyValue",
        name: "Amount raised",
        value: { "@type": "MonetaryAmount", currency: "USD", value: 0 },
      },
    ]);
    expect(about.parentOrganization).toEqual({
      "@type": "NGO",
      "@id": "https://www.better.giving/org/acme#org",
      name: "Acme",
      url: "https://www.better.giving/org/acme",
    });
    expect(holes(ld)).toEqual([]);
  });
});

describe("fund_jsonld", () => {
  const fund = {
    base_url: BASE,
    url: "https://www.better.giving/campaigns/f-1",
    donate_url: "https://www.better.giving/donate-fund/f-1",
    name: "Flood relief",
    description: "Rebuild after the flood.",
    image: "https://cdn.example/fund.png",
    raised: 300,
    goal: null,
  };
  const acme = {
    id: 4,
    slug: "acme",
    name: "Acme",
    logo: "https://cdn.example/a.png",
  };
  const beta = { id: 5, slug: null, name: "Beta", logo: undefined };

  test("a single-beneficiary fund names it as the parent and the recipient", () => {
    const ld = fund_jsonld({ ...fund, goal: 1000, members: [acme] });
    expect(ld.about).toEqual({
      "@type": "Project",
      "@id": "https://www.better.giving/campaigns/f-1#campaign",
      name: "Flood relief",
      description: "Rebuild after the flood.",
      image: "https://cdn.example/fund.png",
      url: "https://www.better.giving/campaigns/f-1",
      parentOrganization: {
        "@type": "NGO",
        "@id": "https://www.better.giving/org/acme#org",
        name: "Acme",
        url: "https://www.better.giving/org/acme",
        logo: "https://cdn.example/a.png",
      },
      additionalProperty: [
        {
          "@type": "PropertyValue",
          name: "Fundraising goal",
          value: { "@type": "MonetaryAmount", currency: "USD", value: 1000 },
        },
        {
          "@type": "PropertyValue",
          name: "Amount raised",
          value: { "@type": "MonetaryAmount", currency: "USD", value: 300 },
        },
      ],
      potentialAction: {
        "@type": "DonateAction",
        recipient: { "@id": "https://www.better.giving/org/acme#org" },
        target: [
          {
            "@type": "EntryPoint",
            urlTemplate: "https://www.better.giving/donate-fund/f-1",
          },
          {
            "@type": "EntryPoint",
            name: "Better Giving donation MCP server",
            urlTemplate: "https://www.better.giving/agents/mcp",
            encodingType: "application/json",
          },
        ],
      },
    });
    expect(ld.subjectOf).toEqual(agents);
  });

  test("a fund for several orgs lists them as members and names no recipient", () => {
    const ld = fund_jsonld({ ...fund, members: [acme, beta] });
    const about = ld.about as Record<string, any>;
    expect(about).not.toHaveProperty("parentOrganization");
    expect(about.member).toEqual([
      {
        "@type": "NGO",
        "@id": "https://www.better.giving/org/acme#org",
        name: "Acme",
        url: "https://www.better.giving/org/acme",
        logo: "https://cdn.example/a.png",
      },
      {
        "@type": "NGO",
        "@id": "https://www.better.giving/org/5#org",
        name: "Beta",
        url: "https://www.better.giving/org/5",
      },
    ]);
    expect(about.potentialAction).not.toHaveProperty("recipient");
    expect(about.additionalProperty).toHaveLength(1);
    expect(holes(ld)).toEqual([]);
  });
});

test("a site-relative logo or image resolves against the page", () => {
  const ld = fund_jsonld({
    base_url: BASE,
    url: "https://www.better.giving/campaigns/f-2",
    donate_url: "https://www.better.giving/donate-fund/f-2",
    name: "Harbor",
    image: "/banner.png",
    raised: 0,
    goal: null,
    members: [{ id: 6, slug: null, name: "Harbor org", logo: "/logo.png" }],
  });
  const about = ld.about as Record<string, any>;
  expect(about.image).toBe("https://www.better.giving/banner.png");
  expect(about.parentOrganization.logo).toBe(
    "https://www.better.giving/logo.png"
  );
});

test("agents_link points a reader at llms.txt", () => {
  expect(agents_link(BASE)).toEqual({
    tagName: "link",
    rel: "describedby",
    type: "text/plain",
    href: "https://www.better.giving/llms.txt",
  });
});

/** paths to every null, undefined, empty string, empty array or empty object */
function holes(x: unknown, path = "$"): string[] {
  if (x == null || x === "") return [path];
  if (Array.isArray(x)) {
    if (x.length === 0) return [path];
    return x.flatMap((v, i) => holes(v, `${path}[${i}]`));
  }
  if (typeof x === "object") {
    const entries = Object.entries(x);
    if (entries.length === 0) return [path];
    return entries.flatMap(([k, v]) => holes(v, `${path}.${k}`));
  }
  return [];
}
