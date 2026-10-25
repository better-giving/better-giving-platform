import { createRoutesStub } from "react-router";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { seed_contribution } from "#/__tests__/fixtures/contributions";
import { seed_npo } from "#/__tests__/fixtures/funds";
import { npo, org_figures } from "#/__tests__/fixtures/org-layout";
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

vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: any) => Component,
  createClientLoaderCache: () => undefined,
}));

vi.mock("#/.server/auth", () => ({
  get_session: vi.fn(async () => ({ user: undefined })),
}));

// the payment steps are not under test
vi.mock("#/components/donation", () => ({
  Steps: () => <div data-testid="steps" />,
}));

import { create_test_db } from "$/pg/test-utils/pglite";
import Page, { loader } from "./route";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await cleanup();
});

afterEach(async () => {
  await cleanup();
});

describe("donate page", () => {
  test("shows the org's identity and none of its stored goal or raised total", async () => {
    const db = test_db.current!.db;
    const org = await seed_npo(db, {
      registration_number: "EIN-DONATE",
      name: "Riverside Literacy",
      tagline: "Every adult a reader.",
      published: true,
      target_number: 8000,
    });
    await seed_contribution(db, org.id, 3000);
    await seed_contribution(db, org.id, 322);

    const Stub = createRoutesStub([
      {
        path: "/donate/:id",
        Component: Page,
        HydrateFallback: () => null,
        loader,
      },
    ]);
    const screen = await render(
      <Stub initialEntries={[`/donate/${org.id}`]} />
    );

    const name = screen.getByRole("link", { name: "Riverside Literacy" });
    await expect.element(name).toBeVisible();
    await expect
      .element(screen.getByText("Every adult a reader.", { exact: true }))
      .toBeVisible();

    expect(
      org_figures(
        screen.container,
        npo({ contributions_total: 3322, contributions_count: 2 })
      )
    ).toEqual([]);
    expect(screen.container).not.toMatchTextContent(/8,000|3,322/);
  });
});
