import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "../.server/pg/db";
import { payouts, settlements } from "../.server/pg/schema/payout";
import { DELIVERED, ON_PATH } from "../lib/payouts/wise-path";

/**
 * brings the payout history from before "a payout settles when Wise reports it
 * sent" to the new meaning, from each run's stored Wise state
 * (`settlements.status`). a grants run used to turn its payouts `settled` the
 * moment it was funded; now they are `processing` until the transfer is
 * reported sent, and `bounced` while Wise reports it off the ordinary path.
 *
 * for every settlement of a real transfer (`other_id` set, amount above 0)
 * whose payouts (`settled_id`) are still `settled`:
 *
 * - stored state `outgoing_payment_sent`: delivered history, left `settled`.
 * - stored state on the ordinary path before that (`incoming_payment_*`,
 *   `processing`, `funds_converted`): `processing`.
 * - stored state never read (`""`): `processing` when the run is inside the
 *   poll window (the next poll settles or bounces it), else left `settled` and
 *   listed under `unread`, because nothing will read its state again.
 * - stored state off the ordinary path (`bounced_back`, `cancelled`,
 *   `charged_back`, anything Wise adds): `bounced`.
 * - `returned`, `awaiting_repair`, `funds_refunded`: nothing to do, their
 *   payouts are already taken back or being repaired.
 *
 * a run of no transfer (`other_id` null: paid out of what the npo owed) is
 * never touched. a payout that is no longer `settled` when the write reaches
 * it (a refund, a return) is left as it is.
 *
 * ## Running
 *
 * env (a `--env-file` or the shell): `DATABASE_URL`, the database to read and
 * write. Check it is the one you mean before passing `--commit`.
 *
 * 1. dry run, the default: `bun --env-file=<env> jobs/payout-delivery-backfill.ts`.
 *    writes nothing. prints one json line per payout it would change
 *    (`payout_id`, `npo_id`, `settlement_id`, `state`, `from`, `to`, `amount`),
 *    then the npos a `bounced` run would put on hold, then a summary line.
 * 2. commit: the same command with `--commit`. one transaction per settlement,
 *    under the npo's grants-run lock. a rerun changes nothing it already did.
 * 3. verify: run the dry run again; it should list 0 payouts to change.
 *
 * run the dry run first and read the bounced and held lists: a `bounced` run
 * holds its npo's grants until a different account is approved, or Wise
 * delivers the transfer.
 */

/** wise state polls cover: `WINDOW_DAYS` in `.server/payouts/wise-states.ts` */
const WINDOW_DAYS = 90;

export type Target = "processing" | "bounced";

/** what a `settled` payout of a run in `state` is now, null to leave it */
export function target_for(
  state: string,
  run_date: string,
  now: number
): Target | "unread" | null {
  if (state === DELIVERED) return null;
  if (["returned", "awaiting_repair", "funds_refunded"].includes(state)) {
    return null;
  }
  if (state === "") {
    const age_ms = now - Date.parse(run_date);
    return age_ms <= WINDOW_DAYS * 24 * 60 * 60 * 1000 ? "processing" : "unread";
  }
  return ON_PATH.includes(state) ? "processing" : "bounced";
}

export interface IChange {
  payout_id: string;
  npo_id: number;
  settlement_id: string;
  state: string;
  from: "settled";
  to: Target;
  amount: number;
}

export interface IOpts {
  commit: boolean;
  now: number;
}

export interface ISummary {
  to_change: number;
  changed: number;
  /** moved on since it was read, so left as it is */
  skipped: number;
  /** settled payouts of a run never read and out of the poll window */
  unread: number;
  bounced_npos: number[];
}

export interface IDeps {
  log: (line: string) => void;
}

export async function run(opts: IOpts, deps: IDeps): Promise<ISummary> {
  const sum: ISummary = {
    to_change: 0,
    changed: 0,
    skipped: 0,
    unread: 0,
    bounced_npos: [],
  };
  const runs = await db
    .select()
    .from(settlements)
    .where(
      and(
        isNotNull(settlements.other_id),
        isNotNull(settlements.npo_id),
        sql`${settlements.amount} > 0`,
        ne(settlements.status, DELIVERED)
      )
    )
    .orderBy(asc(settlements.date), asc(settlements.id));
  const bounced = new Set<number>();

  for (const s of runs) {
    const to = target_for(s.status, s.date, opts.now);
    if (to === null) continue;
    const rows = await db
      .select({ id: payouts.id, amount: payouts.amount })
      .from(payouts)
      .where(and(eq(payouts.settled_id, s.id), eq(payouts.type, "settled")))
      .orderBy(asc(payouts.id));
    if (rows.length === 0) continue;
    if (to === "unread") {
      sum.unread += rows.length;
      deps.log(
        JSON.stringify({
          unread: true,
          settlement_id: s.id,
          npo_id: s.npo_id,
          payout_ids: rows.map((r) => r.id),
        })
      );
      continue;
    }
    for (const r of rows) {
      const change: IChange = {
        payout_id: r.id,
        npo_id: s.npo_id!,
        settlement_id: s.id,
        state: s.status,
        from: "settled",
        to,
        amount: r.amount,
      };
      deps.log(JSON.stringify(change));
    }
    sum.to_change += rows.length;
    if (to === "bounced") bounced.add(s.npo_id!);
    if (!opts.commit) continue;

    const moved = await db.transaction(async (tx) => {
      // the lock a grants run, a poll and a return take for this npo
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`grant_run:npo:${s.npo_id}`}, 0))`
      );
      const hit = await tx
        .update(payouts)
        .set(
          to === "processing"
            ? { type: to, message: s.other_id, settled_date: null }
            : { type: to, message: null }
        )
        .where(
          and(
            eq(payouts.settled_id, s.id),
            eq(payouts.type, "settled"),
            inArray(
              payouts.id,
              rows.map((r) => r.id)
            )
          )
        )
        .returning({ id: payouts.id });
      return hit.length;
    });
    sum.changed += moved;
    sum.skipped += rows.length - moved;
  }

  sum.bounced_npos = [...bounced].sort((a, b) => a - b);
  deps.log(
    JSON.stringify({
      held_by_bounce: sum.bounced_npos,
      note: "these npos' grants are held while a run stays bounced",
    })
  );
  deps.log(
    `${opts.commit ? "commit" : "dry run"}: ${sum.to_change} to change, ${sum.changed} changed, ${sum.skipped} moved on since read, ${sum.unread} unread and left settled, ${sum.bounced_npos.length} npos held by a bounce`
  );
  return sum;
}

if (import.meta.main) {
  const commit = process.argv.includes("--commit");
  await run({ commit, now: Date.now() }, { log: (l) => console.info(l) });
  process.exit(0);
}
