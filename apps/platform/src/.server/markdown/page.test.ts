import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { FAQ, faqs } from "#/pages/@sections/faq";
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

  test.each([
    ["[hidden]", `<div hidden>Gone</div>`],
    ['[aria-hidden="true"]', `<span aria-hidden="true">Gone</span>`],
    ["noscript", `<noscript>Gone</noscript>`],
    ["template", `<template><p>Gone</p></template>`],
    ["iframe", `<iframe title="Gone" src="/embed">Gone</iframe>`],
    ["script", `<script>Gone()</script>`],
    ["style", `<style>.Gone{}</style>`],
    ["svg", `<svg><text>Gone</text></svg>`],
    ["form", `<form><label>Gone<input></label></form>`],
    ["nav", `<nav><a href="/x">Gone</a></nav>`],
    ["button", `<button type="button">Gone</button>`],
  ])("drops %s inside main", (_, markup) => {
    const md = page_markdown(doc("T", `<p>Kept</p>${markup}`), PAGE);
    expect(md).toBe("# T\n\nKept\n");
  });

  test("keeps a visible element whose aria-hidden is false", () => {
    const md = page_markdown(doc("T", `<p aria-hidden="false">Kept</p>`), PAGE);
    expect(md).toBe("# T\n\nKept\n");
  });

  test("decodes an entity in the title", () => {
    const md = page_markdown(doc("Q&amp;A &#x27;24", "<p>x</p>"), PAGE);
    expect(md).toBe("# Q&A '24\n\nx\n");
  });

  test("has no heading line when the document has no title", () => {
    const md = page_markdown(
      "<html><head></head><body><main><p>Only body</p></main></body></html>",
      PAGE
    );
    expect(md).toBe("Only body\n");
  });

  test("leaves mailto, tel and href-less anchors as they are", () => {
    const md = page_markdown(
      doc(
        "T",
        `<p><a href="mailto:hi@better.giving">Mail</a> <a href="tel:+15551234">Call</a> <a>Plain</a></p>`
      ),
      PAGE
    );
    expect(md).toContain("[Mail](mailto:hi@better.giving)");
    expect(md).toContain("[Call](tel:+15551234)");
    expect(md).toContain("Plain");
    expect(md).not.toContain("[Plain]");
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

  test("keeps every question and answer of a server-rendered accordion", () => {
    const items = faqs.slice(0, 3);
    const md = page_markdown(doc("T", renderToString(h(FAQ, { items }))), PAGE);
    expect(md).toContain(`${items[0].question}\n\nDonors can add an optional`);
    expect(md).toContain(items[1].question);
    expect(md).toContain("Our platform supports traditional methods");
    expect(md).toContain(items[2].question);
    expect(md).toContain("Register online, then add your donation form");
    expect(md).not.toContain("Need additional support? Live Chat.");
  });

  test("keeps the desktop copy of a block rendered once per breakpoint", () => {
    const md = page_markdown(
      doc(
        "T",
        ["sm", "md", "lg", "xl", "2xl"]
          .map((bp) => `<div class="grid ${bp}:hidden">Mobile ${bp}</div>`)
          .join("") +
          `<div class="max-md:hidden">Desktop</div>` +
          `<p class="md:hidden-ish">Lookalike</p><p class="hidden md:block">Wide only</p>`
      ),
      PAGE
    );
    expect(md).not.toContain("Mobile");
    expect(md).toContain("Desktop");
    expect(md).toContain("Lookalike");
    expect(md).toContain("Wide only");
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
