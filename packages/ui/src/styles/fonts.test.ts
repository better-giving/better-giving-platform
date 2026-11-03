import { describe, expect, test } from "vitest";
import fonts_css from "./fonts.css?raw";
import theme_css from "./theme.css?raw";

// the suite runs in a browser, which has no node:fs: the glob's keys are the
// font files that exist on disk, resolved by vite at transform time.
const files_on_disk = new Set(
  Object.keys(
    import.meta.glob("./fonts/*", { query: "?url", import: "default" })
  ).map((p) => p.replace("./fonts/", ""))
);

interface Face {
  family: string;
  style: string;
  weight: number;
  file: string;
}

const faces: Face[] = [...fonts_css.matchAll(/@font-face\s*{([^}]*)}/g)].map(
  ([, body]) => ({
    family: body!.match(/font-family:\s*"?([^";]+?)"?\s*;/)![1]!,
    style: body!.match(/font-style:\s*(\w+)/)![1]!,
    weight: Number(body!.match(/font-weight:\s*(\d+)/)![1]),
    file: body!.match(/url\(\.\/fonts\/([^)]+)\)/)![1]!,
  })
);

const WEIGHT_OF_NAME: Record<string, number> = {
  Light: 300,
  Regular: 400,
  Medium: 500,
  SemiBold: 600,
  Bold: 700,
  ExtraBold: 800,
  Black: 900,
};

describe("fonts.css", () => {
  test("declares at least one face, and every @font-face block parses", () => {
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.length).toBe(fonts_css.match(/^@font-face\s*{/gm)!.length);
  });

  test("every face points at a file that exists", () => {
    expect(files_on_disk.size).toBeGreaterThan(0);
    expect(faces.filter((f) => !files_on_disk.has(f.file))).toEqual([]);
  });

  test("red hat round weight and style match the file name", () => {
    const red_hat = faces.filter((f) => f.family.startsWith("Red Hat Round"));
    expect(red_hat.length).toBeGreaterThan(0);
    const wrong = red_hat.filter((f) => {
      const m = f.file.match(/^RedHatRound(?:Display|Text|Mono)-(.+)\.woff2$/);
      const stem = m?.[1] ?? "";
      const italic = stem.endsWith("Italic");
      const name = stem.replace(/Italic$/, "") || "Regular";
      return !(
        f.weight === WEIGHT_OF_NAME[name] &&
        f.style === (italic ? "italic" : "normal")
      );
    });
    expect(wrong).toEqual([]);
  });

  test("every family theme.css names has a face", () => {
    const system = new Set([
      "sans-serif",
      "serif",
      "cursive",
      "monospace",
      "ui-monospace",
      "sfmono-regular",
      "sf mono",
      "menlo",
      "consolas",
      "liberation mono",
    ]);
    const stacks = [
      ...theme_css.matchAll(/--font-(?:display|body|mono|gochi):([^;]+);/g),
    ].map(([, v]) => v!);
    const named = stacks
      .flatMap((v) => v.split(","))
      .map((x) => x.replace(/["']/g, "").trim())
      .filter((x) => x && !system.has(x.toLowerCase()));
    expect(named.length).toBeGreaterThan(0);
    const declared = new Set(faces.map((f) => f.family));
    expect(named.filter((x) => !declared.has(x))).toEqual([]);
  });
});
