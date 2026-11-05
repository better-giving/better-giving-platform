import { and, eq, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { steps } from "#/pages/registration/routes";
import { EDITABLE } from "@/reg/schema";
import {
  CONNECT_REASON_PARAM,
  CONNECT_RESULT_PARAM,
  type TConnectErrorReason,
  type TConnectResult,
} from "@/stripe-connect/return";
import { db } from "../pg/db";
import type { DbOrTx } from "../pg/queries/helpers";
import { reg_get, reg_update_from } from "../pg/queries/registration";
import { npos } from "../pg/schema/npo";
import { registrations } from "../pg/schema/registration";
import { user_npo_memberships } from "../pg/schema/user";
import type { TConnectTarget } from "./state";
import { account_status_live } from "./sync";

export interface IConnectActor {
  id: string;
  email: string;
  role?: string | null;
}

export type TTargetAccess =
  | {
      ok: true;
      acct: string | null;
      /** a connect would replace a live account, so it needs confirming. an
       * account that disconnected us is held but no longer live */
      replaces: boolean;
    }
  | { ok: false; status: 403 | 404 };

/** whether `actor` may connect an account to `t`, and the account it holds now.
 * registration: its applicant or an admin, while it is still editable; an
 * account stripe refuses us is dropped from it here.
 * npo: a member or an admin. */
export async function target_access(
  actor: IConnectActor,
  t: TConnectTarget
): Promise<TTargetAccess> {
  const is_admin = actor.role === "admin";

  if (t.kind === "reg") {
    const reg = await reg_get(t.reg_id);
    if (!reg) return { ok: false, status: 404 };
    if (reg.r_id !== actor.email && !is_admin)
      return { ok: false, status: 403 };
    // in review or decided, the write is refused anyway — refused here, it is
    // refused before stripe links an account that would then be stored nowhere
    if (!EDITABLE.includes(reg.status)) return { ok: false, status: 403 };
    const held = reg.o_stripe_account_id ?? null;
    if (held === null) return { ok: true, acct: null, replaces: false };
    if ((await account_status_live(held)) !== "disconnected") {
      return { ok: true, acct: held, replaces: true };
    }
    // stripe refusing the read is the disconnect, its deauthorized event late
    // or lost: dropped as that event drops it, since by the callback a
    // reconnect of this same account reads live again
    const { won } = await reg_update_from(
      db,
      reg.id,
      EDITABLE,
      { o_stripe_account_id: null },
      eq(registrations.o_stripe_account_id, held)
    );
    // lost: the row moved meanwhile, and the callback's own read judges it
    return { ok: true, acct: won ? null : held, replaces: false };
  }

  const [npo] = await db
    .select({
      acct: npos.stripe_account_id,
      deauthorized_at: npos.stripe_deauthorized_at,
    })
    .from(npos)
    .where(eq(npos.id, t.npo_id));
  if (!npo) return { ok: false, status: 404 };
  const granted = {
    ok: true,
    acct: npo.acct,
    replaces: npo.acct !== null && npo.deauthorized_at === null,
  } as const;
  if (is_admin) return granted;

  const [member] = await db
    .select({ npo_id: user_npo_memberships.npo_id })
    .from(user_npo_memberships)
    .where(
      and(
        eq(user_npo_memberships.user_id, actor.id),
        eq(user_npo_memberships.npo_id, t.npo_id)
      )
    )
    .limit(1);
  return member ? granted : { ok: false, status: 403 };
}

/** whether `acct` already belongs to an npo or a registration other than `t`.
 * approved registrations are skipped: their account lives on the npo now, or
 * was replaced there. rejected ones are skipped too: they keep the account to
 * resubmit with until another target claims it, which `release_rejected`
 * takes it from them. a pending one would collide with this one at approval. */
export async function held_elsewhere(
  acct: string,
  t: TConnectTarget,
  q: DbOrTx = db
): Promise<boolean> {
  const [npo] = await q
    .select({ id: npos.id })
    .from(npos)
    .where(
      and(
        eq(npos.stripe_account_id, acct),
        t.kind === "npo" ? ne(npos.id, t.npo_id) : undefined
      )
    )
    .limit(1);
  if (npo) return true;

  const [reg] = await q
    .select({ id: registrations.id })
    .from(registrations)
    .where(
      and(
        eq(registrations.o_stripe_account_id, acct),
        or(
          isNull(registrations.status),
          notInArray(registrations.status, ["03", "04"])
        ),
        t.kind === "reg" ? ne(registrations.id, t.reg_id) : undefined
      )
    )
    .limit(1);
  return !!reg;
}

/** `t` has claimed `acct`, so a rejected registration holding it drops it.
 * kept, its resubmit would be refused on the account (step 5's submit re-runs
 * `held_elsewhere` under `lock_acct`); dropped, banking asks it for another.
 * call inside the claim's `lock_acct` transaction, once `t`'s write has won */
export async function release_rejected(
  acct: string,
  t: TConnectTarget,
  tx: DbOrTx
) {
  await tx
    .update(registrations)
    .set({ o_stripe_account_id: null, o_stripe_connected_at: null })
    .where(
      and(
        eq(registrations.o_stripe_account_id, acct),
        eq(registrations.status, "04"),
        t.kind === "reg" ? ne(registrations.id, t.reg_id) : undefined
      )
    );
}

/** one claim of `acct` at a time, until `tx` ends. registrations carry no
 * unique index on their account, so `held_elsewhere` and the write after it
 * hold across targets only while every claim takes this first */
export async function lock_acct(tx: DbOrTx, acct: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`stripe-connect:${acct}`}, 0))`
  );
}

/** the page a connect for `t` started from, carrying how it ended */
export function return_path(
  t: TConnectTarget,
  result: Exclude<TConnectResult, "error">
): string;
export function return_path(
  t: TConnectTarget,
  result: "error",
  reason: TConnectErrorReason
): string;
export function return_path(
  t: TConnectTarget,
  result: TConnectResult,
  reason?: TConnectErrorReason
): string {
  const path =
    t.kind === "reg"
      ? `/register/${t.reg_id}/${steps.banking}`
      : `/admin/${t.npo_id}/banking`;
  const q = new URLSearchParams({ [CONNECT_RESULT_PARAM]: result });
  if (reason) q.set(CONNECT_REASON_PARAM, reason);
  return `${path}?${q}`;
}
