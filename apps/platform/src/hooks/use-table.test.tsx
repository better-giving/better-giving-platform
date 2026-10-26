import { createRoutesStub, useSearchParams } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { use_table } from "./use-table";

interface Row {
  id: string;
}

interface Opts {
  /** pass an explicit `filter_key` instead of leaning on the shape heuristic */
  keyed?: boolean;
  /** serve both filters an identically shaped page 1 */
  identical?: boolean;
}

/** a table over one loader keyed on `?q`, with a fetcher load and a filter
 *  change on separate buttons so the two can be interleaved by hand. */
function build(
  park: { started: boolean; gate: Promise<void> },
  opts: Opts = {}
) {
  function Page({ loaderData }: any) {
    const [params, set_params] = useSearchParams();
    const { node, load, loading } = use_table<Row>({
      id: "t",
      filter_key: opts.keyed ? params.toString() : undefined,
      page1: loaderData,
      table: (p) => (
        <ul>
          {p.items.map((i) => (
            <li key={i.id}>row:{i.id}</li>
          ))}
        </ul>
      ),
      gen_loader: (l, next) => () => l(`?q=${next}`),
    });
    return (
      <>
        <button type="button" onClick={() => load("?q=slow")}>
          slow search
        </button>
        <button type="button" onClick={() => load("?q=fast")}>
          fast search
        </button>
        <button type="button" onClick={() => set_params({ q: "b" })}>
          change filter
        </button>
        {/* the fetcher's own state, so a parked response can be waited on
            landing rather than slept past */}
        <p>fetcher:{loading ? "loading" : "idle"}</p>
        {node}
      </>
    );
  }

  return createRoutesStub([
    {
      path: "/",
      Component: Page,
      loader: async ({ request }) => {
        const q = new URL(request.url).searchParams.get("q") ?? "";
        if (q === "slow") {
          park.started = true;
          await park.gate;
        }
        const id = opts.identical && (q === "a" || q === "b") ? "same" : q;
        return { items: [{ id }], page: 1, pages: 1 };
      },
    },
  ]);
}

function parked() {
  const park = { started: false, gate: null as any, release: () => {} };
  park.gate = new Promise<void>((r) => {
    park.release = r;
  });
  return park;
}

describe("use_table", () => {
  // react-router keeps a fetcher load running across a navigation, so a slow
  // response can land after the filter that asked for it is gone. accepting it
  // repaints the grid with rows for a filter the user cannot see.
  test("a response issued under the old filter never repaints the new one", async () => {
    const park = parked();
    const Stub = build(park);
    const screen = await render(<Stub initialEntries={["/?q=a"]} />);

    await expect.element(screen.getByText("row:a")).toBeVisible();

    await screen.getByRole("button", { name: "slow search" }).click();
    await vi.waitFor(() => expect(park.started).toBe(true));

    await screen.getByRole("button", { name: "change filter" }).click();
    await expect.element(screen.getByText("row:b")).toBeVisible();

    park.release();
    await expect.element(screen.getByText("fetcher:idle")).toBeVisible();

    expect(screen.getByText("row:slow").query()).toBeNull();
    await expect.element(screen.getByText("row:b")).toBeVisible();
  });

  // the generation only moves when page1 is seen to change, and the fallback
  // heuristic reads page1's shape — two filters can return the same first row
  // and the same count. the filters themselves are the identity, which is what
  // the marketplace and campaign routes pass.
  test("a filter change the shape heuristic cannot see still discards", async () => {
    const park = parked();
    const Stub = build(park, { keyed: true, identical: true });
    const screen = await render(<Stub initialEntries={["/?q=a"]} />);

    await expect.element(screen.getByText("row:same")).toBeVisible();

    await screen.getByRole("button", { name: "slow search" }).click();
    await vi.waitFor(() => expect(park.started).toBe(true));

    await screen.getByRole("button", { name: "change filter" }).click();

    park.release();
    await expect.element(screen.getByText("fetcher:idle")).toBeVisible();

    expect(screen.getByText("row:slow").query()).toBeNull();
    await expect.element(screen.getByText("row:same")).toBeVisible();
  });

  // the other side of the same guard: with no filter change under it, a
  // response is the grid's whole point and still replaces page 1.
  test("a response with no filter change under it replaces the grid", async () => {
    const park = parked();
    const Stub = build(park);
    const screen = await render(<Stub initialEntries={["/?q=a"]} />);

    await expect.element(screen.getByText("row:a")).toBeVisible();

    await screen.getByRole("button", { name: "fast search" }).click();

    await expect.element(screen.getByText("row:fast")).toBeVisible();
  });
});
