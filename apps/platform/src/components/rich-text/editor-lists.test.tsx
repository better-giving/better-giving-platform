import { describe, expect, it, vi } from "vitest";
import { cdp, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
// markers, indents and focus rings are all stylesheet output
import "#/index.css";
import type { RichTextContent } from "#/types/components";
import { RichText } from ".";

type Item = { text: string; list?: "number" | "bullet"; level?: number };

function doc(items: Item[]): RichTextContent {
  const blocks = items.map((it, i) => ({
    _type: "block",
    _key: `b${i}`,
    style: "normal",
    markDefs: [],
    ...(it.list ? { listItem: it.list, level: it.level ?? 1 } : {}),
    children: [{ _type: "span", _key: `s${i}`, text: it.text, marks: [] }],
  }));
  return {
    value: JSON.stringify(blocks),
    length: items.reduce((n, it) => n + it.text.length, 0),
  };
}

async function render_editor(items: Item[]) {
  const screen = await render(
    <RichText
      content={doc(items)}
      onChange={vi.fn()}
      classes={{ field: "p-3" }}
    />
  );
  await vi.waitFor(
    () =>
      expect(
        screen.container.querySelector('[contenteditable="true"] li')
      ).not.toBeNull(),
    // the editor is a lazy chunk; the first file to load it pays for the fetch
    { timeout: 5_000 }
  );
  return screen;
}

type FrameTree = { frame: { id: string }; childFrames?: FrameTree[] };
type AXNode = { role?: { value?: string }; name?: { value?: string } };

/** the rendered marker text, read off chromium's accessibility tree — a
 *  `::marker` has no DOM node, and its computed `content` is `normal` whatever
 *  number it paints */
async function marker_texts(): Promise<string[]> {
  const session = cdp();
  await session.send("Accessibility.enable");
  const { frameTree } = (await session.send("Page.getFrameTree")) as {
    frameTree: FrameTree;
  };
  const frame_ids = (t: FrameTree): string[] => [
    t.frame.id,
    ...(t.childFrames ?? []).flatMap(frame_ids),
  ];
  const nodes: AXNode[] = [];
  for (const frameId of frame_ids(frameTree)) {
    const res = (await session.send("Accessibility.getFullAXTree", {
      frameId,
    })) as { nodes: AXNode[] };
    nodes.push(...res.nodes);
  }
  return nodes
    .filter((n) => n.role?.value === "ListMarker")
    .map((n) => (n.name?.value ?? "").trim());
}

const li_of = (screen: { container: HTMLElement }, text: string) =>
  [...screen.container.querySelectorAll("li")].find(
    (li) => li.textContent === text
  ) as HTMLLIElement;

describe("rich text editor — lists", () => {
  it("numbers consecutive items 1, 2, 3", async () => {
    await render_editor([
      { text: "First", list: "number" },
      { text: "Second", list: "number" },
      { text: "Third", list: "number" },
    ]);
    await vi.waitFor(async () =>
      expect(await marker_texts()).toEqual(["1.", "2.", "3."])
    );
  });

  it("restarts numbering after a paragraph and under a nested level", async () => {
    await render_editor([
      { text: "One", list: "number" },
      { text: "One A", list: "number", level: 2 },
      { text: "One B", list: "number", level: 2 },
      { text: "Two", list: "number" },
      { text: "A paragraph" },
      { text: "Again one", list: "number" },
    ]);
    await vi.waitFor(async () =>
      expect(await marker_texts()).toEqual(["1.", "1.", "2.", "2.", "1."])
    );
  });

  it("indents a nested item past its parent", async () => {
    const screen = await render_editor([
      { text: "Parent", list: "bullet" },
      { text: "Child", list: "bullet", level: 2 },
      { text: "Grandchild", list: "bullet", level: 3 },
    ]);
    const x = (text: string) =>
      li_of(screen, text).getBoundingClientRect().left;
    expect(x("Child")).toBeGreaterThan(x("Parent"));
    expect(x("Grandchild") - x("Child")).toBeCloseTo(
      x("Child") - x("Parent"),
      0
    );
  });
});

describe("rich text editor — toolbar focus", () => {
  it("a toolbar button rings on keyboard focus", async () => {
    const screen = await render_editor([{ text: "Item", list: "bullet" }]);
    const bold = screen.getByRole("button", { name: "Bold" });
    const btn = bold.element() as HTMLElement;
    for (let i = 0; i < 5 && document.activeElement !== btn; i++) {
      await userEvent.tab();
    }
    await expect.element(bold).toHaveFocus();
    const style = getComputedStyle(btn);
    expect(style.outlineStyle).toBe("solid");
    expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThan(0);
  });
});
