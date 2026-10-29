type TNode = Record<string, unknown>;

export interface INgo {
  /** canonical profile url */
  url: string;
  name: string;
  logo?: string | null;
  image?: string | null;
  description?: string | null;
  country?: string | null;
  street_address?: string | null;
  /** an approved 501(c)(3) registration's ein */
  ein?: string | null;
  registration_number?: string | null;
  website?: string | null;
  socials?: Record<string, string | null | undefined> | null;
}

export interface INgoIn extends INgo {
  /** site origin, no trailing slash */
  base_url: string;
  id: number;
}

const org_ref = (url: string) => `${url}#org`;

/** schema.org wants absolute urls; a seeded or legacy asset can be
 * site-relative. one that can't be parsed is dropped, not thrown: a throw in
 * the route's `meta` fails the whole page */
const abs = (u: string | null | undefined, page_url: string) =>
  u && URL.canParse(u, page_url) ? new URL(u, page_url).href : undefined;

const mcp_entry = (base_url: string) => ({
  "@type": "EntryPoint",
  name: "Better Giving donation MCP server",
  urlTemplate: `${base_url}/agents/mcp`,
  encodingType: "application/json",
});

const agent_pointers = (base_url: string) => [
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
];

const donate_action = (
  base_url: string,
  form_url: string,
  recipient_url?: string
) => ({
  "@type": "DonateAction",
  recipient: recipient_url ? { "@id": org_ref(recipient_url) } : undefined,
  target: [
    { "@type": "EntryPoint", urlTemplate: form_url },
    mcp_entry(base_url),
  ],
});

/** a `<link rel="describedby">` meta descriptor for a published page */
export const agents_link = (base_url: string) => ({
  tagName: "link" as const,
  rel: "describedby",
  type: "text/plain",
  href: `${base_url}/llms.txt`,
});

/** drops every null, undefined, empty string, empty array and empty object,
 * at any depth */
function prune<T>(x: T): T {
  if (Array.isArray(x)) {
    return x.map(prune).filter((v) => !is_hole(v)) as T;
  }
  if (x && typeof x === "object") {
    const kept = Object.entries(x)
      .map(([k, v]) => [k, prune(v)] as const)
      .filter(([, v]) => !is_hole(v));
    return Object.fromEntries(kept) as T;
  }
  return x;
}

function is_hole(v: unknown): boolean {
  if (v == null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

/** an approved 501(c)(3) ein, else what a us profile labels "EIN" */
function tax_fields(o: INgo) {
  const ein = o.ein?.trim();
  if (ein) return { taxID: ein, nonprofitStatus: "Nonprofit501c3" };
  const reg = o.registration_number?.trim();
  if (reg && o.country === "United States") return { taxID: reg };
  return {};
}

function ngo_node(o: INgo): TNode {
  return {
    "@type": "NGO",
    "@id": org_ref(o.url),
    name: o.name,
    url: o.url,
    logo: abs(o.logo, o.url),
    image: abs(o.image, o.url),
    description: o.description,
    address:
      o.country || o.street_address
        ? {
            "@type": "PostalAddress",
            addressCountry: o.country,
            streetAddress: o.street_address,
          }
        : undefined,
    sameAs: [o.website, ...Object.values(o.socials ?? {})],
    ...tax_fields(o),
  };
}

export function org_jsonld(o: INgoIn): TNode {
  return prune({
    "@context": "https://schema.org",
    ...ngo_node(o),
    potentialAction: donate_action(
      o.base_url,
      `${o.base_url}/donate/${o.id}`,
      o.url
    ),
    subjectOf: agent_pointers(o.base_url),
  });
}

interface IProjectPage {
  base_url: string;
  /** canonical page url */
  url: string;
  name: string;
  description?: string | null;
  image?: string | null;
  /** usd; omitted when the page shows no raised figure */
  raised?: number;
  /** usd; null when the page shows no goal */
  goal: number | null;
  /** where the page's donate button goes */
  donate_url: string;
  /** donating is closed: the page stays, its DonateAction goes */
  closed?: boolean;
  parent?: INgo;
  members?: INgo[];
}

/** the stored total is `numeric(38,18)`; the page shows cents */
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const usd = (name: string, value: number) => ({
  "@type": "PropertyValue",
  name,
  value: { "@type": "MonetaryAmount", currency: "USD", value: cents(value) },
});

function project_page(p: IProjectPage): TNode {
  return prune({
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: p.url,
    name: p.name,
    about: {
      "@type": "Project",
      "@id": `${p.url}#campaign`,
      name: p.name,
      description: p.description,
      image: abs(p.image, p.url),
      url: p.url,
      parentOrganization: p.parent && ngo_node(p.parent),
      member: p.members?.map(ngo_node),
      additionalProperty: [
        p.goal == null ? undefined : usd("Fundraising goal", p.goal),
        p.raised == null ? undefined : usd("Amount raised", p.raised),
      ],
      potentialAction: p.closed
        ? undefined
        : donate_action(p.base_url, p.donate_url, p.parent?.url),
    },
    subjectOf: agent_pointers(p.base_url),
  });
}

export interface ICampaignIn
  extends Omit<IProjectPage, "donate_url" | "parent" | "members" | "raised"> {
  /** the campaign page always shows it */
  raised: number;
  org: INgo;
}

/** the donation form is on the campaign page itself */
export const campaign_jsonld = ({ org, ...c }: ICampaignIn): TNode =>
  project_page({ ...c, donate_url: c.url, parent: org });

export interface IFundMemberIn {
  id: number;
  slug?: string | null;
  name: string;
  logo?: string | null;
}

export interface IFundIn extends Omit<IProjectPage, "parent" | "members"> {
  members: IFundMemberIn[];
}

/** one beneficiary is the fund's organization and its gifts' recipient; with
 * several, the gift is split, so none of them is the recipient */
export function fund_jsonld({ members, ...f }: IFundIn): TNode {
  const orgs = members.map(
    (m): INgo => ({
      // the member's own canonical url, so its `@id` matches its profile's
      url: `${f.base_url}/org/${m.slug || m.id}`,
      name: m.name,
      logo: m.logo,
    })
  );
  return orgs.length === 1
    ? project_page({ ...f, parent: orgs[0] })
    : project_page({ ...f, members: orgs });
}
