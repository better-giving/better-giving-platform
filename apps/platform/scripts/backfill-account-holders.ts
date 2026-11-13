import { wise } from "../.server/kit/wise";
import {
  bapp_set_holder,
  bapps_missing_holder,
  npo_legal_names,
} from "../.server/pg/queries/banking";
import { holder_match } from "../lib/banking/holder-match";

/**
 * store the wise account holder on every approved or default banking
 * application that has none, and list the ones whose holder isn't the npo's
 * legal name.
 *
 * `bun scripts/backfill-account-holders.ts [--write]`. dry run unless
 * `--write`. reads and writes whichever database and wise environment the
 * loaded env points at, so name the env file for anything but dev, and pair
 * it with that environment's wise token.
 *
 * idempotent: only rows with no holder are read, and the write is guarded on
 * the holder still being null, so a stored holder is never overwritten and a
 * rerun picks up where a failed one stopped.
 */
const write = process.argv.includes("--write");
const PAGE = 100;
// wise rate-limits per token; the payout crons share this one
const GAP_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let seen = 0;
let stored = 0;
let unreachable = 0;
let nameless = 0;
const mismatches: string[] = [];

let after: string | undefined;
for (;;) {
  const rows = await bapps_missing_holder(PAGE, after);
  if (rows.length === 0) break;
  after = rows.at(-1)?.id;
  const legal = await npo_legal_names([...new Set(rows.map((r) => r.npo_id))]);

  for (const r of rows) {
    seen++;
    const acc = await wise.v2_account(+r.id).catch((err) => {
      console.error(`bapp ${r.id}: wise lookup failed: ${String(err)}`);
      return null;
    });
    await sleep(GAP_MS);
    if (!acc) {
      unreachable++;
      continue;
    }
    const holder = acc.name?.fullName?.trim();
    if (!holder) {
      nameless++;
      continue;
    }
    const legal_name = legal.get(r.npo_id);
    if (holder_match(holder, legal_name) !== "match") {
      mismatches.push(
        `bapp ${r.id} npo ${r.npo_id}: holder "${holder}" vs legal name ${legal_name ? `"${legal_name}"` : "(none on file)"}`
      );
    }
    if (write && (await bapp_set_holder(r.id, holder))) stored++;
  }
}

console.info(`\n${write ? "WRITE" : "DRY RUN"}: ${seen} without a holder`);
console.info(
  `  ${write ? "stored" : "would store"}  ${write ? stored : seen - unreachable - nameless}`
);
console.info(`  wise lookup failed  ${unreachable}`);
console.info(`  wise gave no name   ${nameless}`);
console.info(`  holder isn't the legal name: ${mismatches.length}`);
for (const m of mismatches) console.info(`    ${m}`);
process.exit(0);
