import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seed_npo } from "#/__tests__/fixtures/funds";
import { doc_args } from "#/__tests__/fixtures/route-args";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
vi.mock("$/pg/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (test_db.current!.db as any)[prop];
    },
  }),
}));

import { loader as program_loader } from "../marketplace_.$id_.program.$program_id/route";
import { loader } from "./route";

beforeAll(async () => {
  const { create_test_db } = await import("$/pg/test-utils/pglite");
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

const location = (r: Response) => [
  r.status,
  r.headers.get("location"),
  r.headers.get("cache-control"),
];
const MOVED = "public, max-age=3600, s-maxage=86400";
const call = (fn: unknown, path: string, params: object) =>
  (fn as (a: unknown) => Promise<Response>)({
    params,
    ...doc_args(new Request(`https://x${path}`)),
  });

describe("old marketplace urls", () => {
  it("301 the profile to /org/<slug|id>, keeping the query", async () => {
    const db = test_db.current!.db;
    const slugged = await seed_npo(db, {
      registration_number: "EIN-SLUG",
      published: true,
      slug: "acme",
    });
    const bare = await seed_npo(db, {
      registration_number: "EIN-BARE",
      published: true,
    });

    expect(
      location(
        await call(loader, `/marketplace/${slugged!.id}`, {
          id: String(slugged!.id),
        })
      )
    ).toEqual([301, "/org/acme", MOVED]);
    expect(
      location(await call(loader, "/marketplace/acme?x=1", { id: "acme" }))
    ).toEqual([301, "/org/acme?x=1", MOVED]);
    expect(
      location(
        await call(loader, `/marketplace/${bare!.id}`, { id: String(bare!.id) })
      )
    ).toEqual([301, `/org/${bare!.id}`, MOVED]);
  });

  it("301 a slug in any case to the stored one, and 404 an unknown slug in place", async () => {
    const db = test_db.current!.db;
    await seed_npo(db, {
      registration_number: "EIN-CASE",
      published: true,
      slug: "mixed-case",
    });

    expect(
      location(
        await call(loader, "/marketplace/Mixed-Case?x=1", { id: "Mixed-Case" })
      )
    ).toEqual([301, "/org/mixed-case?x=1", MOVED]);

    const unknown = await call(loader, "/marketplace/no-such-org", {
      id: "no-such-org",
    }).catch((e: unknown) => e);
    expect(unknown).toBeInstanceOf(Response);
    expect((unknown as Response).status).toBe(404);
  });

  it("404 an inactive org in place", async () => {
    const db = test_db.current!.db;
    const off = await seed_npo(db, {
      registration_number: "EIN-OFF",
      slug: "gone-org",
      active: false,
    });
    for (const id of ["gone-org", String(off!.id)]) {
      const res = await call(loader, `/marketplace/${id}`, { id }).catch(
        (e: unknown) => e
      );
      expect((res as Response).status).toBe(404);
    }
  });

  it("404 an unpublished org in place, naming no slug", async () => {
    const db = test_db.current!.db;
    const hidden = await seed_npo(db, {
      registration_number: "EIN-HIDDEN",
      slug: "hidden-org",
      published: false,
    });
    for (const id of ["Hidden-Org", String(hidden!.id)]) {
      const res = await call(loader, `/marketplace/${id}`, { id }).catch(
        (e: unknown) => e
      );
      expect((res as Response).status).toBe(404);
      expect((res as Response).headers.get("location")).toBeNull();
    }
  });

  it("301 an unpublished org's program to its id url, naming no slug", async () => {
    const db = test_db.current!.db;
    const npo = await seed_npo(db, {
      registration_number: "EIN-PROG-HIDDEN",
      published: false,
      slug: "hidden-wells",
    });
    const res = await call(
      program_loader,
      `/marketplace/${npo!.id}/program/p1`,
      { id: String(npo!.id), program_id: "p1" }
    );
    expect(location(res)).toEqual([301, `/org/${npo!.id}/program/p1`, MOVED]);
  });

  it("301 a program to /org/<slug|id>/program/<id>", async () => {
    const db = test_db.current!.db;
    const npo = await seed_npo(db, {
      registration_number: "EIN-PROG",
      published: true,
      slug: "wells-org",
    });
    const res = await call(
      program_loader,
      `/marketplace/${npo!.id}/program/p1`,
      { id: String(npo!.id), program_id: "p1" }
    );
    expect(location(res)).toEqual([301, "/org/wells-org/program/p1", MOVED]);
  });
});
