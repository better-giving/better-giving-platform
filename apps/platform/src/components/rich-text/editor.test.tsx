import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { RichTextContent } from "#/types/components";
import { RichText } from ".";

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

function rich_content(text: string): RichTextContent {
  return { value: pt_json(text), length: text.length };
}

const EMPTY: RichTextContent = { value: "", length: 0 };

const EDITOR_SEL = '[contenteditable="true"]';

// @portabletext/editor resolves its `mod+b`/`mod+i` shortcuts against
// `IS_MAC = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)` — cmd on apple,
// ctrl everywhere else. mirroring that check here keeps the same assertion
// meaningful on a mac dev machine and on a linux ci runner.
const MOD = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
  ? "Meta"
  : "Control";

// wrapper that wires up RichText with onChange spy. content stays at `initial`
// because most toolbar/keyboard tests don't need re-render — they assert on the
// last onChange payload.
function EditorHarness({
  initial = EMPTY,
  char_limit,
  on_change,
}: {
  initial?: RichTextContent;
  char_limit?: number;
  on_change?: (c: RichTextContent) => void;
}) {
  const ref = useRef<{ focus: () => void }>(null);
  const handler = on_change ?? vi.fn();

  return (
    <div style={{ height: 300 }}>
      <RichText
        ref={ref}
        content={initial}
        onChange={(c) => handler(c as RichTextContent)}
        placeHolder="Write something"
        charLimit={char_limit}
        classes={{
          field:
            "rich-text-toolbar text-sm grid grid-rows-[auto_1fr] p-3 min-h-60",
          counter: "text-gray-11",
        }}
      />
      <button type="button" onClick={() => ref.current?.focus()}>
        Focus editor
      </button>
    </div>
  );
}

// stateful harness — char counter needs re-render on change
function StatefulEditor({
  initial = EMPTY,
  char_limit,
}: {
  initial?: RichTextContent;
  char_limit?: number;
}) {
  const [content, set_content] = useState(initial);

  return (
    <div style={{ height: 300 }}>
      <RichText
        content={content}
        onChange={set_content}
        placeHolder="Write something"
        charLimit={char_limit}
        classes={{
          field:
            "rich-text-toolbar text-sm grid grid-rows-[auto_1fr] p-3 min-h-60",
          counter: "text-gray-11",
        }}
      />
    </div>
  );
}

async function wait_for_editor(screen: { container: HTMLElement }) {
  await vi.waitFor(() => {
    const el = screen.container.querySelector(EDITOR_SEL);
    expect(el).not.toBeNull();
  });
  return screen.container.querySelector(EDITOR_SEL) as HTMLElement;
}

describe("rich text editor — toolbar", () => {
  it("renders bold/italic/list/link buttons", async () => {
    const screen = await render(<EditorHarness />);

    await vi.waitFor(() => {
      const toolbar = screen.container.querySelector(
        ".border-b.border-hairline"
      );
      expect(toolbar).not.toBeNull();
      const btns = toolbar!.querySelectorAll(":scope > button");
      // bold, italic, ordered-list, bulleted-list, link
      expect(btns.length).toBeGreaterThanOrEqual(5);
    });
  });

  it("bold button applies strong mark", async () => {
    const on_change = vi.fn();
    const screen = await render(<EditorHarness on_change={on_change} />);

    const editor = await wait_for_editor(screen);
    await userEvent.click(editor);
    await userEvent.keyboard("normal ");

    const toolbar = screen.container.querySelector(
      ".border-b.border-hairline"
    )!;
    const bold_btn = toolbar.querySelectorAll(
      ":scope > button"
    )[0] as HTMLElement;
    bold_btn.click();
    await userEvent.keyboard("bold");

    await vi.waitFor(() => {
      const last = on_change.mock.calls.at(-1)?.[0];
      expect(last?.value).toContain('"strong"');
    });
  });

  it("italic button applies em mark", async () => {
    const on_change = vi.fn();
    const screen = await render(<EditorHarness on_change={on_change} />);

    const editor = await wait_for_editor(screen);
    await userEvent.click(editor);

    const toolbar = screen.container.querySelector(
      ".border-b.border-hairline"
    )!;
    const italic_btn = toolbar.querySelectorAll(
      ":scope > button"
    )[1] as HTMLElement;
    italic_btn.click();
    await userEvent.keyboard("italic");

    await vi.waitFor(() => {
      const last = on_change.mock.calls.at(-1)?.[0];
      expect(last?.value).toContain('"em"');
    });
  });
});

describe("rich text editor — keyboard shortcuts", () => {
  it("mod+B toggles strong", async () => {
    const on_change = vi.fn();
    const screen = await render(<EditorHarness on_change={on_change} />);

    const editor = await wait_for_editor(screen);
    await userEvent.click(editor);

    await userEvent.keyboard(`{${MOD}>}b{/${MOD}}`);
    await userEvent.keyboard("bolded");

    await vi.waitFor(() => {
      const last = on_change.mock.calls.at(-1)?.[0];
      expect(last?.value).toContain('"strong"');
    });
  });

  it("mod+I toggles em", async () => {
    const on_change = vi.fn();
    const screen = await render(<EditorHarness on_change={on_change} />);

    const editor = await wait_for_editor(screen);
    await userEvent.click(editor);

    await userEvent.keyboard(`{${MOD}>}i{/${MOD}}`);
    await userEvent.keyboard("italicized");

    await vi.waitFor(() => {
      const last = on_change.mock.calls.at(-1)?.[0];
      expect(last?.value).toContain('"em"');
    });
  });
});

describe("rich text editor — lists", () => {
  it("bulleted list button creates ul > li", async () => {
    const on_change = vi.fn();
    const screen = await render(<EditorHarness on_change={on_change} />);

    const editor = await wait_for_editor(screen);
    await userEvent.click(editor);

    // toolbar order: strong, em, number, bullet, link → bullet is index 3
    const toolbar = screen.container.querySelector(
      ".border-b.border-hairline"
    )!;
    const list_btn = toolbar.querySelectorAll(
      ":scope > button"
    )[3] as HTMLElement;
    list_btn.click();
    await userEvent.keyboard("item");

    await vi.waitFor(() => {
      const last = on_change.mock.calls.at(-1)?.[0];
      expect(last?.value).toContain('"listItem":"bullet"');
    });
  });

  it("numbered list button creates ol > li", async () => {
    const on_change = vi.fn();
    const screen = await render(<EditorHarness on_change={on_change} />);

    const editor = await wait_for_editor(screen);
    await userEvent.click(editor);

    // numbered list is index 2
    const toolbar = screen.container.querySelector(
      ".border-b.border-hairline"
    )!;
    const list_btn = toolbar.querySelectorAll(
      ":scope > button"
    )[2] as HTMLElement;
    list_btn.click();
    await userEvent.keyboard("step");

    await vi.waitFor(() => {
      const last = on_change.mock.calls.at(-1)?.[0];
      expect(last?.value).toContain('"listItem":"number"');
    });
  });

  it("toggle list off reverts to plain block", async () => {
    const on_change = vi.fn();
    const screen = await render(<EditorHarness on_change={on_change} />);

    const editor = await wait_for_editor(screen);
    await userEvent.click(editor);

    const toolbar = screen.container.querySelector(
      ".border-b.border-hairline"
    )!;
    const list_btn = toolbar.querySelectorAll(
      ":scope > button"
    )[3] as HTMLElement;

    // toggle on
    list_btn.click();
    await userEvent.keyboard("item");
    await vi.waitFor(() => {
      const last = on_change.mock.calls.at(-1)?.[0];
      expect(last?.value).toContain('"listItem":"bullet"');
    });

    // select all and toggle off
    await userEvent.keyboard("{Meta>}a{/Meta}");
    list_btn.click();

    await vi.waitFor(() => {
      const last = on_change.mock.calls.at(-1)?.[0];
      expect(last?.value).not.toContain('"listItem"');
    });
  });
});

describe("rich text editor — char counter", () => {
  it("shows char count and limit", async () => {
    const screen = await render(
      <StatefulEditor initial={rich_content("hello")} char_limit={500} />
    );

    await expect
      .element(screen.getByText(/chars\s*:\s*5\s*\/500/i))
      .toBeVisible();
  });

  it("counts stored content that arrives without a length, before any edit", async () => {
    // a form seeded from the db holds the json alone: { value }
    const screen = await render(
      <StatefulEditor
        initial={{ value: pt_json("Clean water for all") }}
        char_limit={500}
      />
    );

    await expect
      .element(screen.getByText(/chars\s*:\s*19\s*\/500/i))
      .toBeVisible();
  });

  it("updates count on typing", async () => {
    const screen = await render(
      <StatefulEditor initial={EMPTY} char_limit={100} />
    );

    await expect.element(screen.getByText(/chars\s*:\s*0/)).toBeVisible();

    const editor = await wait_for_editor(screen);
    await userEvent.click(editor);
    await userEvent.keyboard("abc");

    await expect.element(screen.getByText(/chars\s*:\s*3/)).toBeVisible();
  });
});

describe("rich text editor — focus", () => {
  it("imperative focus() works via ref", async () => {
    const screen = await render(<EditorHarness />);

    await wait_for_editor(screen);
    await screen.getByRole("button", { name: /focus editor/i }).click();

    await vi.waitFor(() => {
      const doc = screen.container.ownerDocument;
      expect(doc.activeElement?.getAttribute("contenteditable")).toBe("true");
    });
  });
});

describe("rich text editor — links", () => {
  it("renders only a full http(s) link as a link while editing; the rest as plain text", async () => {
    const link_def = (key: string, href: unknown) => ({
      _key: key,
      _type: "link",
      href,
    });
    const span = (key: string, text: string, mark: string) => ({
      _type: "span",
      _key: key,
      text,
      marks: [mark],
    });
    const value = JSON.stringify([
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        markDefs: [
          link_def("l1", "https://example.org"),
          link_def("l2", "www.example.org"),
          link_def("l3", "javascript:alert(1)"),
          link_def("l4", 42),
        ],
        children: [
          span("s1", "Full", "l1"),
          span("s2", " Bare", "l2"),
          span("s3", " Script", "l3"),
          span("s4", " Number", "l4"),
        ],
      },
    ]);
    const screen = await render(
      <EditorHarness initial={{ value, length: 25 }} />
    );

    const editor = await wait_for_editor(screen);
    await vi.waitFor(() => expect(editor).toMatchTextContent(/Number/));
    const anchors = editor.querySelectorAll("a");
    expect(anchors.length).toBe(1);
    expect(anchors[0]?.getAttribute("href")).toBe("https://example.org");
    expect(anchors[0]).toMatchTextContent("Full");
  });
});

describe("rich text editor — read-only", () => {
  it("no toolbar rendered", async () => {
    const content = rich_content("read only");
    const screen = await render(<RichText content={content} readOnly />);

    await expect.element(screen.getByText("read only")).toBeVisible();
    const toolbar = screen.container.querySelector(".border-b.border-hairline");
    expect(toolbar).toBeNull();
  });

  it("renders strong/em/link marks", async () => {
    const value = JSON.stringify([
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        markDefs: [{ _key: "l1", _type: "link", href: "https://example.com" }],
        children: [
          { _type: "span", _key: "s1", text: "normal ", marks: [] },
          { _type: "span", _key: "s2", text: "bold", marks: ["strong"] },
          { _type: "span", _key: "s3", text: " ", marks: [] },
          { _type: "span", _key: "s4", text: "italic", marks: ["em"] },
          { _type: "span", _key: "s5", text: " ", marks: [] },
          { _type: "span", _key: "s6", text: "link", marks: ["l1"] },
        ],
      },
    ]);
    const screen = await render(
      <RichText content={{ value, length: 24 }} readOnly />
    );

    await vi.waitFor(() => {
      expect(screen.container.querySelector("strong")?.textContent).toBe(
        "bold"
      );
      expect(screen.container.querySelector("em")?.textContent).toBe("italic");
      const a = screen.container.querySelector("a");
      expect(a?.getAttribute("href")).toBe("https://example.com");
      expect(a?.getAttribute("target")).toBe("_blank");
    });
  });

  it("renders bulleted list", async () => {
    const value = JSON.stringify([
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        listItem: "bullet",
        level: 1,
        markDefs: [],
        children: [{ _type: "span", _key: "s1", text: "one", marks: [] }],
      },
      {
        _type: "block",
        _key: "b2",
        style: "normal",
        listItem: "bullet",
        level: 1,
        markDefs: [],
        children: [{ _type: "span", _key: "s2", text: "two", marks: [] }],
      },
    ]);
    const screen = await render(
      <RichText content={{ value, length: 6 }} readOnly />
    );

    await vi.waitFor(() => {
      const items = screen.container.querySelectorAll("li");
      expect(items).toHaveLength(2);
    });
  });
});

describe("rich text editor — onChange", () => {
  it("emits empty value when all text deleted", async () => {
    const on_change = vi.fn();
    const screen = await render(<EditorHarness on_change={on_change} />);

    const editor = await wait_for_editor(screen);
    await userEvent.click(editor);
    await userEvent.keyboard("abc");
    await vi.waitFor(() => {
      expect(on_change.mock.calls.at(-1)?.[0]?.length).toBe(3);
    });
    await userEvent.keyboard("{Backspace}{Backspace}{Backspace}");
    await vi.waitFor(() => {
      expect(on_change.mock.calls.at(-1)?.[0]?.length).toBe(0);
    });
  });

  it("emits pt json with correct length", async () => {
    const on_change = vi.fn();
    const screen = await render(<EditorHarness on_change={on_change} />);

    const editor = await wait_for_editor(screen);
    await userEvent.click(editor);
    await userEvent.keyboard("hello");

    await vi.waitFor(() => {
      const last = on_change.mock.calls.at(-1)?.[0];
      expect(last?.length).toBe(5);
      expect(last?.value).toContain('"hello"');
    });
  });
});
