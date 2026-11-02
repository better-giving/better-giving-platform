import { describe, expect, test } from "vitest";
import { prefers_markdown } from "./negotiate";

const BROWSER =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

describe("prefers_markdown", () => {
  test.each([
    ["text/markdown"],
    ["text/markdown, text/html;q=0.9"],
    ["text/html;q=0.5, text/markdown"],
    ["TEXT/Markdown ; charset=utf-8"],
    ["text/markdown, */*;q=0.1"],
    ["text/markdown, text/*;q=0.5"],
    ["text/markdown;q=0.5, text/*;q=0.1, */*"],
    ["text/markdown, text/html;q=abc"],
  ])("markdown preferred: %s", (accept) => {
    expect(prefers_markdown(accept)).toBe(true);
  });

  test.each([
    ["text/html"],
    ["text/html, text/markdown;q=0.9"],
    [BROWSER],
    ["*/*"],
    ["text/*"],
    [""],
    [null],
    ["text/markdown, text/html"],
    ["text/markdown;q=0.5, text/html;q=0.5"],
    ["text/markdown;q=0"],
    ["text/markdown;q=0, */*"],
    ["application/json"],
    ["text/*;q=0.1, */*"],
    ["text/markdown;q=0.4, text/*;q=0.5"],
    ["text/markdown;q=abc, text/html;q=0.1"],
  ])("html, today's response: %s", (accept) => {
    expect(prefers_markdown(accept)).toBe(false);
  });
});
