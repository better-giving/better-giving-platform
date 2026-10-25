import { describe, expect, it } from "vitest";
import type { IFundItem } from "@/campaign";
import type { IMedia, IProgramDb } from "@/npo";
import {
  campaign_give,
  fund_give,
  layout_lists,
  org_credential,
  shape_counts,
} from "./layout-data";

const NPO_ID = 7;

/** portable text, one block per paragraph */
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

const fund = (o: Partial<IFundItem> = {}): IFundItem => ({
  id: "f1",
  name: "Coat drive",
  description_pt: "[]",
  logo: "",
  banner: "",
  published: true,
  target: "",
  npo_owner: NPO_ID,
  active: true,
  donation_total_usd: 40,
  creator_id: "u1",
  creator_name: "Jane Doe",
  // the list read's sentinel for a fund with no expiration
  expiration: 253402300799,
  ...o,
});

describe("fund as a give item", () => {
  it("has no end date when the fund never expires", () => {
    expect(fund_give(fund(), NPO_ID).ends_at).toBeNull();
  });

  it("ends at noon UTC the day after its expiration date, the hour it closes everywhere", () => {
    // expiring five days from now
    const expires = Date.parse("2026-10-28T00:00:00Z") / 1000;
    const { ends_at } = fund_give(fund({ expiration: expires }), NPO_ID);
    expect(ends_at).toBe("2026-10-29T12:00:00.000Z");
  });

  it("carries no byline when the org runs it, its creator's otherwise", () => {
    expect(fund_give(fund(), NPO_ID).byline).toBeNull();
    expect(fund_give(fund({ npo_owner: 99 }), NPO_ID).byline).toBe(
      "by Jane Doe"
    );
  });

  it("links the fundraiser with its banner, else its logo, and its goal by the cards' rule", () => {
    expect(
      fund_give(
        fund({
          banner: "https://img/b.png",
          logo: "https://img/l.png",
          target: "100",
          description_pt: pt("Coats for every child."),
        }),
        NPO_ID
      )
    ).toEqual({
      kind: "supporter",
      id: "f1",
      title: "Coat drive",
      to: "/fundraisers/f1",
      image: "https://img/b.png",
      raised: 40,
      goal: 100,
      ends_at: null,
      byline: null,
      excerpt: "Coats for every child.",
    });
    const bare = fund_give(fund({ logo: "https://img/l.png" }), NPO_ID);
    expect([bare.image, bare.goal]).toEqual(["https://img/l.png", null]);
  });
});

describe("campaign as a give item", () => {
  const campaign = {
    id: "c1",
    name: "Winter coats",
    to: "/org/acme/winter",
    banner: null,
    raised: 50,
    target: "100",
    with_org: null,
    ends_at: "2026-11-01T00:00:00.000Z",
    excerpt: "Coats for every child",
  };

  it("shows only its own banner, never the org's in its place", () => {
    expect(campaign_give(campaign).image).toBeNull();
    expect(
      campaign_give({ ...campaign, banner: "https://img/own.png" }).image
    ).toBe("https://img/own.png");
  });

  it("names the org it runs with when it is another org's, none when it is this org's", () => {
    expect(campaign_give(campaign)).toEqual({
      kind: "campaign",
      id: "c1",
      title: "Winter coats",
      to: "/org/acme/winter",
      image: null,
      raised: 50,
      goal: 100,
      ends_at: "2026-11-01T00:00:00.000Z",
      byline: null,
      excerpt: "Coats for every child",
    });
    expect(campaign_give({ ...campaign, with_org: "Acme" }).byline).toBe(
      "with Acme"
    );
  });
});

describe("org credential", () => {
  it("labels a US org's registration as its EIN, trimmed", () => {
    expect(
      org_credential({
        registration_number: " 12-3456789 ",
        hq_country: "United States",
      })
    ).toEqual({ label: "EIN", value: "12-3456789" });
  });

  it("labels any other org's as its registration number", () => {
    expect(
      org_credential({ registration_number: "CH-77", hq_country: "Kenya" })
    ).toEqual({ label: "Registration no.", value: "CH-77" });
  });

  it("is absent when the org has none on file", () => {
    expect(
      org_credential({ registration_number: "  ", hq_country: "Kenya" })
    ).toBeNull();
  });
});

describe("layout lists", () => {
  const ok = <T>(value: T) => ({ status: "fulfilled" as const, value });
  const down = { status: "rejected" as const, reason: new Error("down") };
  const npo = { id: NPO_ID, slug: "acme" };
  const program: IProgramDb = {
    id: "p1",
    title: "Wells",
    description_pt: pt("We dig wells.", "And schools."),
    banner: "https://img/p.png",
    target_raise: 500,
    total_donations: 120,
  };
  const video = (id: string, url: string): IMedia => ({
    id,
    url,
    type: "video",
    featured: true,
    date_created: "2026-10-01",
  });
  const NOW = new Date("2026-10-23T09:00:00Z");
  const campaign = {
    id: "c1",
    name: "Winter coats",
    to: "/org/acme/winter",
    banner: null,
    raised: 0,
    with_org: null,
    ends_at: null,
    excerpt: "",
  };

  it("empties a list whose read failed and flags it, leaving the others", () => {
    const lists = layout_lists({
      npo,
      campaigns: [],
      funds: ok([fund()]),
      programs: down,
      media: ok([]),
      now: NOW,
    });
    expect(lists.failed).toEqual({
      give: false,
      programs: true,
      videos: false,
    });
    expect(lists.programs).toEqual([]);
    expect(lists.give.map((g) => g.id)).toEqual(["f1"]);

    const no_funds = layout_lists({
      npo,
      campaigns: [],
      funds: down,
      programs: ok([]),
      media: down,
      now: NOW,
    });
    expect(no_funds.failed).toEqual({
      give: true,
      programs: false,
      videos: true,
    });
    expect([no_funds.give, no_funds.videos]).toEqual([[], []]);
  });

  it("keeps the campaigns when the fundraisers' read fails, flagging the give list", () => {
    const lists = layout_lists({
      npo,
      campaigns: [campaign],
      funds: down,
      programs: ok([]),
      media: ok([]),
      now: NOW,
    });
    expect(lists.give.map((g) => [g.kind, g.id])).toEqual([["campaign", "c1"]]);
    expect(lists.failed.give).toBe(true);
  });

  it("gives the campaigns first, then only the open fundraisers", () => {
    const { give } = layout_lists({
      npo,
      campaigns: [
        {
          id: "c1",
          name: "Winter coats",
          to: "/org/acme/winter",
          banner: null,
          raised: 0,
          with_org: null,
          ends_at: null,
          excerpt: "",
        },
      ],
      funds: ok([
        fund({ id: "f-closed", active: false }),
        fund({ id: "f-ended", expiration: Date.parse("2020-01-01") / 1000 }),
        fund({ id: "f-open" }),
      ]),
      programs: ok([]),
      media: ok([]),
      now: NOW,
    });
    expect(give.map((g) => [g.kind, g.id])).toEqual([
      ["campaign", "c1"],
      ["supporter", "f-open"],
    ]);
  });

  it("links each program under the org, with a plain summary and its goal", () => {
    const { programs } = layout_lists({
      npo,
      campaigns: [],
      funds: ok([]),
      programs: ok([program, { ...program, id: "p2", target_raise: null }]),
      media: ok([]),
      now: NOW,
    });
    expect(programs[0]).toEqual({
      kind: "program",
      id: "p1",
      title: "Wells",
      to: "/org/acme/program/p1",
      image: "https://img/p.png",
      summary: "We dig wells. And schools.",
      goal: 500,
      raised: 120,
    });
    expect(programs[1].goal).toBeNull();
  });

  it("keeps only the YouTube videos, untitled", () => {
    const { videos } = layout_lists({
      npo,
      campaigns: [],
      funds: ok([]),
      programs: ok([]),
      media: ok([
        video("v1", "https://youtu.be/dQw4w9WgXcQ"),
        video("v2", "https://vimeo.com/123"),
      ]),
      now: NOW,
    });
    expect(videos).toEqual([
      {
        kind: "video",
        id: "v1",
        url: "https://youtu.be/dQw4w9WgXcQ",
        title: null,
      },
    ]);
  });

  it("counts for the shape only what the lists render", () => {
    const lists = layout_lists({
      npo,
      campaigns: [campaign],
      funds: down,
      programs: ok([program]),
      media: ok([
        video("v1", "https://youtu.be/dQw4w9WgXcQ"),
        video("v2", "https://vimeo.com/123"),
      ]),
      now: NOW,
    });
    expect(shape_counts(lists)).toEqual({
      campaigns: 1,
      fundraisers: 0,
      programs: 1,
      videos: 1,
    });
  });
});
