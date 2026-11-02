import { describe, expect, test } from "vitest";
import { page_markdown } from "./page";

const ORIGIN = "https://www.better.giving";
const PAGE = `${ORIGIN}/pricing`;

const doc = (title: string, main: string) =>
  `<!DOCTYPE html><html><head><title>${title}</title><style>.x{}</style></head><body>` +
  `<header><nav><a href="/login">Log in</a></nav></header>` +
  `<main>${main}</main>` +
  `<footer>© Better Giving</footer><script>window.__ctx = {}</script></body></html>`;

describe("page_markdown", () => {
  test("titles the page from the document title", () => {
    const md = page_markdown(
      doc("Pricing | Better Giving", "<p>Free.</p>"),
      PAGE
    );
    expect(md?.startsWith("# Pricing | Better Giving\n\nFree.")).toBe(true);
  });

  test("keeps the page's own h1 instead of a duplicate title", () => {
    const md = page_markdown(
      doc("Pricing", "<h1>Pricing</h1><p>Free.</p>"),
      PAGE
    );
    expect(md).toBe("# Pricing\n\nFree.\n");
  });

  test("absolutizes relative links and image sources against the origin", () => {
    const md = page_markdown(
      doc(
        "T",
        `<a href="/donate/7?x=1">Give</a> <a href="https://x.org/a">Ext</a> <a href="#faq">FAQ</a>` +
          `<img src="/img/a.png" alt="Logo">`
      ),
      PAGE
    );
    expect(md).toContain(`[Give](${ORIGIN}/donate/7?x=1)`);
    expect(md).toContain("[Ext](https://x.org/a)");
    expect(md).toContain(`[FAQ](${ORIGIN}/pricing#faq)`);
    expect(md).toContain(`![Logo](${ORIGIN}/img/a.png)`);
  });

  test("drops site chrome, scripts, styles, svg, forms and buttons", () => {
    const md = page_markdown(
      doc(
        "T",
        `<p>Kept</p><script>alert("x")</script><style>.y{color:red}</style>` +
          `<svg><title>icon</title><path d=""/></svg>` +
          `<form><label>Email<input name="e"></label><button>Subscribe</button></form>` +
          `<button type="button">Open menu</button><nav><a href="/a">In-page nav</a></nav>`
      ),
      PAGE
    );
    expect(md).toContain("Kept");
    for (const gone of [
      "Log in",
      "Better Giving",
      "__ctx",
      "alert",
      "color:red",
      "icon",
      "Email",
      "Subscribe",
      "Open menu",
      "In-page nav",
    ]) {
      expect(md).not.toContain(gone);
    }
  });

  test("keeps tailwind-laid-out items apart", () => {
    const md = page_markdown(
      doc(
        "T",
        `<div class="grid gap-2"><span class="flex gap-2.5">One</span><span class="flex">Two</span></div>` +
          `<div class="flex flex-col"><span class="font-bold">Plan</span><span>$0</span></div>` +
          `<div class="flex flex-wrap gap-2"><span>Card</span><span>Bank / ACH</span></div>` +
          `<p class="flex gap-4"><a href="/a">Join</a><a href="/b">Demo</a></p>` +
          `<span class="inline-flex">A</span><span>B</span>`
      ),
      PAGE
    );
    expect(md).toContain("One\n\nTwo");
    expect(md).toContain("Plan\n\n$0");
    expect(md).toContain("Card Bank / ACH");
    expect(md).toContain(`[Join](${ORIGIN}/a) [Demo](${ORIGIN}/b)`);
    expect(md).toContain("AB");
  });

  test("returns null for a page with no main element", () => {
    expect(
      page_markdown(
        "<html><head><title>T</title></head><body><p>x</p></body></html>",
        PAGE
      )
    ).toBeNull();
  });
});
