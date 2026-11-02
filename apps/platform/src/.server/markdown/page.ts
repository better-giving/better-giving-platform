import { NodeHtmlMarkdown } from "node-html-markdown";
import { HTMLElement, parse } from "node-html-parser";

/** markup that is behaviour, decoration or chrome — none of it reads as page content */
const NOT_CONTENT = [
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "svg",
  "form",
  "button",
  "nav",
  "[hidden]",
  '[aria-hidden="true"]',
].join(",");

const BLOCK_DISPLAY = new Set(["block", "flex", "grid"]);
const STACKS_CHILDREN = new Set(["grid", "flex-col"]);
const FLEX = new Set(["flex", "inline-flex"]);

const has_class = (el: HTMLElement, names: Set<string>) =>
  el.classList.value.some((c) => names.has(c));

/**
 * the converter reads tags, not css: a span tailwind lays out as a block (its
 * own display, or a grid / column-flex parent's) becomes one, and the items of
 * a flex row, spaced by `gap` rather than text, get a space between them —
 * otherwise each runs into its sibling's text
 */
function lay_out(main: HTMLElement) {
  for (const el of main.querySelectorAll("span")) {
    const parent = el.parentNode;
    if (
      has_class(el, BLOCK_DISPLAY) ||
      (parent && has_class(parent, STACKS_CHILDREN))
    ) {
      el.tagName = "div";
    }
  }
  for (const row of main.querySelectorAll("[class]")) {
    if (!has_class(row, FLEX) || row.classList.contains("flex-col")) continue;
    const items = row.childNodes.filter((n) => n instanceof HTMLElement);
    for (const item of items.slice(0, -1)) {
      item.insertAdjacentHTML("afterend", " ");
    }
  }
}

const nhm = new NodeHtmlMarkdown({ bulletMarker: "-" });

function absolute(url: string, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/**
 * markdown of a rendered document's `<main>`, headed by its `<title>`; links
 * resolve against `page_url`. null when the document has no `<main>`.
 */
export function page_markdown(html: string, page_url: string): string | null {
  const root = parse(html);
  const main = root.querySelector("main");
  if (!main) return null;

  for (const el of main.querySelectorAll(NOT_CONTENT)) el.remove();
  lay_out(main);
  for (const [selector, attr] of [
    ["a[href]", "href"],
    ["img[src]", "src"],
  ] as const) {
    for (const el of main.querySelectorAll(selector)) {
      el.setAttribute(attr, absolute(el.getAttribute(attr) ?? "", page_url));
    }
  }

  const body = nhm.translate(main.innerHTML).trim();
  const title = root.querySelector("title")?.text.trim();
  const h1 = main.querySelector("h1")?.text.trim();
  const heading = title && title !== h1 ? `# ${title}\n\n` : "";
  return `${heading}${body}\n`;
}
