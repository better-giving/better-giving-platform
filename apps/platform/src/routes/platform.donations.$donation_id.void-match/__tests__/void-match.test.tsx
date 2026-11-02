import { eq } from "drizzle-orm";
import { createRoutesStub } from "react-router";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { donations } from "$/pg/schema/donation";
import { donation_match_events } from "$/pg/schema/match";
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

vi.mock("#/.server/toast", () => ({
  // merged, not wrapped: the real helper hands the payload straight back and
  // carries the message in a cookie header, so a component reading `ok` off
  // `fetcher.data` must see the same shape here
  dataWithSuccess: vi.fn((data, toast) => ({ ...data, toast })),
  dataWithError: vi.fn((data, toast) => ({ ...data, toast })),
}));

import { dataWithError } from "#/.server/toast";
import { create_test_db } from "$/pg/test-utils/pglite";
import { action, loader } from "../api";
import Page from "../route";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

afterEach(async () => {
  await cleanup();
  vi.clearAllMocks();
});

let n = 0;
async function seed(opts: { event?: boolean; voided_at?: string } = {}) {
  const id = `don_${++n}`;
  const db = test_db.current!.db;
  await db.insert(donations).values({
    id,
    upusd: 1,
    status: "settled",
    amount_base: 100,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "crypto:eth",
  });
  if (opts.event !== false) {
    await db.insert(donation_match_events).values({
      id: `evt_${n}`,
      donation_id: id,
      pack_sent_at: new Date("2026-01-02").toISOString(),
      voided_at: opts.voided_at,
      void_reason: opts.voided_at ? "refunded" : undefined,
    });
  }
  return id;
}

function post(donation_id: string, reason?: string) {
  const body = new FormData();
  // an entirely empty FormData body fails to serialize in the browser runner,
  // and a real submit never sends one either — the omission under test is
  // `reason`, not the whole form
  body.set("form", "void-match");
  if (reason !== undefined) body.set("reason", reason);
  return {
    request: new Request(
      `http://localhost/platform/donations/${donation_id}/void-match`,
      {
        method: "POST",
        body,
      }
    ),
    params: { donation_id },
    context: {} as any,
  } as any;
}

function get(donation_id: string) {
  return {
    request: new Request(
      `http://localhost/platform/donations/${donation_id}/void-match`
    ),
    params: { donation_id },
    context: {} as any,
  } as any;
}

const event_of = async (donation_id: string) => {
  const [row] = await test_db
    .current!.db.select()
    .from(donation_match_events)
    .where(eq(donation_match_events.donation_id, donation_id));
  return row;
};

describe("void-match action", () => {
  it("rejects a reason the db check would refuse", async () => {
    const id = await seed();

    const res = (await action(post(id, "cancelled"))) as Response;

    expect(res.status).toBe(400);
    expect((await event_of(id)).voided_at).toBeNull();
  });

  it("rejects a post with no reason at all", async () => {
    const id = await seed();

    const res = (await action(post(id))) as Response;

    expect(res.status).toBe(400);
    expect((await event_of(id)).voided_at).toBeNull();
  });
});

describe("void-match loader", () => {
  it("404s a donation that never entered the match workflow", async () => {
    const id = await seed({ event: false });

    await expect(loader(get(id))).rejects.toMatchObject({ status: 404 });
  });
});

function render_modal(donation_id: string) {
  const Stub = createRoutesStub([
    {
      path: "/platform/donations/:donation_id/void-match",
      Component: Page,
      HydrateFallback: () => null,
      loader: loader as any,
      action: action as any,
    },
  ]);
  return render(
    <Stub initialEntries={[`/platform/donations/${donation_id}/void-match`]} />
  );
}

describe("void-match modal", () => {
  it("offers both reasons with the clean refund preselected, and voids", async () => {
    const id = await seed();
    const screen = await render_modal(id);

    const clean = screen.getByRole("radio", { name: "Refunded", exact: true });
    await expect.element(clean).toBeChecked();
    await expect
      .element(screen.getByRole("radio", { name: /at a loss/i }))
      .not.toBeChecked();

    (
      screen
        .getByRole("button", { name: /void match/i })
        .element() as HTMLElement
    ).click();

    await expect.element(screen.getByText("Match voided")).toBeInTheDocument();
  });

  it("an already-voided event is a record, not a form", async () => {
    const id = await seed({ voided_at: new Date("2026-02-01").toISOString() });
    const screen = await render_modal(id);

    await expect
      .element(screen.getByText(/already voided/i))
      .toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /void match/i }).query()
    ).toBeNull();
  });

  it("does not claim success when the void is refused mid-flow", async () => {
    const id = await seed();
    const screen = await render_modal(id);
    await expect
      .element(screen.getByRole("radio", { name: "Refunded", exact: true }))
      .toBeInTheDocument();

    // voided behind the open modal, so the action's gate refuses the submit
    await test_db
      .current!.db.update(donation_match_events)
      .set({
        voided_at: new Date("2026-03-01").toISOString(),
        void_reason: "refunded_loss",
      })
      .where(eq(donation_match_events.donation_id, id));

    (
      screen
        .getByRole("button", { name: /void match/i })
        .element() as HTMLElement
    ).click();

    await vi.waitFor(() =>
      expect(dataWithError).toHaveBeenCalledWith(
        { ok: false },
        "Match already voided"
      )
    );
    // the fetcher revalidates the loader, so the refusal lands the admin on the
    // record of the earlier void rather than on a success panel
    await expect
      .element(screen.getByText(/already voided/i))
      .toBeInTheDocument();
    expect(screen.getByText("Match voided").query()).toBeNull();
  });
});
