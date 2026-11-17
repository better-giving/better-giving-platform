import { describe, expect, test } from "vitest";
import { sources_of } from "#/__tests__/conformance/walk";

// every refund and chargeback reverses through `reverse_charge`; the refund
// core's internals stay behind it so a rail can't hand-roll the load/guard again
const platform = "apps/platform";
const fenced = `${platform}/.server/refund/`;
const internal_module =
  /(^|\/)refund\/(process|plan|apply|unfunded|partial|share)(\.tsx?)?$/;
const internal_name = /\b(dists_for_refund|load_refund_plan|process_refund)\b/;
// payout settlement rewrites the loss a refund recorded once that payout's
// transfer goes unfunded, and a return once the bank sends it back: no charge
// goes back to a donor there
const UNFUNDED_USERS = ["settle.ts", "wise-return.ts"].map(
  (f) => `${platform}/.server/payouts/${f}`
);
const exempt = (file: string, from: string) =>
  UNFUNDED_USERS.includes(file) && /refund\/unfunded$/.test(from);

// blanked, not deleted, so a wrapped import stays one statement
const uncommented = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(?<![:"'\\])\/\/.*$/gm, "");

const statements = [
  // `import x, { a, b } from "m"`, `export * as n from "m"`, any line wrapping
  /\b(?:import|export)\s+(?:type\s+)?((?:[\w$]+\s*,\s*)?(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)|[\w$]+)\s*from\s*["']([^"']+)["']/g,
  // `const { a } = await import("m")` and a bare `import("m")`
  /(?:\{([^{}]*)\}\s*=\s*await\s+)?\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  // `import "m"`
  /\bimport\s*()["']([^"']+)["']/g,
];

/** `file: statement` for each import outside the refund core that `bad` flags */
const imports_outside_core = (
  bad: (file: string, names: string, from: string) => boolean
) =>
  sources_of(import.meta.url, uncommented, [
    `${platform}/src`,
    `${platform}/lib`,
    `${platform}/jobs`,
    `${platform}/.server`,
  ])
    .filter(({ file }) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .filter(({ file }) => !file.startsWith(fenced))
    .flatMap(({ file, text }) =>
      statements.flatMap((re) =>
        [...text.matchAll(re)]
          .filter(([, names = "", from = ""]) => bad(file, names, from))
          .map(([s]) => `${file}: ${s.replace(/\s+/g, " ")}`)
      )
    );

describe("refund core boundary", () => {
  test("nothing outside the refund core imports its internals", () => {
    const offenders = imports_outside_core(
      (file, names, from) =>
        !exempt(file, from) &&
        (internal_module.test(from) || internal_name.test(names))
    );
    expect(offenders).toEqual([]);
  });
});
