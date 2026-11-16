import type { MetaDescriptor } from "react-router";
import { describe, expect, test } from "vitest";
import { split_suits } from "#/components/compare/format";
import { base_url } from "#/constants/env";
import { compare_pages } from "#/content/compare/data";
import { loader, meta } from "./route";

type Meta = (MetaDescriptor & Record<string, unknown>)[];

const run_loader = (slug: string) =>
  loader({ params: { slug } } as never) as ReturnType<typeof loader>;

const run_meta = (slug: string) =>
  meta({ loaderData: run_loader(slug) } as never) as Meta;

describe("compare slug loader", () => {
  test("an unknown slug is a 404, not an empty page", () => {
    let thrown: unknown;
    try {
      run_loader("not-a-platform");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
  });

  test("every page answers its own slug and lists all eighteen chips", () => {
    expect(compare_pages).toHaveLength(18);
    for (const p of compare_pages) {
      const d = run_loader(p.slug);
      expect(d.page.slug).toBe(p.slug);
      expect(d.chips.map((c) => c.slug)).toEqual(
        compare_pages.map((x) => x.slug)
      );
    }
  });
});

describe("compare slug meta", () => {
  test.each(compare_pages.map((p) => p.slug))(
    "%s: title, description, canonical and og url come from the data",
    (slug) => {
      const page = run_loader(slug).page;
      const ds = run_meta(slug);
      const url = `${base_url}/compare/${slug}`;
      expect(ds.find((d) => "title" in d)?.title).toBe(page.seo_title);
      expect(ds.find((d) => d.name === "description")?.content).toBe(
        page.meta_description
      );
      expect(ds.find((d) => d.rel === "canonical")?.href).toBe(url);
      expect(ds.find((d) => d.property === "og:url")?.content).toBe(url);
      expect(ds.find((d) => d.property === "og:title")?.content).toBe(
        page.seo_title
      );
      expect(ds.find((d) => d.property === "og:description")?.content).toBe(
        page.meta_description
      );
    }
  );

  test("the FAQPage json-ld carries the page's own questions and answers", () => {
    for (const p of compare_pages) {
      const ld = run_meta(p.slug)
        .map((d) => d["script:ld+json"] as Record<string, unknown> | undefined)
        .find((b) => b?.["@type"] === "FAQPage");
      const main = ld?.mainEntity as {
        name: string;
        acceptedAnswer: { text: string };
      }[];
      expect(main.map((m) => m.name)).toEqual(p.faq.map((f) => f.q));
      expect(main.map((m) => m.acceptedAnswer.text)).toEqual(
        p.faq.map((f) => f.a)
      );
    }
  });
});

describe("compare data the pages lean on", () => {
  test("every row source id is in the page's sources list", () => {
    for (const p of compare_pages) {
      const ids = new Set(p.sources.map((s) => s.id));
      for (const r of p.rows)
        for (const id of [...r.better_giving_sources, ...r.competitor_sources])
          expect(ids.has(id), `${p.slug}: ${id}`).toBe(true);
    }
  });

  test("twelve core rows lead every page", () => {
    for (const p of compare_pages)
      expect(p.rows.filter((r) => r.core)).toHaveLength(12);
  });

  test("who_each_suits is one claim per platform on every page", () => {
    for (const p of compare_pages) {
      const parts = split_suits(p.who_each_suits);
      expect(parts, p.slug).toHaveLength(2);
      expect(parts[1]).toMatch(/^Better Giving suits /);
      expect(`${parts[0]} ${parts[1]}`).toBe(p.who_each_suits);
    }
  });
});
