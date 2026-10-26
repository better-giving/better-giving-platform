import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import type { IForm, IOwnerFormsPageOpts } from "@/forms/interfaces";
import { db } from "../db";
import { forms } from "../schema/form";
import type { DbOrTx, IPage } from "./helpers";
import { decode_date_cursor, encode_date_cursor } from "./helpers";

export type FormRow = typeof forms.$inferSelect;
type FormInsert = typeof forms.$inferInsert;

/**
 * a form row with its derived donation count: parent donations on the form
 * with at least one settled dist. a fund gift settles as one dist per member
 * in separate transactions, and refunds reverse per dist, so no counter
 * written from either side can count the parent once without racing.
 */
export interface IFormListed extends FormRow {
  donation_count: number;
}

// spelled out, not interpolated: drizzle renders a single-table select's
// columns unqualified, which would turn `forms.id` here into `donations.id`
const donation_count = sql<number>`(
  select count(*) from donations d
  where d.form_id = "forms"."id"
    and exists (
      select 1 from dists x where x.donation_id = d.id and x.status = 'settled'
    )
)`.mapWith(Number);

// map compound IForm fields → flat DB columns (used by form_put)
function from_iform(f: IForm): FormInsert {
  const is_npo = /^\d+$/.test(f.owner);
  return {
    id: f.id,
    date_created: f.date_created,
    tag: f.tag,
    name: f.name,
    accent_primary: f.accent_primary,
    accent_secondary: f.accent_secondary,
    donate_methods: f.donate_methods,
    increments: f.increments,
    freq_opts: f.freq_opts,
    owner_npo_id: is_npo ? Number(f.owner) : null,
    owner_user_id: is_npo ? null : f.owner,
    target_smart: f.target === "smart" ? true : null,
    target_number: typeof f.target === "number" ? f.target : null,
    recipient_npo_id: f.recipient_npo_id,
    recipient_fund_id: f.recipient_fund_id,
    ltd: f.ltd,
    ltd_count: f.ltd_count,
    program_id: f.program?.id ?? null,
    program_name: f.program?.name ?? null,
    defaults: f.defaults as Record<string, unknown> | null,
    success_redirect: f.success_redirect,
    status: f.status,
  };
}

export async function form_get(id: string): Promise<FormRow | undefined> {
  const [row] = await db.select().from(forms).where(eq(forms.id, id));
  return row;
}

export async function form_put(data: IForm) {
  await db.insert(forms).values(from_iform(data));
}

export async function form_update(
  id: string,
  update: Partial<Omit<FormInsert, "id">>
) {
  await db
    .update(forms)
    .set({ ...update, updated_at: new Date().toISOString() })
    .where(eq(forms.id, id));
}

/** atomically adjust ltd + ltd_count */
export async function form_ltd_inc(
  db: DbOrTx,
  id: string,
  amount: number,
  one: 1 | -1
) {
  await db
    .update(forms)
    .set({
      ltd: sql`${forms.ltd} + ${amount}`,
      ltd_count: sql`${forms.ltd_count} + ${one}`,
    })
    .where(eq(forms.id, id));
}

/** paginated forms by owner (npo_id or user email) */
export async function forms_owned_by(
  owner: string,
  opts?: IOwnerFormsPageOpts
): Promise<IPage<IFormListed>> {
  const { limit = 10, next, status } = opts || {};
  const cursor = decode_date_cursor(next);

  // owner is either a numeric npo_id or an email
  const is_npo = /^\d+$/.test(owner);
  const owner_filter = is_npo
    ? eq(forms.owner_npo_id, Number(owner))
    : eq(forms.owner_user_id, owner);

  const rows = await db
    .select({ ...getTableColumns(forms), donation_count })
    .from(forms)
    .where(
      and(
        owner_filter,
        status ? eq(forms.status, status) : undefined,
        cursor ? sql`${forms.date_created} < ${cursor}` : undefined
      )
    )
    .orderBy(desc(forms.date_created))
    .limit(limit + 1);

  const has_more = rows.length > limit;
  const items = rows.slice(0, limit);
  return {
    items,
    next: has_more
      ? encode_date_cursor(items[items.length - 1]?.date_created ?? undefined)
      : undefined,
  };
}
