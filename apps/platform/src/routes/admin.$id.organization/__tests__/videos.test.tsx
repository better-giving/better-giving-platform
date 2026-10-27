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
import { render } from "vitest-browser-react";
import { admin_ctx } from "$/auth/test-utils";
import { npo_media, npos } from "$/pg/schema/npo";
import { create_test_db, type TestDb } from "$/pg/test-utils/pglite";

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
  (await import("$/auth/test-utils")).make_auth_mock({
    session: { user: undefined },
  })
);
vi.mock("#/.server/toast", () => ({
  dataWithSuccess: vi.fn((d: unknown) => d),
  dataWithError: vi.fn((d: unknown) => d),
}));
vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: any) => Component,
  createClientLoaderCache: () => undefined,
}));

import { videos_action } from "#/routes/admin.$id.organization.videos/api";
import { action, loader } from "../api";
import OrganizationPage from "../route";

const db = () => test_db.current!.db;
const CAP = "Your page shows up to 4 videos. Take one off first.";
const FULL = "All 4 spots are in use. Take a video off to show another.";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await db().delete(npo_media);
  await db().delete(npos);
});

async function seed_npo() {
  const [row] = await db()
    .insert(npos)
    .values({
      registration_number: "EIN-ORG-VIDEOS",
      name: "Video Charity",
      endow_designation: "Charity",
      hq_country: "United States",
      tagline: "Helping",
      image: "https://example.com/banner.jpg",
      logo: "https://example.com/logo.jpg",
      overview_pt: "Overview.",
      overview_v2: "Overview.",
      active_in_countries: [],
      slug: "video-charity",
    })
    .returning();
  return row!;
}

let tick = 0;
/** each seed is newer than the last, so the last seeded is spot 1 */
async function seed_video(npo_id: number, id: string, featured: boolean) {
  await db()
    .insert(npo_media)
    .values({
      id: crypto.randomUUID(),
      npo_id,
      url: `https://youtu.be/${id}`,
      type: "video",
      featured,
      date_created: new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick)).toISOString(),
    });
}

async function render_org(npo_id: number) {
  const as_admin = async (
    { context }: { context: { set: (k: any, v: number) => void } },
    next: () => Promise<unknown>
  ) => {
    context.set(admin_ctx, npo_id);
    return next();
  };
  const Stub = createRoutesStub([
    {
      path: "/admin/:id/organization",
      Component: OrganizationPage,
      HydrateFallback: () => null,
      loader: loader as any,
      action: action as any,
      middleware: [as_admin as any],
      children: [{ path: "videos", action: videos_action as any }],
    },
  ]);
  return render(
    <Stub
      initialEntries={[`/admin/${npo_id}/organization`]}
      future={{ v8_middleware: true }}
    />
  );
}

/** an 11-char id `youtube_link_id` accepts */
const yt = (n: number) => `vid${String(n).padStart(8, "0")}`;

describe("organization — videos", () => {
  it("adds from the inline field onto the page; a non-YouTube link is refused at the field", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);

    const group = screen.getByRole("group", { name: "Videos" });
    await expect.element(group).toBeVisible();
    await expect
      .element(screen.getByText("0 of 4 spots used"))
      .toBeInTheDocument();
    await expect.element(screen.getByText("No videos yet")).toBeVisible();

    const field = screen.getByLabelText("Add a video");
    await field.fill("https://vimeo.com/123456");
    await screen.getByRole("button", { name: "Add video" }).click();
    await expect
      .element(screen.getByText("only YouTube links are supported"))
      .toBeVisible();
    await expect.element(field).toHaveAttribute("aria-invalid", "true");

    await field.fill(`https://youtu.be/${yt(1)}`);
    await screen.getByRole("button", { name: "Add video" }).click();
    await expect
      .element(screen.getByRole("link", { name: `youtu.be/${yt(1)}` }))
      .toBeVisible();
    await expect.element(screen.getByText("On page · spot 1")).toBeVisible();
    await expect
      .element(screen.getByText("1 of 4 spots used"))
      .toBeInTheDocument();
    await expect.element(field).toHaveValue("");
    await expect.element(field).not.toHaveAttribute("aria-invalid", "true");
  });

  it("a full page holds Show on page with its reason; taking one off frees a spot", async () => {
    const npo = await seed_npo();
    await seed_video(npo.id, yt(5), false);
    for (const n of [1, 2, 3, 4]) await seed_video(npo.id, yt(n), true);
    const screen = await render_org(npo.id);

    await expect
      .element(screen.getByText("4 of 4 spots used"))
      .toBeInTheDocument();
    const show = screen.getByRole("button", {
      name: `Show youtu.be/${yt(5)} on page`,
    });
    await expect.element(show).toHaveAttribute("aria-disabled", "true");
    await expect.element(show).toHaveAccessibleDescription(FULL);
    await expect.element(screen.getByText(FULL)).toBeVisible();
    // playwright won't press an aria-disabled control; a person can
    (show.element() as HTMLElement).click();
    await expect.element(screen.getByText("4 of 4 spots used")).toBeVisible();

    // newest first: yt(4) was seeded last, so it holds spot 1
    await screen
      .getByRole("button", { name: `Take youtu.be/${yt(4)} off your page` })
      .click();
    await expect.element(screen.getByText("3 of 4 spots used")).toBeVisible();
    await expect.element(show).not.toHaveAttribute("aria-disabled", "true");

    await show.click();
    await expect.element(screen.getByText("4 of 4 spots used")).toBeVisible();
    expect(
      screen
        .getByRole("button", { name: `Take youtu.be/${yt(5)} off your page` })
        .query()
    ).not.toBeNull();
  });

  it("a page that filled up elsewhere refuses the fifth at the pressed control", async () => {
    const npo = await seed_npo();
    await seed_video(npo.id, yt(9), false);
    for (const n of [1, 2, 3]) await seed_video(npo.id, yt(n), true);
    const screen = await render_org(npo.id);

    const show = screen.getByRole("button", {
      name: `Show youtu.be/${yt(9)} on page`,
    });
    await expect.element(show).not.toHaveAttribute("aria-disabled", "true");
    // another tab features a fourth meanwhile
    await seed_video(npo.id, yt(4), true);

    await show.click();
    await expect.element(show).toHaveAccessibleDescription(CAP);
    await expect.element(screen.getByText(CAP)).toBeVisible();
  });

  it("delete offers Undo, which brings the link back onto the page", async () => {
    const npo = await seed_npo();
    await seed_video(npo.id, yt(7), true);
    const screen = await render_org(npo.id);

    const link = screen.getByRole("link", { name: `youtu.be/${yt(7)}` });
    await expect.element(link).toBeVisible();
    await screen
      .getByRole("button", { name: `Remove youtu.be/${yt(7)}` })
      .click();

    const undo = screen.getByRole("button", {
      name: `Undo removing youtu.be/${yt(7)}`,
    });
    await expect.element(undo).toBeVisible();
    await expect.element(undo).toHaveFocus();
    await expect.element(link).not.toBeInTheDocument();
    await expect
      .element(screen.getByText("0 of 4 spots used"))
      .toBeInTheDocument();

    await undo.click();
    await expect.element(link).toBeVisible();
    await expect.element(screen.getByText("On page · spot 1")).toBeVisible();
    await expect.element(undo).not.toBeInTheDocument();
  });

  it("edits a link in its row; a non-YouTube link is refused there", async () => {
    const npo = await seed_npo();
    await seed_video(npo.id, yt(3), false);
    const screen = await render_org(npo.id);

    await screen
      .getByRole("button", { name: `Edit link for youtu.be/${yt(3)}` })
      .click();
    const input = screen.getByLabelText(`Link for youtu.be/${yt(3)}`);
    await expect.element(input).toHaveFocus();
    await input.fill("https://example.org/x");
    await screen.getByRole("button", { name: "Save link" }).click();
    await expect
      .element(screen.getByText("only YouTube links are supported"))
      .toBeVisible();

    await input.fill(`https://youtu.be/${yt(8)}`);
    await screen.getByRole("button", { name: "Save link" }).click();
    await expect
      .element(screen.getByRole("link", { name: `youtu.be/${yt(8)}` }))
      .toBeVisible();
    await expect.element(input).not.toBeInTheDocument();
  });

  it("loads the next videos past the first ten", async () => {
    const npo = await seed_npo();
    for (let n = 1; n <= 11; n++) await seed_video(npo.id, yt(n), false);
    const screen = await render_org(npo.id);

    const rows = () =>
      screen.getByRole("button", { name: /^Remove youtu\.be\// }).elements();
    await expect
      .element(screen.getByRole("link", { name: `youtu.be/${yt(11)}` }))
      .toBeVisible();
    expect(rows()).toHaveLength(10);

    await screen.getByRole("button", { name: "Load more videos" }).click();
    await expect
      .element(screen.getByRole("link", { name: `youtu.be/${yt(1)}` }))
      .toBeVisible();
    expect(rows()).toHaveLength(11);
    await expect
      .element(screen.getByRole("button", { name: "Load more videos" }))
      .not.toBeInTheDocument();
  });
});
