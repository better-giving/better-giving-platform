import { and, eq, inArray, or } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "../db";
import { banking_apps } from "../schema/banking";
import { doc_url_aliases } from "../schema/doc-alias";
import { registrations } from "../schema/registration";
import { user_npo_memberships } from "../schema/user";

/** who holds an uploaded document: the owners of the registrations that name
 * it, and the nonprofits whose banking applications do. both empty means no
 * record points at it. a url a record held before its document moved names
 * whoever holds the copy now. */
export interface IDocHolders {
  /** `registrations.r_id` of each registration naming the document */
  reg_owners: string[];
  /** `npo_id` of each banking application naming it */
  npo_ids: number[];
}

export async function doc_holders(ref: string): Promise<IDocHolders> {
  const holds = (col: PgColumn) =>
    or(
      eq(col, ref),
      inArray(
        col,
        db
          .select({ url: doc_url_aliases.new_url })
          .from(doc_url_aliases)
          .where(eq(doc_url_aliases.old_url, ref))
      )
    );
  const [regs, apps] = await Promise.all([
    db
      .select({ r_id: registrations.r_id })
      .from(registrations)
      .where(
        or(
          holds(registrations.r_proof_of_identity),
          holds(registrations.o_proof_of_reg),
          holds(registrations.o_bank_statement)
        )
      ),
    db
      .select({ npo_id: banking_apps.npo_id })
      .from(banking_apps)
      .where(holds(banking_apps.bank_statement_url)),
  ]);
  return {
    reg_owners: regs.map((r) => r.r_id),
    npo_ids: apps.map((a) => a.npo_id),
  };
}

/** the private copy the job made of an older stored url, if it did */
export async function moved_copy(ref: string): Promise<string | undefined> {
  const [row] = await db
    .select({ url: doc_url_aliases.new_url })
    .from(doc_url_aliases)
    .where(eq(doc_url_aliases.old_url, ref))
    .limit(1);
  return row?.url;
}

/** whether the user is an admin of any of the nonprofits */
export async function is_npo_member(
  user_id: string,
  npo_ids: number[]
): Promise<boolean> {
  if (npo_ids.length === 0) return false;
  const [row] = await db
    .select({ npo_id: user_npo_memberships.npo_id })
    .from(user_npo_memberships)
    .where(
      and(
        eq(user_npo_memberships.user_id, user_id),
        inArray(user_npo_memberships.npo_id, npo_ids)
      )
    )
    .limit(1);
  return !!row;
}
