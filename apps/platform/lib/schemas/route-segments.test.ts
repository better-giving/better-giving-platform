import fs from "node:fs";
import path from "node:path";
import { safeParse } from "valibot";
import { describe, expect, it } from "vitest";
import { org_slug, segment, slug } from "./index";
import {
  first_url_segment,
  reserved_words,
  top_level_route_segments,
} from "./route-segments";

const routes_dir = path.resolve(import.meta.dirname, "../../src/routes");
const exts = [".ts", ".tsx", ".js", ".jsx"];
const probe = path.join(routes_dir, "segment-enum-probe");

function derived_segments(dir: string): string[] {
  const segs = new Set<string>();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    let route_id: string | null = null;
    if (entry.isDirectory()) {
      const has_module = exts.some(
        (ext) =>
          fs.existsSync(path.join(dir, entry.name, `route${ext}`)) ||
          fs.existsSync(path.join(dir, entry.name, `index${ext}`))
      );
      if (!has_module) continue;
      route_id = entry.name;
    } else if (entry.isFile()) {
      if (/\.test\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
      const ext = path.extname(entry.name);
      if (!exts.includes(ext)) continue;
      route_id = entry.name.slice(0, -ext.length);
    }
    if (!route_id) continue;
    const first = first_url_segment(route_id);
    if (first) segs.add(first);
  }
  return [...segs].sort();
}

const otherwise_ok = (word: string) =>
  word.length <= 30 &&
  /^[a-zA-Z0-9-._~]+$/.test(word) &&
  !/^\d+$/.test(word) &&
  !word.includes("..") &&
  !word.startsWith(".") &&
  !word.endsWith(".");

describe("reserved segments", () => {
  it("derives the committed top-level list from src/routes", () => {
    fs.rmSync(probe, { recursive: true, force: true });
    expect(derived_segments(routes_dir)).toEqual([...top_level_route_segments]);

    fs.mkdirSync(probe);
    fs.writeFileSync(
      path.join(probe, "route.tsx"),
      "export default function Page() { return null; }\n"
    );
    try {
      const derived = derived_segments(routes_dir);
      expect(derived).toContain("segment-enum-probe");
      expect(derived).not.toEqual([...top_level_route_segments]);
    } finally {
      fs.rmSync(probe, { recursive: true, force: true });
    }
    expect(derived_segments(routes_dir)).toEqual([...top_level_route_segments]);
  });

  it("rejects every top-level segment and reserved word, and keeps organizations", () => {
    for (const word of reserved_words) {
      const parsed = safeParse(segment, word);
      expect(parsed.issues?.[0]?.message).toBe(
        `Pick a different slug: ${word} is reserved`
      );
    }
    for (const word of top_level_route_segments) {
      const parsed = safeParse(segment, word);
      expect(parsed.success).toBe(false);
      if (!otherwise_ok(word)) continue;
      const message = parsed.issues?.[0]?.message;
      if ((reserved_words as readonly string[]).includes(word)) {
        expect(message).toBe(`Pick a different slug: ${word} is reserved`);
      } else {
        expect(message).toBe(
          `Pick a different slug: ${word} is already used by Better Giving`
        );
      }
    }
    expect(safeParse(segment, "organizations").success).toBe(true);
    expect(safeParse(slug, "pricing").success).toBe(true);
    expect(safeParse(org_slug, "pricing").issues?.[0]?.message).toBe(
      "Pick a different slug: pricing is already used by Better Giving"
    );
    expect(safeParse(segment, "Donate").issues?.[0]?.message).toBe(
      "Pick a different slug: Donate is already used by Better Giving"
    );
    expect(safeParse(segment, "ORG").issues?.[0]?.message).toBe(
      "Pick a different slug: ORG is reserved"
    );
  });
});
