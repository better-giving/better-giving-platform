import type { MetaDescriptor } from "react-router";
import { describe, expect, test } from "vitest";
import { base_url } from "#/constants/env";
import { loader, meta } from "./route";

describe("compare index meta", () => {
  test("title, description, canonical and og url come from the data", () => {
    const d = loader();
    const ds = meta({ loaderData: d } as never) as (MetaDescriptor &
      Record<string, unknown>)[];
    expect(ds.find((x) => "title" in x)?.title).toBe(d.index.seo_title);
    expect(ds.find((x) => x.name === "description")?.content).toBe(
      d.index.meta_description
    );
    expect(ds.find((x) => x.rel === "canonical")?.href).toBe(
      `${base_url}/compare`
    );
    expect(ds.find((x) => x.property === "og:url")?.content).toBe(
      `${base_url}/compare`
    );
    expect(ds.find((x) => x.property === "og:title")?.content).toBe(
      d.index.seo_title
    );
    expect(ds.find((x) => x.property === "og:description")?.content).toBe(
      d.index.meta_description
    );
  });
});
