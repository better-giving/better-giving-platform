import { describe, expect, test } from "vitest";
import { type Source, sources_of } from "#/__tests__/conformance/walk";

// the owed ledger is written only through queries/owed.ts's verbs, each by its
// owner. matched as words, not import statements, so a namespace import
// (`o.credit_owed`), an alias, the schema barrel and raw sql are all seen.
// test files and the shared test fixtures seed rows and are not the app
const platform = "apps/platform";
const in_refund_core = (file: string) =>
  file.startsWith(`${platform}/.server/refund/`);
const in_owed_admin = (file: string) =>
  file.startsWith(`${platform}/src/routes/platform.owed/`);
const PAYOUT_RUNS = ["settle.ts", "settle-commissions.ts", "owed-run.ts"].map(
  (f) => `${platform}/.server/payouts/${f}`
);
const in_payout_run = (file: string) => PAYOUT_RUNS.includes(file);
const OWNER: Record<string, (file: string) => boolean> = {
  record_owed: in_refund_core,
  credit_owed: in_refund_core,
  recover_owed: in_payout_run,
  repay_owed: in_payout_run,
  unrecover_owed: in_payout_run,
  write_off_owed: in_owed_admin,
  admin_credit_owed: in_owed_admin,
};
const LEDGER_HOME = [
  `${platform}/.server/pg/queries/owed.ts`,
  `${platform}/.server/pg/queries/owed-history.ts`,
  `${platform}/.server/pg/queries/owed-notice.ts`,
  `${platform}/.server/pg/queries/owed-refund.ts`,
  `${platform}/.server/pg/schema/owed.ts`,
];
const TABLE = /\b(owed_amounts|owed_entries|owed_notices)\b/g;
const VERB = new RegExp(`\\b(${Object.keys(OWNER).join("|")})\\b`, "g");

const uncommented = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(?<![:"'\\])\/\/.*$/gm, "");

/** `file: name` for each reach around the ledger's verbs or past their owners */
function offenders(sources: Source[]): string[] {
  return sources
    .filter(({ file }) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .filter(
      ({ file }) => !file.startsWith(`${platform}/src/__tests__/fixtures/`)
    )
    .filter(({ file }) => !LEDGER_HOME.includes(file))
    .flatMap(({ file, text }) => [
      ...[...text.matchAll(TABLE)].map(([name]) => `${file}: ${name}`),
      ...[...text.matchAll(VERB)]
        .filter(([name]) => !OWNER[name]!(file))
        .map(([name]) => `${file}: ${name}`),
    ]);
}

describe("owed ledger fence", () => {
  test("nothing reaches the ledger's tables or verbs outside their owners", () => {
    const sources = sources_of(import.meta.url, uncommented, [
      `${platform}/src`,
      `${platform}/lib`,
      `${platform}/jobs`,
      `${platform}/.server`,
    ]);
    expect(offenders(sources)).toEqual([]);
  });

  test("the sweep flags a namespace import, a barrel table and a verb off its owner", () => {
    const at = (file: string, text: string): Source => ({
      file: `${platform}/${file}`,
      text: uncommented(text),
    });

    expect(
      offenders([
        at(
          "src/routes/x/api.ts",
          `import * as o from "~/.server/pg/queries/owed";\nawait o.credit_owed(db, c);`
        ),
        at(
          ".server/jobs/y.ts",
          `import { owed_amounts } from "../pg/schema";\nawait tx.update(owed_amounts);`
        ),
        at(".server/refund/z.ts", `await recover_owed(tx, r);`),
        at(".server/refund/w.ts", `await repay_owed(tx, r);`),
        at(".server/refund/v.ts", `await unrecover_owed(tx, u);`),
        at(
          ".server/payouts/owed-run.ts",
          `await recover_owed(tx, r);\nawait repay_owed(tx, r);`
        ),
        at(".server/payouts/settle.ts", `await unrecover_owed(tx, u);`),
        at(
          ".server/payouts/settle-commissions.ts",
          `await unrecover_owed(tx, u);`
        ),
        at(".server/payouts/wise-pay.ts", `await recover_owed(tx, r);`),
        at(".server/refund/ok.ts", `await credit_owed(tx, c); // owed_amounts`),
        at(
          "src/routes/platform.owed/api.ts",
          `await write_off_owed(tx, w);\nawait admin_credit_owed(tx, c);`
        ),
        at("src/routes/platform.losses/api.ts", `await write_off_owed(tx, w);`),
        at(".server/jobs/n.ts", `await tx.update(owed_notices);`),
      ])
    ).toEqual([
      `${platform}/src/routes/x/api.ts: credit_owed`,
      `${platform}/.server/jobs/y.ts: owed_amounts`,
      `${platform}/.server/jobs/y.ts: owed_amounts`,
      `${platform}/.server/refund/z.ts: recover_owed`,
      `${platform}/.server/refund/w.ts: repay_owed`,
      `${platform}/.server/refund/v.ts: unrecover_owed`,
      `${platform}/.server/payouts/wise-pay.ts: recover_owed`,
      `${platform}/src/routes/platform.losses/api.ts: write_off_owed`,
      `${platform}/.server/jobs/n.ts: owed_notices`,
    ]);
  });
});
