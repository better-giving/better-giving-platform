import { createRoutesStub } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { ILog } from "@/nav";

vi.mock("$/pg/queries/nav", () => ({
  nav_log_list: vi.fn(),
  nav_ltd: vi.fn(),
  nav_week_series: vi.fn(),
}));
vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: any) => Component,
  createClientLoaderCache: () => undefined,
}));

import { Review } from "../platform.investments.rebalance/review";
import Page from "./route";

const ticker = (id: string) => ({
  id,
  qty: 0,
  price: 12.5,
  price_date: "2026-10-01T00:00:00.000Z",
  value: 0,
});

// every holding sold down to nothing: the composition stays, the value is 0
const empty_ltd: ILog = {
  reason: "rebalance",
  date: "2026-10-01T00:00:00.000Z",
  units: 100,
  price: 0,
  price_updated: "2026-10-01T00:00:00.000Z",
  composition: { VTI: ticker("VTI"), BND: ticker("BND") },
  value: 0,
  holders: {},
};

const held = (id: string, qty: number) => ({
  id,
  qty,
  price: 12.5,
  price_date: "2026-10-01T00:00:00.000Z",
  value: qty * 12.5,
});

// 75 of 100 in VTI, 25 in BND
const funded_ltd: ILog = {
  ...empty_ltd,
  price: 1,
  composition: { VTI: held("VTI", 6), BND: held("BND", 2) },
  value: 100,
};

describe("a portfolio worth something shows each ticker's share", () => {
  test("the composition table shows the percentage of the portfolio", async () => {
    const Stub = createRoutesStub([
      {
        path: "/platform/investments",
        Component: Page as any,
        loader: () => ({
          ltd: funded_ltd,
          logs: [],
          recent_logs: { items: [] },
        }),
      },
    ]);
    const screen = await render(
      <Stub initialEntries={["/platform/investments"]} />
    );

    const vti = screen.getByRole("row", { name: /VTI/ });
    await expect.element(vti).toBeVisible();
    expect(vti.getByRole("cell").elements().at(-1)?.textContent).toMatch(
      /^75(\.0+)?%$/
    );
    const bnd = screen.getByRole("row", { name: /BND/ });
    expect(bnd.getByRole("cell").elements().at(-1)?.textContent).toMatch(
      /^25(\.0+)?%$/
    );
    expect(screen.container.textContent).not.toMatch(/NaN/);
  });

  test("the rebalance review shows the share it had", async () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <Review fv={{ bals: {}, txs: [] } as any} ltd={funded_ltd} />
        ),
      },
    ]);
    const screen = await render(<Stub initialEntries={["/"]} />);

    const row = screen.getByRole("row", { name: /VTI/ });
    await expect.element(row).toBeVisible();
    expect(row.getByRole("cell").elements().at(-1)?.textContent).toMatch(
      /^75(\.0+)?%$/
    );
    expect(screen.container.textContent).not.toMatch(/NaN/);
  });
});

describe("a portfolio worth nothing has no share per ticker", () => {
  test("the composition table shows a dash in the % column, never NaN", async () => {
    const Stub = createRoutesStub([
      {
        path: "/platform/investments",
        Component: Page as any,
        loader: () => ({
          ltd: empty_ltd,
          logs: [],
          recent_logs: { items: [] },
        }),
      },
    ]);
    const screen = await render(
      <Stub initialEntries={["/platform/investments"]} />
    );

    const row = screen.getByRole("row", { name: /VTI/ });
    await expect.element(row).toBeVisible();
    const cells = row.getByRole("cell").elements();
    expect(cells.at(-1)?.textContent).toBe("—");
    expect(screen.container.textContent).not.toMatch(/NaN/);
  });

  test("the rebalance review shows a dash for the share it had, never NaN", async () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <Review fv={{ bals: {}, txs: [] } as any} ltd={empty_ltd} />
        ),
      },
    ]);
    const screen = await render(<Stub initialEntries={["/"]} />);

    const row = screen.getByRole("row", { name: /VTI/ });
    await expect.element(row).toBeVisible();
    const cells = row.getByRole("cell").elements();
    expect(cells.at(-1)?.textContent).toBe("—");
    expect(screen.container.textContent).not.toMatch(/NaN/);
  });
});
