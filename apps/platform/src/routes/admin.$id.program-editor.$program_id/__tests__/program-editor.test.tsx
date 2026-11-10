const crypto = globalThis.crypto;

import { eq } from "drizzle-orm";
import {
  createRoutesStub,
  RouterContextProvider,
  useFetcher,
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
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { npos } from "$/pg/schema/npo";
import { milestones, programs } from "$/pg/schema/program";
import type { TestDb } from "$/pg/test-utils/pglite";

// --- mocks (hoisted) ---

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

vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock()
);

vi.mock("#/.server/toast", () => ({
  dataWithSuccess: vi.fn((_d: unknown, msg: string) => ({ toast: msg })),
  dataWithError: vi.fn((_d: unknown, msg: string) => ({ error: msg })),
}));

vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: any) => Component,
  createClientLoaderCache: () => undefined,
}));

// --- imports (after mocks hoisted) ---

import ProfileProgramPage, {
  loader as profile_program_loader,
} from "#/routes/org.$org.program.$program_id/route";
import { admin_ctx } from "$/auth/test-utils";
import { create_test_db } from "$/pg/test-utils/pglite";
import { action, loader } from "../api";
import ProgramEditorPage from "../route";

// --- seed constants ---

const NPO_SEED: Omit<typeof npos.$inferInsert, "id"> = {
  registration_number: "EIN-TEST",
  name: "Test NPO",
  endow_designation: "Charity",
  overview_pt: "[]",
  hq_country: "United States",
};

// --- lifecycle ---

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await test_db.current!.db.delete(milestones);
  await test_db.current!.db.delete(programs);
  await test_db.current!.db.delete(npos);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- helpers ---

async function seed_npo(
  overrides: Partial<Omit<typeof npos.$inferInsert, "id">> = {}
) {
  const [row] = await test_db
    .current!.db.insert(npos)
    .values({ ...NPO_SEED, ...overrides })
    .returning();
  return row;
}

async function seed_program(
  npo_id: number,
  overrides: Partial<Omit<typeof programs.$inferInsert, "npo_id">> = {}
) {
  const desc =
    overrides.description_pt ?? "Providing clean water to communities";
  const [row] = await test_db
    .current!.db.insert(programs)
    .values({
      id: crypto.randomUUID(),
      npo_id,
      title: "Clean Water Initiative",
      description_pt: desc,
      description_v2: overrides.description_v2 ?? desc,
      banner: "https://example.com/banner.jpg",
      target_raise: 50000,
      total_donations: 0,
      created_at: new Date().toISOString(),
      ...overrides,
    })
    .returning();
  return row;
}

async function seed_milestone(
  program_id: string,
  overrides: Partial<Omit<typeof milestones.$inferInsert, "program_id">> = {}
) {
  const [row] = await test_db
    .current!.db.insert(milestones)
    .values({
      id: crypto.randomUUID(),
      program_id,
      date: new Date("2025-06-15").toISOString(),
      title: "Phase 1 Complete",
      description_pt: overrides.description_pt ?? "First well installed",
      description_v2: overrides.description_v2 ?? "First well installed",
      ...overrides,
    })
    .returning();
  return row;
}

async function get_milestones(program_id: string) {
  return test_db
    .current!.db.select()
    .from(milestones)
    .where(eq(milestones.program_id, program_id));
}

function render_editor(npo_id: number, programId: string) {
  const Stub = createRoutesStub([
    {
      path: "/admin/:id/program-editor/:program_id",
      Component: ProgramEditorPage,
      HydrateFallback: () => null,
      loader: loader as any,
      action: action as any,
      middleware: [
        async ({ context }, next) => {
          context.set(admin_ctx, npo_id);
          return next();
        },
      ],
    },
  ]);

  return render(
    <Stub
      initialEntries={[`/admin/${npo_id}/program-editor/${programId}`]}
      future={{ v8_middleware: true }}
    />
  );
}

function render_program_profile(npo_id: number, programId: string) {
  const Stub = createRoutesStub([
    {
      path: "/org/:org/program/:program_id",
      Component: ProfileProgramPage as any,
      HydrateFallback: () => null,
      loader: profile_program_loader as any,
    },
  ]);

  return render(
    <Stub initialEntries={[`/org/${npo_id}/program/${programId}`]} />
  );
}

// --- tests ---

describe("program editor -- renders pre-filled", () => {
  it("shows seeded program data in form fields", async () => {
    const npo = await seed_npo();
    const prog = await seed_program(npo.id);
    await seed_milestone(prog.id);

    const screen = await render_editor(npo.id, prog.id);

    await expect
      .element(screen.getByLabelText(/title of program/i))
      .toHaveDisplayValue("Clean Water Initiative");

    await expect
      .element(screen.getByLabelText(/target amount/i))
      .toHaveDisplayValue("50,000");

    // save button disabled when not dirty
    const save_btns = screen.getByRole("button", { name: /save changes/i });
    await expect.element(save_btns.nth(0)).toBeDisabled();

    // milestone header visible
    await expect
      .element(screen.getByText("Phase 1 Complete"))
      .toBeInTheDocument();
  });

  it("shows 'No milestones' when program has none", async () => {
    const npo = await seed_npo();
    const prog = await seed_program(npo.id);

    const screen = await render_editor(npo.id, prog.id);

    await expect
      .element(screen.getByText(/no milestones/i))
      .toBeInTheDocument();
  });
});

describe("program editor -- edit program info", () => {
  it("edits title -> profile updated", async () => {
    const npo = await seed_npo();
    const prog = await seed_program(npo.id);

    let screen = await render_editor(npo.id, prog.id);
    await expect
      .element(screen.getByLabelText(/title of program/i))
      .toBeVisible();

    const title = screen.getByLabelText(/title of program/i);
    await title.clear();
    await title.fill("Updated Program");

    const save_btns = screen.getByRole("button", { name: /save changes/i });
    await save_btns.nth(0).click();

    // revalidation completes — form resets dirty (isDirty resets async after values sync)
    await expect
      .element(screen.getByLabelText(/title of program/i))
      .toHaveDisplayValue("Updated Program");
    await expect.element(save_btns.nth(0)).toBeDisabled();

    // verify on profile page
    await screen.unmount();
    screen = await render_program_profile(npo.id, prog.id);
    await expect
      .element(screen.getByText("Updated Program"))
      .toBeInTheDocument();
  });

  it("edits target_raise -> revalidated", async () => {
    const npo = await seed_npo();
    const prog = await seed_program(npo.id);

    const screen = await render_editor(npo.id, prog.id);
    await expect.element(screen.getByLabelText(/target amount/i)).toBeVisible();

    const target = screen.getByLabelText(/target amount/i);
    await target.clear();
    await target.fill("75000");

    const save_btns = screen.getByRole("button", { name: /save changes/i });
    await save_btns.nth(0).click();

    // revalidation completes — form resets dirty (isDirty resets async after values sync)
    await expect
      .element(screen.getByLabelText(/target amount/i))
      .toHaveDisplayValue("75,000");
    await expect.element(save_btns.nth(0)).toBeDisabled();
  });

  it("clears target_raise -> program page hides its goal bar", async () => {
    const npo = await seed_npo();
    const prog = await seed_program(npo.id, { target_raise: 50000 });

    // verify target shows on profile before clearing
    let screen = await render_program_profile(npo.id, prog.id);
    await expect
      .element(screen.getByText("0% of $50,000 goal", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("progressbar", { name: "Amount raised" }))
      .toBeInTheDocument();

    // clear target in editor
    await screen.unmount();
    screen = await render_editor(npo.id, prog.id);
    await expect.element(screen.getByLabelText(/target amount/i)).toBeVisible();

    const target = screen.getByLabelText(/target amount/i);
    await target.clear();

    const save_btns = screen.getByRole("button", { name: /save changes/i });
    await save_btns.nth(0).click();

    // revalidation completes — button resets dirty (isDirty resets async after values sync)
    await expect.element(screen.getByLabelText(/target amount/i)).toBeVisible();
    await expect.element(save_btns.nth(0)).toBeDisabled();

    // profile no longer shows target section
    await screen.unmount();
    screen = await render_program_profile(npo.id, prog.id);
    await expect.element(screen.getByText(prog.title)).toBeVisible();
    await expect.element(screen.getByText(/ goal$/)).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("progressbar", { name: "Amount raised" }))
      .not.toBeInTheDocument();
  });
});

describe("program editor -- add milestone", () => {
  it("creates a new milestone in DB", async () => {
    const npo = await seed_npo();
    const prog = await seed_program(npo.id);

    const screen = await render_editor(npo.id, prog.id);

    await expect.element(screen.getByText(/no milestones/i)).toBeVisible();

    await screen.getByRole("button", { name: /add milestone/i }).click();

    // revalidation shows new milestone header
    await expect.element(screen.getByText("Milestone 1")).toBeVisible();
  });

  it("second milestone gets correct numbering", async () => {
    const npo = await seed_npo();
    const prog = await seed_program(npo.id);
    await seed_milestone(prog.id);

    const screen = await render_editor(npo.id, prog.id);

    await expect.element(screen.getByText("Phase 1 Complete")).toBeVisible();

    await screen.getByRole("button", { name: /add milestone/i }).click();

    await expect.element(screen.getByText("Milestone 2")).toBeVisible();
  });
});

describe("program editor -- delete milestone", () => {
  it("delete removes from DB", async () => {
    const npo = await seed_npo();
    const prog = await seed_program(npo.id);
    await seed_milestone(prog.id);

    const confirm_mock = vi.fn(() => true);
    window.confirm = confirm_mock;

    const screen = await render_editor(npo.id, prog.id);

    await expect.element(screen.getByText("Phase 1 Complete")).toBeVisible();

    // expand collapsible — trigger is sibling button to the title span
    const title_span = screen.getByText("Phase 1 Complete");
    const trigger = title_span
      .element()
      .parentElement!.querySelector("button")!;
    await trigger.click();

    // click delete
    await expect
      .element(screen.getByRole("button", { name: /delete milestone/i }))
      .toBeVisible();
    await screen.getByRole("button", { name: /delete milestone/i }).click();

    expect(confirm_mock).toHaveBeenCalledWith("Delete milestone?");

    await expect.element(screen.getByText(/no milestones/i)).toBeVisible();

    const ms = await get_milestones(prog.id);
    expect(ms).toHaveLength(0);
  });

  it("cancel confirm does not delete", async () => {
    const npo = await seed_npo();
    const prog = await seed_program(npo.id);
    await seed_milestone(prog.id);

    window.confirm = vi.fn(() => false);

    const screen = await render_editor(npo.id, prog.id);

    await expect.element(screen.getByText("Phase 1 Complete")).toBeVisible();

    // expand collapsible
    const title_span = screen.getByText("Phase 1 Complete");
    const trigger = title_span
      .element()
      .parentElement!.querySelector("button")!;
    await trigger.click();

    await expect
      .element(screen.getByRole("button", { name: /delete milestone/i }))
      .toBeVisible();
    await screen.getByRole("button", { name: /delete milestone/i }).click();

    // milestone still exists
    await expect
      .element(screen.getByText("Phase 1 Complete"))
      .toBeInTheDocument();
    const ms = await get_milestones(prog.id);
    expect(ms).toHaveLength(1);
  });
});

describe("program editor -- edit milestone", () => {
  // stub that submits json payload via fetcher (mirrors milestone.tsx submit)
  function SubmitPage({ payload }: { payload: Record<string, unknown> }) {
    const fetcher = useFetcher();
    return (
      <>
        {fetcher.data && (
          <div data-testid="action-response">
            {typeof fetcher.data === "string"
              ? fetcher.data
              : JSON.stringify(fetcher.data)}
          </div>
        )}
        <button
          type="button"
          onClick={() =>
            fetcher.submit(payload as any, {
              action: ".",
              method: "POST",
              encType: "application/json",
            })
          }
        >
          Submit
        </button>
      </>
    );
  }

  function render_milestone_edit(
    npo_id: number,
    programId: string,
    payload: Record<string, unknown>
  ) {
    const Stub = createRoutesStub([
      {
        path: "/admin/:id/program-editor/:program_id",
        Component: () => <SubmitPage payload={payload} />,
        HydrateFallback: () => null,
        loader: async () => null,
        action: action as any,
        middleware: [
          async ({ context }, next) => {
            context.set(admin_ctx, npo_id);
            return next();
          },
        ],
      },
    ]);

    return render(
      <Stub
        initialEntries={[`/admin/${npo_id}/program-editor/${programId}`]}
        future={{ v8_middleware: true }}
      />
    );
  }

  it("edits milestone title -> DB updated", async () => {
    const npo = await seed_npo();
    const prog = await seed_program(npo.id);
    const ms = await seed_milestone(prog.id);

    const screen = await render_milestone_edit(npo.id, prog.id, {
      intent: "edit-milestone",
      "milestone-id": ms.id,
      title: "Phase 1 Finished",
      description_pt: ms.description_pt,
      date: ms.date!,
    });

    await expect
      .element(screen.getByRole("button", { name: /submit/i }))
      .toBeVisible();
    await screen.getByRole("button", { name: /submit/i }).click();

    await expect.element(screen.getByTestId("action-response")).toBeVisible();

    const rows = await get_milestones(prog.id);
    const updated = rows.find((r) => r.id === ms.id);
    expect(updated?.title).toBe("Phase 1 Finished");
  });

  it("edits milestone date -> DB updated", async () => {
    const npo = await seed_npo();
    const prog = await seed_program(npo.id);
    const ms = await seed_milestone(prog.id);

    const new_date = new Date("2026-01-01").toISOString();
    const screen = await render_milestone_edit(npo.id, prog.id, {
      intent: "edit-milestone",
      "milestone-id": ms.id,
      title: ms.title,
      description_pt: ms.description_pt,
      date: new_date,
    });

    await expect
      .element(screen.getByRole("button", { name: /submit/i }))
      .toBeVisible();
    await screen.getByRole("button", { name: /submit/i }).click();

    await expect.element(screen.getByTestId("action-response")).toBeVisible();

    const rows = await get_milestones(prog.id);
    const updated = rows.find((r) => r.id === ms.id);
    // pglite stores timestamptz in local format; compare as epoch
    expect(new Date(updated!.date!).getTime()).toBe(
      new Date(new_date).getTime()
    );
  });
});

describe("program editor -- submit button states", () => {
  it("program info save disabled when not dirty", async () => {
    const npo = await seed_npo();
    const prog = await seed_program(npo.id);

    const screen = await render_editor(npo.id, prog.id);
    await expect
      .element(screen.getByLabelText(/title of program/i))
      .toBeVisible();

    const save_btns = screen.getByRole("button", { name: /save changes/i });
    await expect.element(save_btns.nth(0)).toBeDisabled();
  });

  it("enabled when dirty, disabled after submit", async () => {
    const npo = await seed_npo();
    const prog = await seed_program(npo.id);

    const screen = await render_editor(npo.id, prog.id);
    await expect
      .element(screen.getByLabelText(/title of program/i))
      .toBeVisible();

    const title = screen.getByLabelText(/title of program/i);
    await title.clear();
    await title.fill("Changed");

    const save_btns = screen.getByRole("button", { name: /save changes/i });
    await expect.element(save_btns.nth(0)).toBeEnabled();

    await save_btns.nth(0).click();

    await expect
      .element(screen.getByLabelText(/title of program/i))
      .toHaveDisplayValue("Changed");
    await expect.element(save_btns.nth(0)).toBeDisabled();
  });
});

describe("program editor -- validation", () => {
  it("empty title blocks submission", async () => {
    const npo = await seed_npo();
    const prog = await seed_program(npo.id);

    const screen = await render_editor(npo.id, prog.id);
    await expect
      .element(screen.getByLabelText(/title of program/i))
      .toBeVisible();

    const title = screen.getByLabelText(/title of program/i);
    await title.clear();

    const save_btns = screen.getByRole("button", { name: /save changes/i });
    await save_btns.nth(0).click();

    // form stays, button still enabled (dirty + invalid = no submit)
    await expect.element(save_btns.nth(0)).toBeEnabled();
  });
});

// --- rich text editor ---

function pt_json(text: string) {
  return JSON.stringify([
    {
      _type: "block",
      _key: "k1",
      style: "normal",
      markDefs: [],
      children: [{ _type: "span", _key: "s1", text, marks: [] }],
    },
  ]);
}

async function wait_for_editor(screen: { container: HTMLElement }) {
  await vi.waitFor(() => {
    expect(
      screen.container.querySelector('[contenteditable="true"]')
    ).not.toBeNull();
  });
  return screen.container.querySelector(
    '[contenteditable="true"]'
  ) as HTMLElement;
}

describe("program editor -- rich text description", () => {
  it("shows seeded description text in editor", async () => {
    const npo = await seed_npo();
    const desc = pt_json("Water project details");
    const prog = await seed_program(npo.id, { description_pt: desc });

    const screen = await render_editor(npo.id, prog.id);

    await expect
      .element(screen.getByText("Water project details"))
      .toBeVisible();
  });

  it("edit description -> save -> profile updated", async () => {
    const npo = await seed_npo();
    const desc = pt_json("Old description");
    const prog = await seed_program(npo.id, { description_pt: desc });

    let screen = await render_editor(npo.id, prog.id);
    await expect.element(screen.getByText("Old description")).toBeVisible();

    const editor = await wait_for_editor(screen);
    await userEvent.click(editor);
    // select all of the editable, then replace — Cmd+A is unreliable when the
    // initial caret isn't at offset 0 in pt-editor.
    const sel = editor.ownerDocument.getSelection();
    sel?.removeAllRanges();
    const range = editor.ownerDocument.createRange();
    range.selectNodeContents(editor);
    sel?.addRange(range);
    await userEvent.keyboard("{Backspace}");
    await userEvent.keyboard("New description text");

    // pt-editor's mutation events reach form state behind the editable's own
    // paint — save before they land and the action writes a truncated string.
    // the char counter renders the form value's length, so it is the gate:
    // 20 = "New description text", and an append would overshoot it.
    await expect
      .element(screen.getByText(/chars\s*:\s*20\s*\/500/i))
      .toBeVisible();

    const save_btns = screen.getByRole("button", { name: /save changes/i });
    await expect.element(save_btns.nth(0)).toBeEnabled();
    await save_btns.nth(0).click();

    // revalidation completes
    await expect.element(save_btns.nth(0)).toBeDisabled();

    // verify on profile page
    await screen.unmount();
    screen = await render_program_profile(npo.id, prog.id);
    await expect
      .element(screen.getByText("New description text"))
      .toBeInTheDocument();
  });

  it("empty description blocks submission", async () => {
    const npo = await seed_npo();
    const desc = pt_json("will delete");
    const prog = await seed_program(npo.id, { description_pt: desc });

    const screen = await render_editor(npo.id, prog.id);
    await expect.element(screen.getByText("will delete")).toBeVisible();

    const editor = await wait_for_editor(screen);
    await userEvent.click(editor);
    // select all of the editable, then delete — Cmd+A is unreliable when the
    // initial caret isn't at offset 0 in pt-editor.
    const sel = editor.ownerDocument.getSelection();
    sel?.removeAllRanges();
    const range = editor.ownerDocument.createRange();
    range.selectNodeContents(editor);
    sel?.addRange(range);
    await userEvent.keyboard("{Backspace}");

    const save_btns = screen.getByRole("button", { name: /save changes/i });
    await save_btns.nth(0).click();

    // form stays, button still enabled (dirty + invalid = no submit)
    await expect.element(save_btns.nth(0)).toBeEnabled();
  });

  it("profile renders formatted description read-only", async () => {
    const npo = await seed_npo();
    const formatted = JSON.stringify([
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        markDefs: [],
        children: [
          { _type: "span", _key: "s1", text: "normal ", marks: [] },
          { _type: "span", _key: "s2", text: "bold text", marks: ["strong"] },
        ],
      },
    ]);
    const prog = await seed_program(npo.id, { description_pt: formatted });

    const screen = await render_program_profile(npo.id, prog.id);

    // the raised card has a <strong> of its own, so find the bold run by text
    await vi.waitFor(() => {
      const bold = screen.getByText("bold text", { exact: true }).element();
      expect(bold.tagName).toBe("STRONG");
    });
  });
});

// --- cross-npo isolation ---

function ctx_for(npo_id: number) {
  const ctx = new RouterContextProvider();
  ctx.set(admin_ctx, npo_id);
  return ctx;
}

/** the status of the Response the promise rejects with; a resolved value or a non-Response throw fails */
async function thrown_status(p: Promise<unknown>) {
  const r = await p.then(
    (v) => ({ resolved: v }),
    (e: unknown) => ({ thrown: e })
  );
  expect(r).toHaveProperty("thrown");
  const e = (r as { thrown: unknown }).thrown;
  expect(e).toBeInstanceOf(Response);
  return (e as Response).status;
}

const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const NOT_A_UUID = "not-a-uuid";

function get(npo_id: number, program_id: string) {
  return loader({
    params: { id: String(npo_id), program_id },
    context: ctx_for(npo_id),
    request: new Request(
      `http://t/admin/${npo_id}/program-editor/${program_id}`
    ),
  } as any);
}

function post(npo_id: number, program_id: string, body: object) {
  return action({
    params: { id: String(npo_id), program_id },
    context: ctx_for(npo_id),
    request: new Request(
      `http://t/admin/${npo_id}/program-editor/${program_id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    ),
  } as any);
}

const PROGRAM_UPDATE = { title: "Defaced" };

const MUTATIONS: [string, (mid: string) => object][] = [
  [
    "add-milestone",
    () => ({ intent: "add-milestone", "next-milestone-num": 2 }),
  ],
  [
    "edit-milestone",
    (mid) => ({
      intent: "edit-milestone",
      "milestone-id": mid,
      title: "Defaced",
      description_pt: "First well installed",
      date: new Date("2025-06-15").toISOString(),
    }),
  ],
  [
    "delete-milestone",
    (mid) => ({ intent: "delete-milestone", "milestone-id": mid }),
  ],
  ["program update", () => PROGRAM_UPDATE],
];

describe("program editor -- another npo's program", () => {
  async function seed_other() {
    const own = await seed_npo();
    const other = await seed_npo({ registration_number: "EIN-OTHER" });
    const prog = await seed_program(other.id);
    const ms = await seed_milestone(prog.id);
    return { own, prog, ms };
  }

  it("loader throws a 404 Response", async () => {
    const { own, prog } = await seed_other();
    expect(await thrown_status(get(own.id, prog.id))).toBe(404);
  });

  it("control: the program update body is valid for the admin's own program", async () => {
    const own = await seed_npo();
    const prog = await seed_program(own.id);

    const res = await post(own.id, prog.id, PROGRAM_UPDATE);

    expect(res).toEqual({ toast: "Program updated" });
    const [row] = await test_db
      .current!.db.select()
      .from(programs)
      .where(eq(programs.id, prog.id));
    expect(row.title).toBe("Defaced");
  });

  it.each(MUTATIONS)(
    "%s throws a 404 Response and leaves its rows unchanged",
    async (_, body) => {
      const { own, prog, ms } = await seed_other();

      expect(await thrown_status(post(own.id, prog.id, body(ms.id)))).toBe(404);

      expect(await get_milestones(prog.id)).toEqual([ms]);
      const [row] = await test_db
        .current!.db.select()
        .from(programs)
        .where(eq(programs.id, prog.id));
      expect(row).toEqual(prog);
    }
  );
});

describe("program editor -- unusable program id", () => {
  it("loader throws the same 404 for a nonexistent uuid", async () => {
    const own = await seed_npo();
    expect(await thrown_status(get(own.id, MISSING_ID))).toBe(404);
  });

  it("loader throws 400 for a malformed id", async () => {
    const own = await seed_npo();
    expect(await thrown_status(get(own.id, NOT_A_UUID))).toBe(400);
  });

  it.each(MUTATIONS)(
    "%s throws 404 for a nonexistent uuid",
    async (_, body) => {
      const own = await seed_npo();
      const prog = await seed_program(own.id);
      const ms = await seed_milestone(prog.id);

      expect(await thrown_status(post(own.id, MISSING_ID, body(ms.id)))).toBe(
        404
      );
      expect(await get_milestones(prog.id)).toEqual([ms]);
    }
  );

  it.each(MUTATIONS)("%s throws 400 for a malformed id", async (_, body) => {
    const own = await seed_npo();
    const prog = await seed_program(own.id);
    const ms = await seed_milestone(prog.id);

    expect(await thrown_status(post(own.id, NOT_A_UUID, body(ms.id)))).toBe(
      400
    );
    expect(await get_milestones(prog.id)).toEqual([ms]);
  });
});
