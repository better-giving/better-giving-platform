import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import {
  type IDonation,
  type IDonationSettled,
  type IDonationUpdate,
  type IDonsFromOpts,
  reversed_statuses,
} from "@/donations";
import { db } from "../db";
import { is_unique_violation } from "../errors";
import { dists } from "../schema/dist";
import {
  DONATION_SETTLEMENTS_STTL_ID_IDX,
  donation_donors,
  donation_recipients,
  donation_settlements,
  donation_tributes,
  donations,
} from "../schema/donation";
import type { DistRow } from "./dist";
import type { DbOrTx, IPage } from "./helpers";
import { decode_date_cursor, encode_date_cursor } from "./helpers";

// -- row → IDonation assembly --

type DonRow = typeof donations.$inferSelect;
type RecipientRow = typeof donation_recipients.$inferSelect | undefined;
type DonorRow = typeof donation_donors.$inferSelect | undefined;
type SettlementRow = typeof donation_settlements.$inferSelect | undefined;
type TributeRow = typeof donation_tributes.$inferSelect | undefined;

/** reconstruct flat IDonation from normalized PG rows */
function to_donation(
  don: DonRow,
  recipient: RecipientRow,
  donor: DonorRow,
  settlement: SettlementRow,
  tribute: TributeRow
): IDonation {
  const addr = donor?.addr;

  return {
    id: don.id,
    id_v1: don.id_v1 ?? undefined,
    upusd: don.upusd,
    status: don.status,
    created_at: don.created_at,
    updated_at: don.updated_at,
    amount: {
      base: don.amount_base,
      tip: don.amount_tip,
      fee_allowance: don.amount_fee_allowance,
    },
    currency: don.currency,
    frequency: don.frequency,
    source: don.source,
    source_id: don.source_id ?? undefined,
    form_id: don.form_id ?? undefined,
    subscription_id: don.subscription_id ?? undefined,
    via: don.via,
    via_extra: don.via_extra ?? undefined,
    program: don.program_id
      ? { id: don.program_id, name: don.program_name ?? "" }
      : undefined,
    campaign_id: don.campaign_id ?? undefined,

    // recipient → ITo
    to_id: recipient ? String(recipient.npo_id ?? recipient.fund_id ?? "") : "",
    to_name: recipient?.name ?? "",
    to_type: (recipient?.type as "npo" | "fund") ?? "npo",
    to_tip_allowed: recipient?.tip_allowed ?? false,
    to_members: recipient?.members?.map(String) ?? [],

    // donor → IFrom + IFromLegacyOrPostDonation
    from_email: donor?.email ?? "",
    from_name: donor?.name ?? undefined,
    from_title: donor?.title ?? undefined,
    from_company_name: donor?.company_name ?? undefined,
    from_addr_street: addr?.street ?? undefined,
    from_addr_city: addr?.city ?? undefined,
    from_addr_state: addr?.state ?? undefined,
    from_addr_zip_code: addr?.zip_code ?? undefined,
    from_addr_country: addr?.country ?? undefined,
    from_wallet_addr: donor?.wallet_addr ?? undefined,
    from_public_msg_to_npo: donor?.public_msg ?? undefined,
    from_private_msg_to_npo: donor?.private_msg ?? undefined,
    from_public: donor?.is_public ?? undefined,

    // settlement
    settlement: settlement
      ? {
          id: settlement.sttl_id,
          date: settlement.date,
          currency: settlement.currency,
          net: settlement.net,
          fee: settlement.fee,
          fee_parts: settlement.fee_parts ?? undefined,
        }
      : undefined,

    hold:
      don.held_at && don.hold_asset
        ? { asset: don.hold_asset, at: don.held_at }
        : undefined,

    // tribute
    tribute: tribute
      ? {
          full_name: tribute.name,
          notif: tribute.notif_email
            ? {
                to_email: tribute.notif_email,
                to_fullname: tribute.notif_fullname ?? "",
                from_msg: tribute.notif_msg ?? "",
              }
            : undefined,
        }
      : undefined,
  } as IDonation;
}

/** fetch all subtables for a donation id */
async function fetch_subtables(don_id: string, conn: DbOrTx = db) {
  const [recipient, donor, settlement, tribute] = await Promise.all([
    conn
      .select()
      .from(donation_recipients)
      .where(eq(donation_recipients.donation_id, don_id))
      .then((r) => r[0]),
    conn
      .select()
      .from(donation_donors)
      .where(eq(donation_donors.donation_id, don_id))
      .then((r) => r[0]),
    conn
      .select()
      .from(donation_settlements)
      .where(eq(donation_settlements.donation_id, don_id))
      .then((r) => r[0]),
    conn
      .select()
      .from(donation_tributes)
      .where(eq(donation_tributes.donation_id, don_id))
      .then((r) => r[0]),
  ]);
  return { recipient, donor, settlement, tribute } as const;
}

/** batch-fetch subtables for multiple donation ids */
async function fetch_subtables_batch(don_ids: string[]) {
  if (don_ids.length === 0)
    return { recipients: [], donors: [], settlements: [], tributes: [] };

  const [recipients, donors, settlements, tributes] = await Promise.all([
    db
      .select()
      .from(donation_recipients)
      .where(inArray(donation_recipients.donation_id, don_ids)),
    db
      .select()
      .from(donation_donors)
      .where(inArray(donation_donors.donation_id, don_ids)),
    db
      .select()
      .from(donation_settlements)
      .where(inArray(donation_settlements.donation_id, don_ids)),
    db
      .select()
      .from(donation_tributes)
      .where(inArray(donation_tributes.donation_id, don_ids)),
  ]);
  return { recipients, donors, settlements, tributes };
}

/** index subtable rows by donation_id, assemble IDonation[] */
function assemble_batch(
  dons: DonRow[],
  subs: Awaited<ReturnType<typeof fetch_subtables_batch>>
): Map<string, IDonation> {
  const recip_map = new Map(subs.recipients.map((r) => [r.donation_id, r]));
  const donor_map = new Map(subs.donors.map((r) => [r.donation_id, r]));
  const sttl_map = new Map(subs.settlements.map((r) => [r.donation_id, r]));
  const trib_map = new Map(subs.tributes.map((r) => [r.donation_id, r]));

  const out = new Map<string, IDonation>();
  for (const d of dons) {
    out.set(
      d.id,
      to_donation(
        d,
        recip_map.get(d.id),
        donor_map.get(d.id),
        sttl_map.get(d.id),
        trib_map.get(d.id)
      )
    );
  }
  return out;
}

// -- donations --

/**
 * split IDonation into base + subtable inserts, all or none: its own
 * transaction on the bare db, a savepoint inside a caller's.
 */
export async function donation_put(
  db_or_tx: DbOrTx,
  data: IDonation
): Promise<IDonation> {
  return db_or_tx.transaction(async (tx) => {
    const base: typeof donations.$inferInsert = {
      id: data.id,
      id_v1: data.id_v1,
      upusd: data.upusd,
      status: data.status,
      amount_base: data.amount.base,
      amount_tip: data.amount.tip,
      amount_fee_allowance: data.amount.fee_allowance,
      currency: data.currency,
      frequency: data.frequency,
      source: data.source,
      source_id: data.source_id,
      form_id: data.form_id,
      subscription_id: data.subscription_id,
      via: data.via,
      via_extra: data.via_extra,
      program_id: data.program?.id,
      program_name: data.program?.name,
      campaign_id: data.campaign_id,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };

    await tx.insert(donations).values(base);

    // recipient
    const recip: typeof donation_recipients.$inferInsert = {
      donation_id: data.id,
      name: data.to_name,
      type: data.to_type,
      tip_allowed: data.to_tip_allowed,
      members:
        data.to_members?.length > 0
          ? data.to_members.map((m) => Number(m))
          : null,
      ...(data.to_type === "fund"
        ? { fund_id: data.to_id }
        : { npo_id: Number(data.to_id) }),
    };
    await tx.insert(donation_recipients).values(recip);

    // donor
    const addr_obj =
      data.from_addr_street || data.from_addr_city
        ? {
            street: data.from_addr_street,
            city: data.from_addr_city,
            state: data.from_addr_state,
            zip_code: data.from_addr_zip_code,
            country: data.from_addr_country,
          }
        : null;

    const donor: typeof donation_donors.$inferInsert = {
      donation_id: data.id,
      email: data.from_email,
      name: data.from_name ?? null,
      title: data.from_title ?? null,
      company_name: data.from_company_name ?? null,
      addr: addr_obj,
      wallet_addr: data.from_wallet_addr ?? null,
      public_msg: data.from_public_msg_to_npo ?? null,
      private_msg: data.from_private_msg_to_npo ?? null,
      is_public: data.from_public ?? null,
    };
    await tx.insert(donation_donors).values(donor);

    // settlement (optional)
    if (data.settlement) {
      await tx.insert(donation_settlements).values({
        donation_id: data.id,
        sttl_id: data.settlement.id,
        date: data.settlement.date,
        currency: data.settlement.currency,
        net: data.settlement.net,
        fee: data.settlement.fee,
        fee_parts: data.settlement.fee_parts,
      });
    }

    // tribute (optional)
    if (data.tribute) {
      await tx.insert(donation_tributes).values({
        donation_id: data.id,
        name: data.tribute.full_name,
        notif_email: data.tribute.notif?.to_email ?? null,
        notif_fullname: data.tribute.notif?.to_fullname ?? null,
        notif_msg: data.tribute.notif?.from_msg ?? null,
      });
    }

    return data;
  });
}

export async function donation_recipient_put(
  db: DbOrTx,
  data: typeof donation_recipients.$inferInsert
) {
  await db.insert(donation_recipients).values(data);
}

export async function donation_donor_put(
  db: DbOrTx,
  data: typeof donation_donors.$inferInsert
) {
  await db.insert(donation_donors).values(data);
}

export async function donation_settlement_upsert(
  db: DbOrTx,
  data: typeof donation_settlements.$inferInsert
) {
  await db
    .insert(donation_settlements)
    .values(data)
    .onConflictDoUpdate({
      target: donation_settlements.donation_id,
      set: {
        sttl_id: data.sttl_id,
        date: data.date,
        currency: data.currency,
        net: data.net,
        fee: data.fee,
        fee_parts: data.fee_parts,
      },
    });
}

export async function donation_tribute_upsert(
  db: DbOrTx,
  data: typeof donation_tributes.$inferInsert
) {
  await db
    .insert(donation_tributes)
    .values(data)
    .onConflictDoUpdate({
      target: donation_tributes.donation_id,
      set: {
        name: data.name,
        notif_email: data.notif_email,
        notif_fullname: data.notif_fullname,
        notif_msg: data.notif_msg,
      },
    });
}

export async function donation_get(id: string): Promise<IDonation | undefined> {
  const [don] = await db
    .select()
    .from(donations)
    .where(or(eq(donations.id, id), eq(donations.id_v1, id)));
  if (!don) return undefined;

  const subs = await fetch_subtables(don.id);
  return to_donation(
    don,
    subs.recipient,
    subs.donor,
    subs.settlement,
    subs.tribute
  );
}

export async function donation_batch_get(
  ids: string[]
): Promise<(IDonation | undefined)[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(donations)
    .where(or(inArray(donations.id, ids), inArray(donations.id_v1, ids)));

  const don_ids = rows.map((r) => r.id);
  const subs = await fetch_subtables_batch(don_ids);
  const assembled = assemble_batch(rows, subs);

  // preserve input order, support lookup by id or id_v1
  const by_id = new Map<string, IDonation>();
  for (const [, don] of assembled) {
    by_id.set(don.id, don);
    if (don.id_v1) by_id.set(don.id_v1, don);
  }
  return ids.map((id) => by_id.get(id));
}

/** paginated donations by donor email, filtered by status */
export async function donation_dons_from(
  from_email: string,
  opts?: IDonsFromOpts
): Promise<IPage<IDonation>> {
  const { limit = 10, next, status } = opts || {};
  const cursor = decode_date_cursor(next);

  const rows = await db
    .select({ d: donations })
    .from(donations)
    .innerJoin(donation_donors, eq(donations.id, donation_donors.donation_id))
    .where(
      and(
        eq(donation_donors.email, from_email),
        status ? eq(donations.status, status) : undefined,
        cursor ? sql`${donations.created_at} < ${cursor}` : undefined
      )
    )
    .orderBy(desc(donations.created_at))
    .limit(limit + 1);

  const has_more = rows.length > limit;
  const don_rows = rows.slice(0, limit).map((r) => r.d);
  const don_ids = don_rows.map((r) => r.id);
  const subs = await fetch_subtables_batch(don_ids);
  const assembled = assemble_batch(don_rows, subs);

  const items = don_ids.map((id) => assembled.get(id)!);
  return {
    items,
    next: has_more
      ? encode_date_cursor(don_rows[don_rows.length - 1]?.created_at)
      : undefined,
  };
}

/** lightweight row for user donations dashboard */
export interface IUserDonation {
  id: string;
  status: string;
  /** the status every dist of this donation shares; null when it has no dist
   * or its dists differ. a cancelled duplicate is a `cancelled` status with a
   * `refunded` dist_status — the pair `INpoDonation` carries per dist */
  dist_status: DistRow["status"] | null;
  created_at: string;
  amount_base: number;
  upusd: number;
  currency: string;
  frequency: string;
  via: string;
  via_extra: string | null;
  program_id: string | null;
  program_name: string | null;
  recipient_name: string;
  recipient_id: string;
  recipient_type: "npo" | "fund";
}

/** paginated donations by donor email, optional status filter */
export async function user_donations_page(
  email: string,
  opts?: { limit?: number; next?: string; status?: string }
): Promise<IPage<IUserDonation>> {
  const { limit = 10, next, status } = opts || {};
  const cursor = decode_date_cursor(next);

  const rows = await db
    .select({
      don: {
        id: donations.id,
        status: donations.status,
        dist_status: sql<DistRow["status"] | null>`(
          select case when min(${dists.status}) = max(${dists.status}) then min(${dists.status}) end
          from ${dists} where ${dists.donation_id} = ${donations.id}
        )`,
        created_at: donations.created_at,
        amount_base: donations.amount_base,
        upusd: donations.upusd,
        currency: donations.currency,
        frequency: donations.frequency,
        via: donations.via,
        via_extra: donations.via_extra,
        program_id: donations.program_id,
        program_name: donations.program_name,
      },
      recip: {
        name: donation_recipients.name,
        npo_id: donation_recipients.npo_id,
        fund_id: donation_recipients.fund_id,
        type: donation_recipients.type,
      },
    })
    .from(donations)
    .innerJoin(donation_donors, eq(donations.id, donation_donors.donation_id))
    .innerJoin(
      donation_recipients,
      eq(donations.id, donation_recipients.donation_id)
    )
    .where(
      and(
        eq(donation_donors.email, email),
        status ? eq(donations.status, status) : undefined,
        cursor ? sql`${donations.created_at} < ${cursor}` : undefined
      )
    )
    .orderBy(desc(donations.created_at))
    .limit(limit + 1);

  const has_more = rows.length > limit;
  const items: IUserDonation[] = rows.slice(0, limit).map((r) => ({
    id: r.don.id,
    status: r.don.status,
    dist_status: r.don.dist_status,
    created_at: r.don.created_at,
    amount_base: r.don.amount_base,
    upusd: r.don.upusd,
    currency: r.don.currency,
    frequency: r.don.frequency,
    via: r.don.via,
    via_extra: r.don.via_extra,
    program_id: r.don.program_id,
    program_name: r.don.program_name,
    recipient_name: r.recip.name,
    recipient_id: String(r.recip.npo_id ?? r.recip.fund_id ?? ""),
    recipient_type: r.recip.type as "npo" | "fund",
  }));

  return {
    items,
    next: has_more
      ? encode_date_cursor(items[items.length - 1]?.created_at)
      : undefined,
  };
}

/** accept IDonationUpdate, split across tables, return full IDonation */
export async function donation_update(
  tx: DbOrTx,
  id: string,
  data: IDonationUpdate
): Promise<IDonation> {
  const {
    settlement,
    tribute,
    amount,
    program,
    // donor fields
    from_email,
    from_name,
    from_title,
    from_company_name,
    from_addr_street,
    from_addr_city,
    from_addr_state,
    from_addr_zip_code,
    from_addr_country,
    from_wallet_addr,
    from_public_msg_to_npo,
    from_private_msg_to_npo,
    from_public,
    // recipient fields
    to_id,
    to_name,
    to_type,
    to_tip_allowed,
    to_members,
    // base fields
    ...base_rest
  } = data;

  // -- base table update --
  const base_set: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (amount) {
    base_set.amount_base = amount.base;
    base_set.amount_tip = amount.tip;
    base_set.amount_fee_allowance = amount.fee_allowance;
  }
  if (program !== undefined) {
    base_set.program_id = program?.id ?? null;
    base_set.program_name = program?.name ?? null;
  }
  if (base_rest.upusd !== undefined) base_set.upusd = base_rest.upusd;
  if (base_rest.status !== undefined) base_set.status = base_rest.status;
  if (base_rest.currency !== undefined) base_set.currency = base_rest.currency;
  if (base_rest.frequency !== undefined)
    base_set.frequency = base_rest.frequency;
  if (base_rest.source !== undefined) base_set.source = base_rest.source;
  if (base_rest.source_id !== undefined)
    base_set.source_id = base_rest.source_id;
  if (base_rest.form_id !== undefined) base_set.form_id = base_rest.form_id;
  if (base_rest.subscription_id !== undefined)
    base_set.subscription_id = base_rest.subscription_id;
  if (base_rest.via !== undefined) base_set.via = base_rest.via;
  if (base_rest.via_extra !== undefined)
    base_set.via_extra = base_rest.via_extra;
  if (base_rest.subscription_id !== undefined)
    base_set.subscription_id = base_rest.subscription_id;
  await tx.update(donations).set(base_set).where(eq(donations.id, id));

  // -- donor subtable update --
  const has_donor_fields =
    from_email !== undefined ||
    from_name !== undefined ||
    from_title !== undefined ||
    from_company_name !== undefined ||
    from_addr_street !== undefined ||
    from_addr_city !== undefined ||
    from_addr_state !== undefined ||
    from_addr_zip_code !== undefined ||
    from_addr_country !== undefined ||
    from_wallet_addr !== undefined ||
    from_public_msg_to_npo !== undefined ||
    from_private_msg_to_npo !== undefined ||
    from_public !== undefined;

  if (has_donor_fields) {
    const donor_set: Record<string, unknown> = {};
    if (from_email !== undefined) donor_set.email = from_email;
    if (from_name !== undefined) donor_set.name = from_name;
    if (from_title !== undefined) donor_set.title = from_title;
    if (from_company_name !== undefined)
      donor_set.company_name = from_company_name;
    if (from_wallet_addr !== undefined)
      donor_set.wallet_addr = from_wallet_addr;
    if (from_public_msg_to_npo !== undefined)
      donor_set.public_msg = from_public_msg_to_npo;
    if (from_private_msg_to_npo !== undefined)
      donor_set.private_msg = from_private_msg_to_npo;
    if (from_public !== undefined) donor_set.is_public = from_public;

    // address fields → jsonb patch
    const has_addr =
      from_addr_street !== undefined ||
      from_addr_city !== undefined ||
      from_addr_state !== undefined ||
      from_addr_zip_code !== undefined ||
      from_addr_country !== undefined;
    if (has_addr) {
      // read existing addr, merge
      const [existing] = await tx
        .select({ addr: donation_donors.addr })
        .from(donation_donors)
        .where(eq(donation_donors.donation_id, id));
      const prev = (existing?.addr as Record<string, unknown>) ?? {};
      donor_set.addr = {
        ...prev,
        ...(from_addr_street !== undefined && { street: from_addr_street }),
        ...(from_addr_city !== undefined && { city: from_addr_city }),
        ...(from_addr_state !== undefined && { state: from_addr_state }),
        ...(from_addr_zip_code !== undefined && {
          zip_code: from_addr_zip_code,
        }),
        ...(from_addr_country !== undefined && { country: from_addr_country }),
      };
    }

    await tx
      .update(donation_donors)
      .set(donor_set)
      .where(eq(donation_donors.donation_id, id));
  }

  // -- recipient subtable update --
  const has_recip_fields =
    to_id !== undefined ||
    to_name !== undefined ||
    to_type !== undefined ||
    to_tip_allowed !== undefined ||
    to_members !== undefined;

  if (has_recip_fields) {
    const recip_set: Record<string, unknown> = {};
    if (to_name !== undefined) recip_set.name = to_name;
    if (to_type !== undefined) recip_set.type = to_type;
    if (to_tip_allowed !== undefined) recip_set.tip_allowed = to_tip_allowed;
    if (to_members !== undefined)
      recip_set.members = to_members.map((m) => Number(m));
    if (to_id !== undefined && to_type !== undefined) {
      if (to_type === "fund") {
        recip_set.fund_id = to_id;
        recip_set.npo_id = null;
      } else {
        recip_set.npo_id = Number(to_id);
        recip_set.fund_id = null;
      }
    }
    await tx
      .update(donation_recipients)
      .set(recip_set)
      .where(eq(donation_recipients.donation_id, id));
  }

  // -- settlement subtable upsert --
  if (settlement) {
    await tx
      .insert(donation_settlements)
      .values({
        donation_id: id,
        sttl_id: settlement.id,
        date: settlement.date,
        currency: settlement.currency,
        net: settlement.net,
        fee: settlement.fee,
        fee_parts: settlement.fee_parts,
      })
      .onConflictDoUpdate({
        target: donation_settlements.donation_id,
        // an absent breakdown leaves the recorded one: drizzle drops undefined keys from `set`
        set: {
          sttl_id: settlement.id,
          date: settlement.date,
          currency: settlement.currency,
          net: settlement.net,
          fee: settlement.fee,
          fee_parts: settlement.fee_parts,
        },
      });
  }

  // -- tribute subtable upsert --
  if (tribute) {
    await tx
      .insert(donation_tributes)
      .values({
        donation_id: id,
        name: tribute.full_name,
        notif_email: tribute.notif?.to_email ?? null,
        notif_fullname: tribute.notif?.to_fullname ?? null,
        notif_msg: tribute.notif?.from_msg ?? null,
      })
      .onConflictDoUpdate({
        target: donation_tributes.donation_id,
        set: {
          name: tribute.full_name,
          notif_email: tribute.notif?.to_email ?? null,
          notif_fullname: tribute.notif?.to_fullname ?? null,
          notif_msg: tribute.notif?.from_msg ?? null,
        },
      });
  }

  // re-fetch using the same tx to avoid deadlock on single-connection dbs
  const [row] = await tx.select().from(donations).where(eq(donations.id, id));
  if (!row) throw new Error(`donation ${id} not found after update`);
  const subs = await fetch_subtables(row.id, tx);
  return to_donation(
    row,
    subs.recipient,
    subs.donor,
    subs.settlement,
    subs.tribute
  );
}

// -- donation sub-table getters --

export async function donation_recipient_get(
  donation_id: string
): Promise<typeof donation_recipients.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(donation_recipients)
    .where(eq(donation_recipients.donation_id, donation_id));
  return row;
}

export async function donation_donor_get(
  donation_id: string
): Promise<typeof donation_donors.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(donation_donors)
    .where(eq(donation_donors.donation_id, donation_id));
  return row;
}

async function agent_donation_count_since(
  since: string,
  opts: { email?: string; source_id?: string },
  conn: DbOrTx = db
): Promise<number> {
  const [row] = await conn
    .select({ value: count() })
    .from(donations)
    .innerJoin(donation_donors, eq(donations.id, donation_donors.donation_id))
    .where(
      and(
        eq(donations.source, "bg-agent"),
        sql`${donations.created_at} >= ${since}::timestamptz`,
        opts.email
          ? eq(donation_donors.email, opts.email)
          : eq(donations.source_id, opts.source_id!)
      )
    );
  return row?.value ?? 0;
}

export type AgentDonationReservation = "created" | "existing" | "limited";

export async function agent_donation_reserve(
  data: IDonation,
  since: string,
  limit: number
): Promise<AgentDonationReservation> {
  return db.transaction(async (tx) => {
    const lock_keys = [
      `agent-email:${data.from_email}`,
      `agent-ip:${data.source_id}`,
    ].sort();
    for (const key of lock_keys) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${key})::bigint)`
      );
    }

    const [existing] = await tx
      .select({ source: donations.source })
      .from(donations)
      .where(eq(donations.id, data.id));
    if (existing) {
      return existing.source === "bg-agent" ? "existing" : "limited";
    }

    const [customer_count, ip_count] = await Promise.all([
      agent_donation_count_since(since, { email: data.from_email }, tx),
      agent_donation_count_since(since, { source_id: data.source_id }, tx),
    ]);
    if (customer_count >= limit || ip_count >= limit) return "limited";

    await donation_put(tx, data);
    return "created";
  });
}

/**
 * marks an agent checkout expired while it is still `created` and still points
 * at `session_id`. a late expiry for a session that was already replaced does
 * not touch the replacement.
 */
export async function agent_donation_expire(
  donation_id: string,
  session_id: string,
  tx: DbOrTx = db
): Promise<boolean> {
  const [row] = await tx
    .update(donations)
    .set({ status: "expired", updated_at: new Date().toISOString() })
    .where(
      and(
        eq(donations.id, donation_id),
        eq(donations.source, "bg-agent"),
        eq(donations.status, "created"),
        eq(donations.via_extra, session_id)
      )
    )
    .returning({ id: donations.id });
  return !!row;
}

/**
 * records the Checkout Session on an agent donation that is still unpaid.
 * a `settled` or otherwise finished row is left alone, so a slow retry cannot
 * move a paid gift back to `created`.
 */
export async function agent_checkout_save(
  donation_id: string,
  session_id: string,
  tx: DbOrTx = db
): Promise<boolean> {
  const [row] = await tx
    .update(donations)
    .set({
      via_extra: session_id,
      status: "created",
      updated_at: new Date().toISOString(),
    })
    .where(
      and(
        eq(donations.id, donation_id),
        eq(donations.source, "bg-agent"),
        inArray(donations.status, ["created", "expired"])
      )
    )
    .returning({ id: donations.id });
  return !!row;
}

export async function donation_settlement_get(
  donation_id: string
): Promise<typeof donation_settlements.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(donation_settlements)
    .where(eq(donation_settlements.donation_id, donation_id));
  return row;
}

/**
 * inserts a settled clone unless a donation already records its settlement id;
 * null when one does. the sttl_id unique index is the arbiter, so of two
 * concurrent puts of one settlement exactly one lands.
 */
export async function donation_put_once(
  row: IDonationSettled
): Promise<IDonationSettled | null> {
  return donation_put(db, row)
    .then(() => row)
    .catch((err) => {
      if (is_unique_violation(err, DONATION_SETTLEMENTS_STTL_ID_IDX)) {
        return null;
      }
      throw err;
    });
}

/** the two fields a provider's settle guard decides on */
export interface SettleState {
  status: IDonation["status"];
  sttl_id?: string;
}

export const settle_state_of = (d: IDonation): SettleState => ({
  status: d.status,
  sttl_id: d.settlement?.id,
});

/**
 * a donation's status and settlement id, with its row locked for the rest of
 * `tx`.
 *
 * for a settle handler that read the donation before opening its transaction:
 * a concurrent delivery holding the lock commits first, and this then reads what
 * it wrote. two statements, not a join — under read committed a join re-checks
 * only the locked row after the wait and keeps the settlement it saw before.
 */
/**
 * the donation's status under a share lock: a concurrent writer of the row
 * (the refund's status flip) commits first, and this then reads what it wrote.
 */
export async function donation_status_shared(
  tx: DbOrTx,
  id: string
): Promise<IDonation["status"] | undefined> {
  const [don] = await tx
    .select({ status: donations.status })
    .from(donations)
    .where(eq(donations.id, id))
    .for("share");
  return don?.status as IDonation["status"] | undefined;
}

/** row lock only: waits out a writer holding the row, blocks one arriving after.
 * lock order: `dists_locked` in `.server/refund/share.ts` */
export async function donation_lock(tx: DbOrTx, id: string) {
  await tx
    .select({ id: donations.id })
    .from(donations)
    .where(eq(donations.id, id))
    .for("update");
}

export async function donation_settle_state_locked(
  tx: DbOrTx,
  id: string
): Promise<SettleState | undefined> {
  const [don] = await tx
    .select({ status: donations.status })
    .from(donations)
    .where(eq(donations.id, id))
    .for("update");
  if (!don) return undefined;

  const [sttl] = await tx
    .select({ sttl_id: donation_settlements.sttl_id })
    .from(donation_settlements)
    .where(eq(donation_settlements.donation_id, id));
  return {
    status: don.status as IDonation["status"],
    sttl_id: sttl?.sttl_id,
  };
}

/**
 * check if a settlement with this sttl_id already exists (idempotency guard).
 *
 * the handle is the whole guard: read on the default handle this answers from
 * a snapshot taken before the caller's transaction opened, so two concurrent
 * deliveries of one charge both see "no settlement" and both settle it. pass
 * the tx that holds the order row's write lock and the loser reads what the
 * winner committed instead.
 *
 * a caller may still read it on the default handle first, to spare a
 * redelivery the provider fetches and the settle math — but that read decides
 * nothing the locked one does not decide again.
 */
export async function settlement_exists(
  sttl_id: string,
  tx: DbOrTx = db
): Promise<boolean> {
  const [row] = await tx
    .select({ donation_id: donation_settlements.donation_id })
    .from(donation_settlements)
    .where(eq(donation_settlements.sttl_id, sttl_id));
  return !!row;
}

/**
 * the donation a settlement id was recorded against.
 *
 * the counterpart to `settlement_exists` for a caller that has to act on the
 * row rather than just bail: a settle handler whose guard fired needs the
 * donation the earlier delivery wrote so it can recompute that delivery's
 * queue messages, because the enqueue sits outside the transaction and may
 * never have happened. pass the tx that holds the order row's write lock:
 * read outside it, this can run before a concurrent delivery commits and miss
 * the settlement that delivery wrote.
 */
export async function donation_by_sttl_id(
  sttl_id: string,
  tx: DbOrTx = db
): Promise<IDonation | undefined> {
  const rows = await tx
    .select({ don: donations })
    .from(donation_settlements)
    .innerJoin(donations, eq(donations.id, donation_settlements.donation_id))
    .where(eq(donation_settlements.sttl_id, sttl_id))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;

  const subs = await fetch_subtables(row.don.id, tx);
  return to_donation(
    row.don,
    subs.recipient,
    subs.donor,
    subs.settlement,
    subs.tribute
  );
}

/**
 * how long a receipt-send claim is honoured before another delivery may take
 * it. the holder is a queue handler on a serverless function whose own ceiling
 * is minutes, so a claim older than this is not a send in progress — it is one
 * whose worker died without reaching either stamp.
 */
export const RECEIPT_LEASE_MS = 15 * 60 * 1000;

/**
 * claim the right to mail this donation's receipts.
 *
 * one UPDATE...WHERE...RETURNING is the whole send-once gate, the same shape
 * the filing pack uses: the stamp is both the guard and the record, so two
 * concurrent deliveries of the same queue message cannot both come back
 * holding it. reading the row and then writing it would leave a window between
 * the two wide enough to mail the donor twice.
 *
 * false is the ordinary outcome for a redelivery — the receipts already went
 * out, or another delivery is mailing them right now — not a failure.
 *
 * also false when the row's status is one of `reversed_statuses`. the queue
 * message's payload is a snapshot taken before enqueue, so a refund that
 * commits after it was built still reads "settled" there; the row is the only
 * place that knows the money went back, and no receipt goes out for it.
 *
 * the claim is burnt before the send, so two deliveries racing the sends
 * cannot both mail the donor: there is no unsend, and a receipt carries a tax
 * id, so two of them for one gift is worse than none. it is a *lease*, not a
 * tombstone, in both directions — a holder whose sends throw gives it back
 * with `release_receipt_send`, and a holder that dies without giving it back
 * loses it to the `RECEIPT_LEASE_MS` expiry here. without the expiry a killed
 * worker takes the donor's receipt with it: `receipt_sent_at` would assert a
 * send that never happened and no redelivery could get past it.
 *
 * only `receipt_claimed_at` expires. `receipt_sent_at` is written after the
 * mails are away (`mark_receipt_sent`) and is permanent, so an expiry can only
 * ever re-run a send that did not complete.
 */
export async function claim_receipt_send(
  donation_id: string,
  tx: DbOrTx = db
): Promise<boolean> {
  const now = new Date();
  const stale = new Date(now.getTime() - RECEIPT_LEASE_MS).toISOString();

  const [row] = await tx
    .update(donations)
    .set({ receipt_claimed_at: now.toISOString() })
    .where(
      and(
        eq(donations.id, donation_id),
        notInArray(donations.status, [...reversed_statuses]),
        isNull(donations.receipt_sent_at),
        or(
          isNull(donations.receipt_claimed_at),
          lt(donations.receipt_claimed_at, stale)
        )
      )
    )
    .returning({ id: donations.id });
  return !!row;
}

/**
 * give back a receipt-send claim whose sends did not complete.
 *
 * the other half of the lease `claim_receipt_send` takes out. the expiry there
 * is the backstop for a holder that cannot run at all; this is the fast path
 * for one that can, so the next delivery does not have to wait out
 * `RECEIPT_LEASE_MS` after a transient provider refusal.
 *
 * only the holder calls this, and only on the way out of a throw. the
 * `receipt_sent_at` guard is what keeps it honest: a release that arrives
 * after the sends completed — a late throw, a duplicate handler — must not
 * hand a second delivery the right to mail a receipt that already went.
 */
export async function release_receipt_send(
  donation_id: string,
  tx: DbOrTx = db
): Promise<void> {
  await tx
    .update(donations)
    .set({ receipt_claimed_at: null })
    .where(
      and(eq(donations.id, donation_id), isNull(donations.receipt_sent_at))
    );
}

/**
 * record that this donation's receipts are away.
 *
 * the permanent half of the pair: `receipt_claimed_at` says someone is mailing,
 * this says the mail went. nothing clears it, and every later claim attempt
 * stops on it — including one whose lease had expired, which is the case the
 * two stamps exist to tell apart.
 */
export async function mark_receipt_sent(
  donation_id: string,
  tx: DbOrTx = db
): Promise<void> {
  await tx
    .update(donations)
    .set({ receipt_sent_at: new Date().toISOString() })
    .where(eq(donations.id, donation_id));
}

/**
 * mark a deposit that arrived in an asset other than the donation's own
 * `currency`, so ops can find it: nothing settles a held donation on its own,
 * ops settle or refund it by hand.
 *
 * true only the first time: the provider resends the same payment, and only
 * the first mark should page anyone. false for a donation already settled or
 * reversed — a hold there would describe money already accounted for.
 */
export async function donation_hold_mark(
  donation_id: string,
  asset: string,
  tx: DbOrTx = db
): Promise<boolean> {
  const [row] = await tx
    .update(donations)
    .set({
      held_at: new Date().toISOString(),
      hold_asset: asset.toUpperCase(),
    })
    .where(
      and(
        eq(donations.id, donation_id),
        isNull(donations.held_at),
        notInArray(donations.status, ["settled", ...reversed_statuses])
      )
    )
    .returning({ id: donations.id });
  return !!row;
}

export async function donation_tribute_get(
  donation_id: string
): Promise<typeof donation_tributes.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(donation_tributes)
    .where(eq(donation_tributes.donation_id, donation_id));
  return row;
}
