import { PDFDocument } from "pdf-lib";
import { describe, expect, test } from "vitest";
import { bgView } from "#/routes/_app.donation-calculator/bg-view";
import { ogInputDefault } from "#/types/donation-calculator";
import { build_pdf } from "./build-pdf";

// node project, not browser: `?bin` decodes through Buffer, and the report is a
// pure fn of `View` — no request, no dom.
describe("build_pdf", () => {
  test("renders four pages in the embedded family", async () => {
    const bytes = await build_pdf(bgView(ogInputDefault));
    expect(bytes.byteLength).toBeGreaterThan(0);

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(4);

    // pdf-lib saves through object streams, so the font dicts are only legible
    // after a reload. fontkit salts each postscript name with a random suffix —
    // match the prefix.
    const base_fonts = new Set<string>();
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      for (const m of String(obj).matchAll(
        /\/BaseFont\s*\/([A-Za-z0-9+-]+)/g
      )) {
        base_fonts.add(m[1]!.replace(/-\d+$/, ""));
      }
    }
    // five weight instances, one per `Fonts` key. this set is what pins the
    // export to the same family the site renders — a face swap that misses
    // ./fonts fails here rather than shipping a report in the old type.
    expect([...base_fonts].sort()).toEqual([
      "RedHatRoundText-Bold",
      "RedHatRoundText-Light",
      "RedHatRoundText-Medium",
      "RedHatRoundText-Regular",
      "RedHatRoundText-SemiBold",
    ]);
  });
});
