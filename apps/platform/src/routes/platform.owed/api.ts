import * as v from "valibot";
import { user_ctx } from "#/.server/auth";
import type { IOwedRow } from "#/pages/platform-admin/owed/types";
import { resp } from "@/helpers/https";
import { db } from "$/pg/db";
import {
  admin_credit_owed,
  type OwedCreditReason,
  owed_list,
  write_off_owed,
} from "$/pg/queries/owed";
import type { Route } from "./+types/route";

const list_query = v.object({
  party: v.optional(v.picklist(["all", "npo", "referrer"]), "all"),
  sort: v.optional(v.picklist(["date", "outstanding"]), "date"),
  dir: v.optional(v.picklist(["asc", "desc"]), "desc"),
  next: v.optional(v.string()),
});

export const loader = async ({ url }: Route.LoaderArgs) => {
  const s = url.searchParams;
  const p = v.safeParse(list_query, {
    party: s.get("party") ?? undefined,
    sort: s.get("sort") ?? undefined,
    dir: s.get("dir") ?? undefined,
    next: s.get("next") ?? undefined,
  });
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const { party, sort, dir, next } = p.output;

  const page = await owed_list({
    party: party === "all" ? undefined : party,
    sort,
    dir,
    next,
  });
  const items: IOwedRow[] = page.items;
  return { items, next: page.next, party, sort, dir };
};

const reason = v.pipe(v.string(), v.trim(), v.nonEmpty("A reason is required"));
const owed_id = v.pipe(v.string(), v.nonEmpty("A row is required"));

/** the refund core books its own credits under these; the ledger refuses
 * them from an admin, as a throw this would answer with a 500 */
const RESERVED: Record<OwedCreditReason, true> = {
  payout_cancelled: true,
  transfer_unfunded: true,
  dispute_reversed: true,
  dispute_won: true,
  dispute_won_fee: true,
  dispute_won_fee_dispute: true,
  refund_failed: true,
  refund_failed_fee: true,
};
const credit_reason = v.pipe(
  reason,
  v.check(
    (r) => !Object.hasOwn(RESERVED, r),
    "That reason is reserved for credits the system books. Describe this credit in your own words."
  )
);

const body = v.variant("intent", [
  v.object({ intent: v.literal("write_off"), owed_id, reason }),
  v.object({
    intent: v.literal("credit"),
    owed_id,
    usd: v.pipe(
      v.number("An amount is required"),
      v.finite("An amount is required"),
      v.gtValue(0, "The amount must be more than $0")
    ),
    reason: credit_reason,
    ref: v.pipe(v.string(), v.trim(), v.nonEmpty("A reference is required")),
  }),
]);
type TBody = v.InferOutput<typeof body>;

interface IDone {
  ok: true;
}

/** what the action answers: `resp.fail`'s body on a refusal, which typegen
 * can't see through the `Response` */
export type TOwedAnswer = IDone | { status: number; message: string };

const done: IDone = { ok: true };

export const action = async ({ request, context }: Route.ActionArgs) => {
  const p = v.safeParse(body, await request.json().catch(() => null));
  if (p.issues) return resp.fail(400, p.issues[0].message);
  const actor = context.get(user_ctx).id;
  const now = new Date().toISOString();

  return p.output.intent === "write_off"
    ? write_off(p.output, actor, now)
    : credit(p.output, actor, now);
};

async function write_off(
  x: Extract<TBody, { intent: "write_off" }>,
  actor: string,
  now: string
) {
  const row = await db.transaction((tx) =>
    write_off_owed(tx, { owed_id: x.owed_id, reason: x.reason, actor, now })
  );
  if (!row) return resp.fail(409, "Nothing left to write off");
  return done;
}

const OVER = "That is more than this row has outstanding";
class OverCredit extends Error {}

async function credit(
  x: Extract<TBody, { intent: "credit" }>,
  actor: string,
  now: string
) {
  const { owed_id, usd, reason, ref } = x;
  try {
    const row = await db.transaction(async (tx) => {
      const r = await admin_credit_owed(tx, {
        owed_id,
        usd,
        reason,
        ref,
        actor,
        now,
      });
      // past what is outstanding the party would be due money back; throwing
      // rolls the credit back
      if (r && (r.outstanding_usd ?? 0) < 0) throw new OverCredit();
      return r;
    });
    if (!row) return resp.fail(404, "This row no longer exists");
    if (!row.added) {
      return resp.fail(
        409,
        `The reference ${ref} was already used for a credit on this row`
      );
    }
    return done;
  } catch (err) {
    // the ledger's own bound on the same thing: credited plus written off
    // past what was owed, as on a row already written off
    if (err instanceof OverCredit || violates(err, OVER_SETTLED)) {
      return resp.fail(409, OVER);
    }
    throw err;
  }
}

const OVER_SETTLED = "owed_amounts_settled_within_owed_check";

/** drizzle wraps the driver's error, so the postgres fields sit on a `cause` */
function violates(err: unknown, constraint: string): boolean {
  for (let e = err; e instanceof Error; e = e.cause) {
    const pg = e as Error & { code?: unknown; constraint?: unknown };
    if (pg.code === "23514") return pg.constraint === constraint;
  }
  return false;
}
