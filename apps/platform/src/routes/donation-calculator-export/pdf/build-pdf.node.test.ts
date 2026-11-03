import { inflateSync } from "node:zlib";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
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
    // the @better-giving/ui/fonts imports in build-pdf.ts fails here rather
    // than shipping a report in the old type.
    expect([...base_fonts].sort()).toEqual([
      "RedHatRoundText-Bold",
      "RedHatRoundText-Light",
      "RedHatRoundText-Medium",
      "RedHatRoundText-Regular",
      "RedHatRoundText-SemiBold",
    ]);
  });

  test("the embedded font files are truetype, not the woff2 they were read from", async () => {
    const bytes = await build_pdf(bgView(ogInputDefault));
    const doc = await PDFDocument.load(bytes);
    // a pdf font file has to be an sfnt. an unsubset woff2 would be written
    // through as it is: it measures fine and renders as a fallback in a viewer.
    const heads: string[] = [];
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      const file = obj.get(PDFName.of("FontFile2"));
      if (!(file instanceof PDFRef)) continue;
      const stream = doc.context.lookup(file);
      if (!(stream instanceof PDFRawStream)) continue;
      const raw = Buffer.from(stream.contents);
      const font = stream.dict.has(PDFName.of("Filter"))
        ? inflateSync(raw)
        : raw;
      heads.push(font.subarray(0, 4).toString("latin1"));
    }
    expect(heads).toHaveLength(5);
    expect(heads).not.toContain("wOF2");
    // an sfnt opens with 0x00010000 (truetype outlines), 'true' or 'OTTO'
    const sfnt = new Set(["\x00\x01\x00\x00", "true", "OTTO"]);
    expect(heads.filter((h) => !sfnt.has(h))).toEqual([]);
  });
});
