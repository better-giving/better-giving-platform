import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../db";
import { banking_apps } from "../schema/banking";
import { registrations } from "../schema/registration";
import { user_npo_memberships } from "../schema/user";

/** who holds an uploaded document: the owners of the registrations that name
 * it, and the nonprofits whose banking applications do. both empty means no
 * record points at it. */
export interface IDocHolders {
  /** `registrations.r_id` of each registration naming the document */
  reg_owners: string[];
  /** `npo_id` of each banking application naming it */
  npo_ids: number[];
}

export async function doc_holders(ref: string): Promise<IDocHolders> {
  const [regs, apps] = await Promise.all([
    db
      .select({ r_id: registrations.r_id })
      .from(registrations)
      .where(
        or(
          eq(registrations.r_proof_of_identity, ref),
          eq(registrations.o_proof_of_reg, ref),
          eq(registrations.o_bank_statement, ref)
        )
      ),
    db
      .select({ npo_id: banking_apps.npo_id })
      .from(banking_apps)
      .where(eq(banking_apps.bank_statement_url, ref)),
  ]);
  return {
    reg_owners: regs.map((r) => r.r_id),
    npo_ids: apps.map((a) => a.npo_id),
  };
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
