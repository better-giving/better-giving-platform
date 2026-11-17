import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import type { IDonorMessage } from "#/components/org-page/items";
import { mswWorker } from "#/setup-tests-browser";
import { use_donor_messages } from "./donor-messages";

const report_error = vi.hoisted(() => vi.fn());
vi.mock("#/errors/report", () => ({ report_error }));

afterEach(async () => {
  await cleanup();
  report_error.mockClear();
});

interface IHarness {
  messages: IDonorMessage[];
  next: string | null;
}

/** one press asks twice in a row, as an impatient double-tap would */
function Harness({ messages, next }: IHarness) {
  const m = use_donor_messages(7, messages, next);
  return (
    <>
      <ul>
        {m.messages.map((x) => (
          <li key={x.id}>{`${x.name}: ${x.message}`}</li>
        ))}
      </ul>
      {m.on_more ? (
        <button
          type="button"
          onClick={() => {
            m.on_more?.();
            m.on_more?.();
          }}
        >
          More
        </button>
      ) : (
        <p>No more</p>
      )}
    </>
  );
}

const row = (id: string, donor_message: string | null, donor_name = "Ben") => ({
  id,
  donor_name,
  donor_message,
  amount: 250,
  date: "2026-10-01",
});

/** serves `pages` by cursor; returns each request's query, in order */
function serve(pages: Record<string, unknown>) {
  const asked: URLSearchParams[] = [];
  mswWorker.use(
    http.get("/api/npo/7/donors", async ({ request }) => {
      const q = new URL(request.url).searchParams;
      asked.push(q);
      // long enough for a second ask to land while the first is out
      await new Promise((r) => setTimeout(r, 50));
      const page = pages[q.get("next") ?? ""];
      return page === undefined
        ? HttpResponse.json(null, { status: 500 })
        : HttpResponse.json(page);
    })
  );
  return asked;
}

const items = (screen: Awaited<ReturnType<typeof render>>) =>
  screen
    .getByRole("listitem")
    .elements()
    .map((li) => li.textContent);

describe("donor messages paging", () => {
  test("asks the messages-only feed once per press, appends the non-blank messages, and stops at the end", async () => {
    const asked = serve({
      c2: {
        items: [row("d2", "Proud to help"), row("d3", "  ")],
        next: "c3",
      },
      c3: { items: [row("d4", "Again!", "")] },
    });
    const screen = await render(
      <Harness
        messages={[{ id: "d1", name: "Ana", message: "Keep going" }]}
        next="c2"
      />
    );

    await screen.getByRole("button", { name: "More" }).click();
    await expect
      .element(screen.getByText("Ben: Proud to help"))
      .toBeInTheDocument();
    expect(asked.map((q) => [q.get("next"), q.get("with_message")])).toEqual([
      ["c2", "1"],
    ]);
    expect(items(screen)).toEqual(["Ana: Keep going", "Ben: Proud to help"]);

    await screen.getByRole("button", { name: "More" }).click();
    await expect.element(screen.getByText("No more")).toBeInTheDocument();
    expect(items(screen)).toEqual([
      "Ana: Keep going",
      "Ben: Proud to help",
      "Donor: Again!",
    ]);
    expect(asked).toHaveLength(2);
  });

  test("offers no more when the first page was the last", async () => {
    const screen = await render(<Harness messages={[]} next={null} />);
    await expect.element(screen.getByText("No more")).toBeInTheDocument();
  });

  test("reports a failed page and keeps its cursor, so the next press asks again", async () => {
    const asked = serve({});
    const screen = await render(<Harness messages={[]} next="c2" />);

    await screen.getByRole("button", { name: "More" }).click();
    await expect.poll(() => asked.length).toBe(1);
    await expect.poll(() => report_error.mock.calls.length).toBe(1);
    expect(report_error).toHaveBeenCalledWith(new Error("500"), {
      npo_id: 7,
    });
    // the hook clears its in-flight flag in the same step that reports, so
    // one press now is not dropped; a press while the page is out would be
    await screen.getByRole("button", { name: "More" }).click();
    await expect.poll(() => asked.length).toBe(2);
    expect(asked).toHaveLength(2);
    expect(asked.map((q) => q.get("next"))).toEqual(["c2", "c2"]);
  });
});
