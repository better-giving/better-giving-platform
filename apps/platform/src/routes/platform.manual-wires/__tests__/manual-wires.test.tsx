import { eq } from "drizzle-orm";
import {
  createRoutesStub,
  isRouteErrorResponse,
  type MiddlewareFunction,
  useRouteError,
} from "react-router";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { seed_user } from "#/__tests__/fixtures/funds";
import { user } from "$/pg/schema/auth";
import { npos } from "$/pg/schema/npo";
import { manual_wires, payouts, settlements } from "$/pg/schema/payout";
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
vi.mock("$/kit/wise", () => ({ wise: {} }));
// `transfer.ts` hashes its refs with `node:crypto`, which a browser can't
// load. the refs here only need to be stable per name; the real ones, and the
// duplicate check keyed on them, are covered by manual-wire.test.ts and
// api.test.ts in the node project
vi.mock("$/payouts/transfer", async () => {
  const { payout_cents, payout_total } = await import("$/payouts/amount");
  const ref = (name: string) => {
    let h = 0;
    for (const c of name) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
    const hex = (h >>> 0).toString(16).padStart(8, "0");
    return `${hex}-0000-5000-8000-${hex.repeat(2).slice(0, 12)}`;
  };
  return {
    payout_cents,
    payout_total,
    NotFundedError: class extends Error {},
    transfer_ref: (k: string, t: number, ids: string[], n = "") =>
      ref(JSON.stringify([k, t, ids, n])),
    recovered_run_ref: (p: number | string, ids: string[]) =>
      ref(JSON.stringify(["recovered", p, ids])),
    wire_settlement_id: (provider: string, tx: string) =>
      ref(JSON.stringify(["manual_wire", provider, tx])),
  };
});

// the real guard and context; only the better-auth instance stays out of the bundle
vi.mock("#/.server/auth/auth", () => ({ auth: {} }));
vi.mock("#/.server/auth", async () => {
  const m = await import("#/.server/auth/middleware");
  return { user_ctx: m.user_ctx, admin_mdlwr: m.admin_mdlwr };
});

import { type AuthUser, admin_mdlwr, user_ctx } from "#/.server/auth";
import { mark_wired } from "$/payouts/manual-wire";
import { create_test_db } from "$/pg/test-utils/pglite";
import { action, loader } from "../api";
import WiresPage from "../route";

const db = () => test_db.current!.db;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await db().delete(payouts);
  await db().delete(manual_wires);
  await db().delete(settlements);
  await db().delete(npos);
  await db().delete(user);
});

afterEach(async () => {
  await cleanup();
});

let n = 0;
/** a nonprofit paid by manual wire, with `pending` usd of payouts pending */
async function seed_wire_npo(name: string, pending: number) {
  const [npo] = await db()
    .insert(npos)
    .values({
      registration_number: `EIN-WIRES-${++n}`,
      name,
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      cash: 1000,
      payout_method: "manual_wire",
    })
    .returning();
  await seed_payout(npo!.id, pending);
  return npo!.id;
}

async function seed_payout(npo_id: number, amount: number) {
  const id = `p-${++n}`;
  await db()
    .insert(payouts)
    .values({
      id,
      source_id: `dist-${id}`,
      npo_id,
      source: "donation",
      date: "2026-09-01T00:00:00.000Z",
      amount,
      type: "pending",
    });
}

async function seed_admin() {
  const admin = await seed_user(db(), `ops${++n}@admin.test`, "Grace", "Ops");
  await db()
    .update(user)
    .set({ emailVerified: true, role: "admin" })
    .where(eq(user.id, admin!.id));
  return admin!.id;
}

const as_user =
  (id: string, role: string): MiddlewareFunction =>
  ({ context }, next) => {
    context.set(user_ctx, { id, role } as AuthUser);
    return next();
  };

function StatusBoundary() {
  const e = useRouteError();
  return <p>status {isRouteErrorResponse(e) ? e.status : "unknown"}</p>;
}

async function open_wires() {
  const admin = await seed_admin();
  const Stub = createRoutesStub([
    {
      path: "/platform",
      middleware: [as_user(admin, "admin"), admin_mdlwr],
      ErrorBoundary: StatusBoundary,
      HydrateFallback: () => null,
      children: [
        {
          path: "manual-wires",
          Component: WiresPage as any,
          loader: loader as any,
          action: action as any,
        },
      ],
    },
  ]);
  return render(
    <Stub
      initialEntries={["/platform/manual-wires"]}
      future={{ v8_middleware: true }}
    />
  );
}

type Screen = Awaited<ReturnType<typeof render>>;

/** native clicks: the dialog's backdrop intercepts playwright's pointer */
const press = (el: Element) => (el as HTMLElement).click();

async function mark(screen: Screen, name: string, tx: string, sent: string) {
  await screen.getByRole("button", { name: `Mark wired, ${name}` }).click();
  const dialog = screen.getByRole("dialog");
  await dialog.getByLabelText("Transaction id").fill(tx);
  await dialog.getByLabelText("Amount sent").fill(sent);
  press(
    dialog.getByRole("button", { name: "Mark wired", exact: true }).element()
  );
  return dialog;
}

describe("manual wires", () => {
  it("lists each nonprofit paid by manual wire with what its wire must carry", async () => {
    await seed_wire_npo("River Trust", 4200);
    await seed_wire_npo("Lake Trust", 75.5);

    const screen = await open_wires();

    const river = screen.getByRole("row").filter({ hasText: "River Trust" });
    await expect.element(river).toMatchTextContent("$4,200.00");
    await expect.element(river).toMatchTextContent("1 payout");
    await expect.element(river).toMatchTextContent("No bank account on file");
    await expect
      .element(screen.getByRole("row").filter({ hasText: "Lake Trust" }))
      .toMatchTextContent("$75.50");
  });

  it("says no manual wires are due when none are", async () => {
    const screen = await open_wires();

    await expect.element(screen.getByText("No manual wires due")).toBeVisible();
  });

  it("marks a wire: the dialog closes with no toast, the row leaves, and focus moves to the next row's Mark wired", async () => {
    await seed_wire_npo("A Trust", 100);
    await seed_wire_npo("B Trust", 200);
    await seed_wire_npo("C Trust", 300);

    const screen = await open_wires();
    await mark(screen, "B Trust", "MT-1", "200");

    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(screen.getByText("B Trust")).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Mark wired, C Trust" }))
      .toHaveFocus();
    expect(screen.getByRole("status").query()).toBeNull();
  });

  it("after the last row, focus goes to the row above; after the only row, to the empty cell", async () => {
    await seed_wire_npo("A Trust", 100);
    await seed_wire_npo("B Trust", 200);

    const screen = await open_wires();
    await mark(screen, "B Trust", "MT-1", "200");
    await expect
      .element(screen.getByRole("button", { name: "Mark wired, A Trust" }))
      .toHaveFocus();

    await mark(screen, "A Trust", "MT-2", "100");
    await expect.element(screen.getByText("No manual wires due")).toBeVisible();
    await vi.waitFor(() =>
      expect(document.activeElement?.textContent).toContain(
        "No manual wires due"
      )
    );
  });

  it("refuses a transaction already recorded: the alert names it and the dialog stays open", async () => {
    const npo = await seed_wire_npo("River Trust", 100);
    await mark_wired({
      npo_id: npo,
      wire_date: "2026-11-18",
      amount_sent: 100,
      provider: "Mercury",
      provider_tx_id: "MT-77",
      wire_fee: 0,
    });
    await seed_payout(npo, 80);

    const screen = await open_wires();
    const dialog = await mark(screen, "River Trust", "MT-77", "80");

    await expect
      .element(dialog.getByRole("alert"))
      .toMatchTextContent(
        "Transaction MT-77 from Mercury is already recorded. Check the id with the provider."
      );
    await expect.element(screen.getByRole("dialog")).toBeVisible();
    // the open modal hides the table from role queries, so the row is read off the DOM
    expect(
      document.querySelector("tbody > tr[data-row-id]")?.textContent
    ).toContain("$80.00");
  });
});
