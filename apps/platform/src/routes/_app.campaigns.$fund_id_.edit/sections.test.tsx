import { createRoutesStub } from "react-router";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { seed_fund, seed_user } from "#/__tests__/fixtures/funds";
import { user } from "$/pg/schema/auth";
import { funds } from "$/pg/schema/fund";
import type { TestDb } from "$/pg/test-utils/pglite";

// --- mocks (hoisted) ---

const NEW_LOGO = vi.hoisted(() => "https://img.co/new-logo.png");
const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const session = vi.hoisted(() => ({ user: null as any }));

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
vi.mock("#/.server/auth", async () => ({
  ...(await import("$/auth/test-utils")).make_auth_mock(),
  get_session: vi.fn(async () => session),
}));
vi.mock("#/.server/toast", () => ({
  dataWithSuccess: vi.fn((d: unknown, _msg: string) => d),
  dataWithError: vi.fn((d: unknown, _msg: string) => d),
}));
// the dropzone's crop + upload is its own suite's; here only the value it
// reports matters to the section
const img_editor = vi.hoisted(() => ({ real: false }));
vi.mock("#/components/img-editor", async (original) => {
  const mod = await original<typeof import("#/components/img-editor")>();
  return {
    ...mod,
    ImgEditor: (props: any) =>
      img_editor.real ? (
        <mod.ImgEditor {...props} />
      ) : (
        <StubImgEditor {...props} />
      ),
  };
});
function StubImgEditor({ id, on_change }: any) {
  return (
    <>
      <button type="button" onClick={() => on_change("loading")}>
        {`upload ${id}`}
      </button>
      <button type="button" onClick={() => on_change(NEW_LOGO)}>
        {`finish ${id}`}
      </button>
    </>
  );
}

// --- imports (after mocks hoisted) ---

import { fund_get_or_slug } from "$/pg/queries/fund";
import { create_test_db } from "$/pg/test-utils/pglite";
import { action, loader } from "./api";
import EditPage from "./route";

const db = () => test_db.current!.db;
const FUND_ID = "3b9c7a52-0f4e-4d0a-9a51-6c2e8f1d7b40";

const DESCRIPTION = JSON.stringify([
  {
    _type: "block",
    _key: "b1",
    style: "normal",
    markDefs: [],
    children: [{ _type: "span", _key: "s1", text: "About us", marks: [] }],
  },
]);

/** the PATCH bodies the page sent, in order */
let sent: Record<string, unknown>[] = [];
/** set to hold the action open, so a test can read a save in flight */
let gate: Promise<void> | null = null;
const recording: typeof action = async (args) => {
  sent.push(await args.request.clone().json());
  if (gate) await gate;
  return action(args);
};

async function render_edit() {
  const Stub = createRoutesStub([
    {
      path: "/campaigns/:fund_id/edit",
      Component: EditPage as any,
      HydrateFallback: () => null,
      loader: loader as any,
      action: recording as any,
    },
  ]);
  return await render(<Stub initialEntries={[`/campaigns/${FUND_ID}/edit`]} />);
}

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  sent = [];
  gate = null;
  img_editor.real = false;
  await db().delete(funds);
  await db().delete(user);
  const admin = await seed_user(db(), "admin@test.com");
  session.user = { ...admin, role: "admin" };
  await seed_fund(db(), {
    id: FUND_ID,
    name: "Original",
    description_pt: DESCRIPTION,
    target_smart: true,
    npo_owner: null,
    creator_id: admin.id,
  });
});

describe("campaign edit — per-section save", () => {
  it("each section's save stays disabled until that section is dirty", async () => {
    const screen = await render_edit();
    const name = screen.getByLabelText(/name/i);
    await expect.element(name).toHaveDisplayValue("Original");

    await expect.element(screen.getByLabelText("Campaign link")).toBeVisible();
    await expect
      .element(screen.getByText(/Letters, numbers, and - \. _ ~ only/))
      .toBeVisible();
    const general = screen.getByRole("button", { name: "Save general" });
    const media = screen.getByRole("button", { name: "Save media" });
    const goal = screen.getByRole("button", { name: "Save goal and amounts" });
    await expect.element(general).toHaveAttribute("aria-disabled", "true");
    await expect.element(media).toHaveAttribute("aria-disabled", "true");
    await expect.element(goal).toHaveAttribute("aria-disabled", "true");

    await name.fill("Renamed");
    await expect.element(general).not.toHaveAttribute("aria-disabled");
    await expect.element(media).toHaveAttribute("aria-disabled", "true");
    await expect.element(goal).toHaveAttribute("aria-disabled", "true");
  });

  it("saving goal sends only its fields; an unsaved general edit survives", async () => {
    const screen = await render_edit();
    const name = screen.getByLabelText(/name/i);
    await expect.element(name).toHaveDisplayValue("Original");

    await name.fill("Unsaved name");
    await screen.getByText("No goal or progress bar").click();
    const goal = screen.getByRole("button", { name: "Save goal and amounts" });
    await goal.click();

    await vi.waitFor(async () =>
      expect((await fund_get_or_slug(FUND_ID))?.target).toBe("0")
    );
    expect(sent).toEqual([{ target: "0" }]);
    expect((await fund_get_or_slug(FUND_ID))?.name).toBe("Original");

    // goal settles clean on the revalidated read; general keeps its unsaved edit
    await expect.element(goal).toHaveAttribute("aria-disabled", "true");
    await expect.element(name).toHaveDisplayValue("Unsaved name");
    const general = screen.getByRole("button", { name: "Save general" });
    await expect.element(general).not.toHaveAttribute("aria-disabled");

    await general.click();
    await vi.waitFor(async () =>
      expect((await fund_get_or_slug(FUND_ID))?.name).toBe("Unsaved name")
    );
    expect(sent[1]).toEqual({ name: "Unsaved name" });
    await expect.element(general).toHaveAttribute("aria-disabled", "true");
  });

  it("a pressed save keeps focus, reads Saving…, and a second press sends nothing", async () => {
    const screen = await render_edit();
    const name = screen.getByLabelText(/name/i);
    await expect.element(name).toHaveDisplayValue("Original");
    await name.fill("Held name");

    let release = () => {};
    gate = new Promise((r) => {
      release = r;
    });
    const save = screen.getByRole("button", { name: /save general/i });
    await save.click();
    const saving = screen.getByRole("button", {
      name: "Saving general…",
      exact: true,
    });
    await expect.element(saving).toHaveFocus();
    await expect.element(saving).toHaveAttribute("aria-disabled", "true");
    (saving.element() as HTMLElement).click();
    await userEvent.keyboard("{Enter}");

    release();
    await vi.waitFor(async () =>
      expect((await fund_get_or_slug(FUND_ID))?.name).toBe("Held name")
    );
    const saved = screen.getByRole("button", {
      name: "Save general",
      exact: true,
    });
    await expect.element(saved).toHaveAttribute("aria-disabled", "true");
    await expect.element(saved).toHaveFocus();
    expect(sent).toEqual([{ name: "Held name" }]);
  });

  it("media save holds while an image uploads, then sends only media", async () => {
    const screen = await render_edit();
    await expect
      .element(screen.getByLabelText(/name/i))
      .toHaveDisplayValue("Original");
    const media = screen.getByRole("button", { name: "Save media" });

    await screen.getByRole("button", { name: "upload fund-logo" }).click();
    await expect.element(media).toHaveAttribute("aria-disabled", "true");
    // a held press: playwright's own click waits out aria-disabled
    (media.element() as HTMLElement).click();
    expect(sent).toEqual([]);

    await screen.getByRole("button", { name: "finish fund-logo" }).click();
    await expect.element(media).not.toHaveAttribute("aria-disabled");
    await media.click();
    await vi.waitFor(async () =>
      expect((await fund_get_or_slug(FUND_ID))?.logo).toBe(NEW_LOGO)
    );
    expect(sent).toEqual([{ logo: NEW_LOGO }]);
    await expect.element(media).toHaveAttribute("aria-disabled", "true");
  });

  it("an invalid general field shows in general and does not block saving goal", async () => {
    const screen = await render_edit();
    const name = screen.getByLabelText(/name/i);
    await expect.element(name).toHaveDisplayValue("Original");

    await name.clear();
    await screen.getByRole("button", { name: "Save general" }).click();
    const general = screen.getByRole("region", { name: "General" });
    await expect.element(general.getByText(/required/i)).toBeVisible();
    expect(sent).toEqual([]);

    await screen.getByText("No goal or progress bar").click();
    await screen.getByRole("button", { name: "Save goal and amounts" }).click();
    await vi.waitFor(async () =>
      expect((await fund_get_or_slug(FUND_ID))?.target).toBe("0")
    );
    expect(sent).toEqual([{ target: "0" }]);
    expect((await fund_get_or_slug(FUND_ID))?.name).toBe("Original");
  });

  it("keeps the media card inside a 375px screen", async () => {
    img_editor.real = true;
    await page.viewport(375, 667);
    try {
      const screen = await render_edit();
      const media = screen.getByRole("region", { name: "Media" });
      await expect.element(media).toBeVisible();
      await vi.waitFor(() => {
        const card = media.element() as HTMLElement;
        expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
        const doc = document.documentElement;
        expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth);
      });
    } finally {
      await page.viewport(1280, 900);
    }
  });
});
