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

/**
 * an ark/zag accordion renders each question as a `<button>` and each closed
 * answer `hidden`, both in NOT_CONTENT — the question becomes a paragraph
 * and the answer is shown before stripping
 */
function open_accordions(main: HTMLElement) {
  for (const trigger of main.querySelectorAll(
    '[data-scope="accordion"][data-part="item-trigger"]'
  )) {
    trigger.replaceWith(`<p>${trigger.innerHTML}</p>`);
  }
  for (const panel of main.querySelectorAll(
    '[data-scope="accordion"][data-part="item-content"]'
  )) {
    panel.removeAttribute("hidden");
  }
}

const BLOCK_DISPLAY = new Set(["block", "flex", "grid"]);
const STACKS_CHILDREN = new Set(["grid", "flex-col"]);
const FLEX = new Set(["flex", "inline-flex"]);

const has_class = (el: HTMLElement, names: Set<string>) =>
  el.classList.value.some((c) => names.has(c));

/** classes on the mobile copy of a block a page renders once per breakpoint; the desktop copy's `max-*:hidden` isn't one, so it stays */
const MOBILE_ONLY = new Set(
  ["sm", "md", "lg", "xl", "2xl"].map((bp) => `${bp}:hidden`)
);

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

/** a YAML double-quoted scalar; JSON strings are valid YAML */
const quoted = (v: string) => JSON.stringify(v.replace(/\s+/g, " ").trim());

/**
 * markdown of a rendered document's `<main>`, opening with a `---` frontmatter
 * block (title, description, canonical, last-updated as the day it was
 * rendered) and headed by its `<title>` unless that repeats the `<h1>`; links
 * and image sources resolve against `page_url`. null when the document has no
 * `<main>`.
 */
export function page_markdown(
  html: string,
  page_url: string,
  now: Date = new Date()
): string | null {
  const root = parse(html);
  const main = root.querySelector("main");
  if (!main) return null;

  open_accordions(main);
  for (const el of main.querySelectorAll(NOT_CONTENT)) el.remove();
  for (const el of main.querySelectorAll("[class]")) {
    if (has_class(el, MOBILE_ONLY)) el.remove();
  }
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

  const description = root
    .querySelector('meta[name="description"]')
    ?.getAttribute("content");
  const canonical = root
    .querySelector('link[rel="canonical"]')
    ?.getAttribute("href");
  const front = [
    ["title", title || h1],
    ["description", description],
    ["canonical", absolute(canonical || page_url, page_url)],
    ["last-updated", now.toISOString().slice(0, 10)],
  ]
    .filter((e): e is [string, string] => !!e[1])
    .map(([k, v]) =>
      k === "last-updated" ? `${k}: ${v}` : `${k}: ${quoted(v)}`
    );
  return `---\n${front.join("\n")}\n---\n\n${heading}${body}\n`;
}
