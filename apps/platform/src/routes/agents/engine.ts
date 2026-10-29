import { Buffer } from "node:buffer";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { href } from "react-router";
import * as v from "valibot";
import { client_ip, reserve } from "#/.server/auth/rate-limit";
import { to_fn } from "#/.server/donation-recipient";
import { stripe_amounts } from "#/components/donation/common/amounts";
import { report_error } from "#/errors/report";
import {
  checkout_session,
  checkout_session_state,
} from "#/routes/api.donation-intents/stripe/checkout-session";
import { npo_descriptor_suffix } from "#/routes/api.donation-intents/stripe/descriptor-suffix";
import { donor_refusal } from "#/routes/api.donation-intents/stripe/donor-refusal";
import { MIN_DONATION_USD, PROCESSING_RATES } from "@/constants/common";
import type { IDonation, IDonor, IProgram, ITo } from "@/donations";
import { to_from } from "@/donations/helpers";
import { snap, to_units } from "@/helpers/decimal";
import type { IIncrement } from "@/schemas";
import { is_funded_member } from "@/settlement/funded-members";
import { npo_share, settled_parts, shared_parts } from "@/settlement/plan";
import { app, base_url } from "$/env";
import {
  type INonprofitOrg,
  nonprofits_cancel_fetch,
  nonprofits_org,
  nonprofits_search,
  nonprofits_will_fetch,
  type TNonprofitsFailure,
  type TNonprofitsOrg,
  type TNonprofitsSearch,
} from "$/nonprofits-api";
import {
  agent_checkout_save,
  agent_donation_expire,
  agent_donation_reserve,
  donation_get,
} from "$/pg/queries/donation";
import {
  type INpoNameHit,
  npo_get,
  npo_name_search,
  npos_batch_get,
  npos_by_regnums,
} from "$/pg/queries/npo";
import { npo_program_get } from "$/pg/queries/program";

const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 5;
const NONPROFITS_QUOTA = { max: 20, window_s: 10 * 60 };
const QUOTE_TTL_S = 60 * 60;
const tip_percent = v.picklist(["none", "10", "15", "20"]);
const to_id = v.union([
  v.pipe(v.number(), v.integer(), v.minValue(1)),
  v.pipe(v.string(), v.uuid()),
]);
const amount_input = v.pipe(
  v.number(),
  v.minValue(MIN_DONATION_USD),
  v.check(
    (amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-8,
    "amount must use at most two decimal places"
  )
);
const quote_input = v.strictObject({
  recipient_id: to_id,
  amount: amount_input,
  tip_percent: v.optional(tip_percent, "none"),
  cover_processing_fee: v.optional(v.boolean(), false),
  program_id: v.optional(v.pipe(v.string(), v.uuid())),
  currency: v.optional(v.literal("USD"), "USD"),
  frequency: v.optional(v.literal("one-time"), "one-time"),
});
const donor = v.strictObject({
  email: v.pipe(v.string(), v.email(), v.toLowerCase()),
  first_name: v.pipe(v.string(), v.nonEmpty()),
  last_name: v.pipe(v.string(), v.nonEmpty()),
});
const donate_input = v.strictObject({
  quote_token: v.pipe(v.string(), v.nonEmpty()),
  donor,
});
const status_input = v.strictObject({
  donation_id: v.pipe(v.string(), v.uuid()),
});
const find_input = v.pipe(
  v.strictObject({
    query: v.optional(v.string()),
    ein: v.optional(v.string()),
  }),
  v.check((input) => !!input.query || !!input.ein, "query or ein is required")
);
/** what each tool in `tools` accepts; its advertised `inputSchema` must agree */
export const tool_inputs = {
  find_nonprofit: find_input,
  quote_donation: quote_input,
  donate: donate_input,
  donation_status: status_input,
};
const quote_token = v.strictObject({
  v: v.literal(1),
  id: v.pipe(v.string(), v.uuid()),
  exp: v.pipe(v.number(), v.integer(), v.minValue(1)),
  ...quote_input.entries,
});

interface IQuoteToken {
  v: 1;
  id: string;
  exp: number;
  recipient_id: number | string;
  amount: number;
  tip_percent: "none" | "10" | "15" | "20";
  cover_processing_fee: boolean;
  program_id?: string;
  currency: "USD";
  frequency: "one-time";
}

/** where a quoted charge goes, in USD. the first three add up to
 * `total_charged`; so do the last five */
export interface IQuoteBreakdown {
  amount: number;
  tip: number;
  /** what the donor adds to cover the card fee */
  fee_allowance: number;
  total_charged: number;
  /** Stripe's card fee on the whole charge, estimated at its card rate */
  processing_fee: number;
  /** 1.5% of the donation amount (each member's share, for a fund) when
   * that nonprofit turned off tips, whether or not the card fee is covered.
   * a fund's members are charged by their own setting */
  platform_fee: number;
  /** 2.9% of the donation amount (each member's share, for a fund) for a
   * fiscally sponsored nonprofit, whether or not the card fee is covered */
  fiscal_sponsor_fee: number;
  nonprofit_receives: number;
  /** the tip and what the fee allowance leaves after the card fee. the two
   * fees above are Better Giving's too; each line may carry a rounding cent */
  better_giving_receives: number;
}

export interface IAgentQuote {
  quote_token: string;
  quote_id: string;
  recipient: { id: string; name: string; type: "npo" | "fund" };
  currency: "USD";
  frequency: "one-time";
  amount: IDonation["amount"] & { total: number };
  breakdown: IQuoteBreakdown;
  program?: IProgram;
  /** the nonprofit's own label for this exact amount, when it is one of its
   * increments and the label isn't blank */
  increment_label: string | null;
}

/** a preset amount a nonprofit set in its donation settings, labeled in its own words */
export interface IAgentIncrement {
  amount: number;
  label: string;
}

export class AgentDonationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function parsed<
  TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
>(schema: TSchema, input: unknown): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, input);
  if (result.issues) {
    throw new AgentDonationError(
      "invalid_input",
      result.issues[0]?.message ?? "Invalid input"
    );
  }
  return result.output;
}

const quote_mac = (body: string) =>
  createHmac("sha256", app.api_encryption_key)
    .update(`agent-quote:${body}`)
    .digest();

function encode_quote(quote: IQuoteToken): string {
  const body = Buffer.from(JSON.stringify(quote)).toString("base64url");
  return `${body}.${quote_mac(body).toString("base64url")}`;
}

function decode_quote(token: string): IQuoteToken {
  const invalid = new AgentDonationError(
    "invalid_quote",
    "The quote token is invalid."
  );
  const [body, mac, ...rest] = token.split(".");
  if (!body || !mac || rest.length) throw invalid;
  const given = Buffer.from(mac, "base64url");
  const expected = quote_mac(body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw invalid;
  }
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return parsed(quote_token, value);
  } catch {
    throw invalid;
  }
}

function quote_amount(
  amount: number,
  tip: IQuoteToken["tip_percent"],
  cover_processing_fee: boolean
) {
  const parts = stripe_amounts({
    amount,
    tip_format: tip,
    tip: "0",
    cover_processing_fee,
    currency: { code: "USD", rate: 1 },
  });
  const total_cents =
    to_units(parts.base, 2) +
    to_units(parts.tip, 2) +
    to_units(parts.fee_allowance, 2);
  return { ...parts, total: total_cents / 100 };
}

/** `pool` cents split by `dollars`, with what they leave as the last share,
 * returned in dollars: each share the floor or ceiling of its exact cents, the
 * cents the floors drop going to the largest fractions, so the shares sum to
 * `pool` exactly */
function apportion(pool: number, dollars: number[]): number[] {
  const exact = dollars.map((x) => snap(x * 100));
  exact.push(pool - snap(exact.reduce((sum, x) => sum + x, 0)));
  const shares = exact.map(Math.floor);
  let dropped = pool - shares.reduce((sum, x) => sum + x, 0);
  const by_fraction = exact
    .map((x, i) => ({ i, fraction: x - Math.floor(x) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (const { i } of by_fraction) {
    if (dropped <= 0) break;
    shares[i] += 1;
    dropped -= 1;
  }
  return shares.map((c) => c / 100);
}

/** what settlement would book for this charge: the same split and fees, with
 * the Stripe fee it would read off the charge estimated at the card rate the
 * fee allowance is priced on. a fund's gift is split across its funded members */
async function quote_breakdown(
  recipient: ITo,
  amount: ReturnType<typeof quote_amount>
): Promise<IQuoteBreakdown> {
  const { total, ...parts } = amount;
  const members =
    recipient.to_type === "npo"
      ? [await npo_get(+recipient.to_id)]
      : await npos_batch_get(recipient.to_members.map(Number));
  const funded = members.filter((m) => m && is_funded_member(m));
  // settlement books no destination for a gift with no funded member
  if (!funded.length) {
    throw new AgentDonationError(
      "recipient_unavailable",
      "This recipient is not accepting donations."
    );
  }
  const total_cents = to_units(total, 2);
  const fee_cents = to_units(
    total * PROCESSING_RATES.stripe + PROCESSING_RATES.stripe_flat,
    2
  );
  const processing_fee = fee_cents / 100;
  const ps = settled_parts(parts, 1, {
    net: (total_cents - fee_cents) / 100,
    fee: processing_fee,
  });
  const share = shared_parts(ps, funded.length);
  let net = 0;
  let base = 0;
  let fsa = 0;
  for (const m of funded) {
    const s = npo_share(share, {
      fiscal_sponsored: m?.fiscal_sponsored ?? false,
      hide_bg_tip: m?.hide_bg_tip,
    });
    net += s.net;
    base += s.pcfs.base;
    fsa += s.pcfs.fsa;
  }
  const [
    nonprofit_receives,
    platform_fee,
    fiscal_sponsor_fee,
    better_giving_receives,
  ] = apportion(total_cents - fee_cents, [net, base, fsa]);
  return {
    amount: parts.base,
    tip: parts.tip,
    fee_allowance: parts.fee_allowance,
    total_charged: total,
    processing_fee,
    platform_fee,
    fiscal_sponsor_fee,
    nonprofit_receives,
    better_giving_receives,
  };
}

/** smallest first, one per amount (the first stored); a value `quote_donation`
 * would reject is dropped, so every listed amount can be quoted */
function agent_increments(
  stored: readonly IIncrement[] | null | undefined
): IAgentIncrement[] {
  const by_cents = new Map<number, IAgentIncrement>();
  for (const x of stored ?? []) {
    const amount = Number(x?.value);
    if (!v.is(amount_input, amount)) continue;
    const cents = to_units(amount, 2);
    if (by_cents.has(cents)) continue;
    by_cents.set(cents, { amount: cents / 100, label: x.label?.trim() ?? "" });
  }
  return [...by_cents.values()].sort((a, b) => a.amount - b.amount);
}

function with_increments<T extends { increments: IIncrement[] | null }>({
  increments,
  ...rest
}: T) {
  return { ...rest, increments: agent_increments(increments) };
}

function increment_label(
  stored: readonly IIncrement[] | null | undefined,
  amount: number
): string | null {
  const cents = to_units(amount, 2);
  const match = agent_increments(stored).find(
    (x) => to_units(x.amount, 2) === cents
  );
  return match?.label || null;
}

const EIN_DIGITS = 9;

type TExternalLookup = TNonprofitsFailure | "ok" | "skipped";

interface INotOnBetterGiving {
  ein: string;
  name: string;
  city: string | null;
  state: string | null;
  donatable: false;
  status: "not_on_better_giving";
  onboarding_url: string;
  message: string;
}

function ein_digits(value: string): string {
  return value.replace(/\D/g, "");
}

function irs_query_rejected(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length < 2 || trimmed.length > 200) return true;
  return !/\p{L}|\p{N}/u.test(trimmed);
}

function eligible(org: INonprofitOrg): boolean {
  return (
    org.is501c3 === true && org.deductible === true && org.revoked === false
  );
}

function external_entry(org: INonprofitOrg): INotOnBetterGiving {
  const onboarding_url = `${base_url}/register`;
  return {
    ein: org.ein,
    name: org.name,
    city: org.city,
    state: org.state,
    donatable: false,
    status: "not_on_better_giving",
    onboarding_url,
    message: `Not on Better Giving yet, so it can't take a donation here. The nonprofit can join at ${onboarding_url}.`,
  };
}

function listed_eins(
  items: readonly {
    registration_number?: string | null;
    hq_country?: string | null;
  }[]
): Set<string> {
  const eins = new Set<string>();
  for (const item of items) {
    if (item.hq_country !== "United States") continue;
    const ein = ein_digits(item.registration_number ?? "");
    if (ein.length === EIN_DIGITS) eins.add(ein);
  }
  return eins;
}

async function offer(
  orgs: readonly INonprofitOrg[],
  already: Set<string>
): Promise<INotOnBetterGiving[]> {
  const eligible_orgs = orgs.filter(eligible);
  const known = eligible_orgs.length
    ? await npos_by_regnums(eligible_orgs.map((org) => org.ein))
    : [];
  const taken = new Set(already);
  for (const row of known) taken.add(ein_digits(row.registration_number));
  return eligible_orgs.filter((org) => !taken.has(org.ein)).map(external_entry);
}

async function allow_fetch(
  request: Request,
  kind: "search" | "org",
  raw: string
): Promise<boolean> {
  if (!nonprofits_will_fetch(kind, raw)) return true;
  const reserved =
    reserve(`nonprofits:${caller_id(request)}`, NONPROFITS_QUOTA) !== null;
  if (!reserved) nonprofits_cancel_fetch(kind, raw);
  return reserved;
}

export async function find_nonprofit(input: unknown, request: Request) {
  const args = parsed(find_input, input);
  if (args.ein) return find_by_ein(args.ein, request);
  return find_by_query(args.query ?? "", request);
}

async function find_by_ein(raw: string, request: Request) {
  const ein = ein_digits(raw);
  if (ein.length !== EIN_DIGITS) {
    throw new AgentDonationError("invalid_input", "ein must be 9 digits");
  }
  const items = await npos_by_regnums([ein]);
  if (items.length) {
    return {
      items: items.map(with_increments),
      match: "exact" as const,
      not_on_better_giving: [],
      external_lookup: (app.nonprofits_api_key?.trim()
        ? "ok"
        : "disabled") as TExternalLookup,
    };
  }
  if (!(await allow_fetch(request, "org", ein))) {
    return {
      items: [],
      match: "none" as const,
      not_on_better_giving: [],
      external_lookup: "skipped",
    };
  }
  const remote = await nonprofits_org(ein).catch(
    (): TNonprofitsOrg => ({ status: "unavailable" })
  );
  if (remote.status !== "ok") {
    return {
      items: [],
      match: "none" as const,
      not_on_better_giving: [],
      external_lookup: remote.status,
    };
  }
  try {
    return {
      items: [],
      match: "none" as const,
      not_on_better_giving: await offer([remote.org], new Set()),
      external_lookup: "ok" as const,
    };
  } catch {
    return {
      items: [],
      match: "none" as const,
      not_on_better_giving: [],
      external_lookup: "unavailable" as const,
    };
  }
}

async function remote_search(
  request: Request,
  query: string
): Promise<TNonprofitsSearch | { status: "skipped" }> {
  if (!(await allow_fetch(request, "search", query))) {
    return { status: "skipped" };
  }
  return nonprofits_search(query).catch(
    (): TNonprofitsSearch => ({ status: "unavailable" })
  );
}

async function local_matches(query: string): Promise<INpoNameHit[]> {
  try {
    return await npo_name_search(query);
  } catch (error) {
    report_error(error);
    return [];
  }
}

async function find_by_query(query: string, request: Request) {
  const [hits, remote] = await Promise.all([
    local_matches(query),
    irs_query_rejected(query)
      ? Promise.resolve({ status: "invalid_query" as const })
      : remote_search(request, query),
  ]);
  const items = hits.map(with_increments);
  const page = {
    items,
    page: 1,
    pages: 1,
    match: (items.some((item) => item.match === "exact")
      ? "exact"
      : items.length
        ? "close"
        : "none") as INpoNameHit["match"] | "none",
  };
  if (remote.status !== "ok") {
    return {
      ...page,
      not_on_better_giving: [],
      external_lookup: remote.status,
    };
  }
  try {
    return {
      ...page,
      not_on_better_giving: await offer(remote.orgs, listed_eins(page.items)),
      external_lookup: "ok" as const,
    };
  } catch {
    return {
      ...page,
      not_on_better_giving: [],
      external_lookup: "unavailable" as const,
    };
  }
}

/** the recipient's npo row; undefined for a recipient that isn't a nonprofit or
 * a missing row. throws when the nonprofit requires a donor address */
async function assert_address_optional(recipient_id: number | string) {
  if (typeof recipient_id !== "number") return;
  const npo = await npo_get(recipient_id);
  if (!npo?.donor_address_required) return npo;
  throw new AgentDonationError(
    "address_required",
    "This nonprofit requires a donor address, which this checkout does not collect."
  );
}

export async function create_quote(input: unknown): Promise<IAgentQuote> {
  const args = parsed(quote_input, input);
  const recipient = await to_fn(args.recipient_id, { open_at: new Date() });
  if (!recipient) {
    throw new AgentDonationError(
      "recipient_unavailable",
      "This recipient is not accepting donations."
    );
  }
  const npo = await assert_address_optional(args.recipient_id);
  if (!recipient.to_tip_allowed && args.tip_percent !== "none") {
    throw new AgentDonationError(
      "tip_not_allowed",
      "This recipient does not accept Better Giving tips. Request a quote with tip_percent set to none."
    );
  }
  const program_row =
    args.program_id && typeof args.recipient_id === "number"
      ? await npo_program_get(args.program_id, args.recipient_id)
      : undefined;
  if (args.program_id && !program_row) {
    throw new AgentDonationError(
      "program_not_found",
      "The program does not belong to this nonprofit."
    );
  }
  const program = program_row
    ? { id: program_row.id, name: program_row.title }
    : undefined;
  const amount = quote_amount(
    args.amount,
    args.tip_percent,
    args.cover_processing_fee
  );
  const id = crypto.randomUUID();
  const token: IQuoteToken = {
    v: 1,
    id,
    exp: Math.floor(Date.now() / 1000) + QUOTE_TTL_S,
    recipient_id: args.recipient_id,
    amount: args.amount,
    tip_percent: args.tip_percent,
    cover_processing_fee: args.cover_processing_fee,
    program_id: args.program_id,
    currency: "USD",
    frequency: "one-time",
  };
  return {
    quote_token: encode_quote(token),
    quote_id: id,
    recipient: {
      id: recipient.to_id,
      name: recipient.to_name,
      type: recipient.to_type,
    },
    currency: "USD",
    frequency: "one-time",
    amount,
    breakdown: await quote_breakdown(recipient, amount),
    program,
    increment_label: increment_label(npo?.increments, args.amount),
  };
}

const bearer = /^Bearer\s+(\S+)$/i;

function hashes_equal(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest()
  );
}

function caller_id(request: Request): string {
  const expected = app.agent_donation_token;
  const presented = bearer.exec(
    request.headers.get("authorization")?.trim() ?? ""
  )?.[1];
  // a bearer counts only when it matches the server token. anything else,
  // including a raw forwarded-for chain, is not its own bucket.
  if (expected && presented && hashes_equal(presented, expected)) {
    return `agent:${createHash("sha256").update(expected).digest("hex")}`;
  }
  const ip = client_ip(request.headers) ?? "unknown";
  return `ip:${createHash("sha256").update(ip).digest("hex")}`;
}

function quote_still_valid(quote: IQuoteToken): boolean {
  return quote.exp * 1000 > Date.now();
}

const quote_expired = () =>
  new AgentDonationError(
    "quote_expired",
    "This quote has expired. Request a new quote."
  );

async function open_checkout(don: IDonation, idempotency_key?: string) {
  try {
    const descriptor_suffix = await npo_descriptor_suffix(don);
    const session = await checkout_session({
      ...don.amount,
      order_id: don.id,
      donor_email: don.from_email,
      recipient_name: don.to_name,
      cancel_path:
        don.to_type === "fund"
          ? href("/donate-fund/:fund_id", { fund_id: don.to_id })
          : href("/donate/:id", { id: don.to_id }),
      descriptor_suffix,
      idempotency_key,
    });
    const saved = await agent_checkout_save(don.id, session.id);
    if (!saved) {
      throw new AgentDonationError(
        "quote_used",
        "This quote was already paid. Check donation_status."
      );
    }
    return { donation_id: don.id, checkout_url: session.url };
  } catch (error) {
    const refusal = donor_refusal(error);
    if (!refusal) throw error;
    throw new AgentDonationError(refusal.code, refusal.reason);
  }
}

/** a retried quote resumes the saved row; the token's amounts are never re-read */
async function resume_checkout(don: IDonation | undefined, donor: IDonor) {
  if (don?.source !== "bg-agent") {
    throw new AgentDonationError(
      "invalid_quote",
      "The quote id is unavailable."
    );
  }
  if (don.from_email.toLowerCase() !== donor.email) {
    throw new AgentDonationError(
      "quote_conflict",
      "This quote is already reserved for a different donor. Request a new quote."
    );
  }
  if (don.status !== "created" && don.status !== "expired") {
    throw new AgentDonationError(
      "quote_used",
      "This quote was already paid. Check donation_status."
    );
  }
  if (don.status === "expired" || !don.via_extra) {
    return open_checkout(
      don,
      don.via_extra
        ? `agent-checkout:${don.id}:after:${don.via_extra}`
        : undefined
    );
  }

  const session = await checkout_session_state(don.via_extra);
  if (session.status === "open") {
    return { donation_id: don.id, checkout_url: session.url };
  }
  if (session.status === "expired") {
    await agent_donation_expire(don.id, don.via_extra);
    return open_checkout(
      don,
      `agent-checkout:${don.id}:after:${don.via_extra}`
    );
  }
  throw new AgentDonationError(
    "quote_used",
    "This quote was already paid. Check donation_status."
  );
}

export async function donate(input: unknown, request: Request) {
  const args = parsed(donate_input, input);
  const quote = decode_quote(args.quote_token);
  if (!quote_still_valid(quote)) throw quote_expired();
  const prior = await donation_get(quote.id);
  if (prior) return resume_checkout(prior, args.donor);

  const recipient = await to_fn(quote.recipient_id, { open_at: new Date() });
  if (!recipient) {
    throw new AgentDonationError(
      "recipient_unavailable",
      "This recipient is not accepting donations."
    );
  }
  await assert_address_optional(quote.recipient_id);
  if (!recipient.to_tip_allowed && quote.tip_percent !== "none") {
    throw new AgentDonationError(
      "tip_not_allowed",
      "This recipient does not accept Better Giving tips."
    );
  }
  const program_row =
    quote.program_id && typeof quote.recipient_id === "number"
      ? await npo_program_get(quote.program_id, quote.recipient_id)
      : undefined;
  if (quote.program_id && !program_row) {
    throw new AgentDonationError(
      "program_not_found",
      "The program does not belong to this nonprofit."
    );
  }
  const program = program_row
    ? { id: program_row.id, name: program_row.title }
    : undefined;
  const source_id = caller_id(request);
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const amount = quote_amount(
    quote.amount,
    quote.tip_percent,
    quote.cover_processing_fee
  );
  const { total: _total, ...donation_amount } = amount;
  const now = new Date().toISOString();
  const donor_data: IDonor = args.donor;
  const row: IDonation = {
    id: quote.id,
    status: "created",
    via: "stripe",
    via_extra: undefined,
    source_id,
    upusd: 1,
    created_at: now,
    updated_at: now,
    ...recipient,
    ...to_from(donor_data),
    amount: donation_amount,
    currency: "USD",
    frequency: "one-time",
    source: "bg-agent",
    program,
  };

  const reservation = await agent_donation_reserve(row, since, RATE_LIMIT);
  if (reservation === "limited") {
    throw new AgentDonationError(
      "rate_limited",
      "Donation checkout limit reached. Try again in one hour."
    );
  }
  if (reservation === "existing") {
    return resume_checkout(await donation_get(quote.id), args.donor);
  }
  return open_checkout(row);
}

/** a `created` row whose Checkout lapsed is expired, even if Stripe's expiry event never arrived */
async function current_status(don: IDonation): Promise<IDonation["status"]> {
  if (don.status !== "created" || !don.via_extra) return don.status;
  const session = await checkout_session_state(don.via_extra);
  if (session.status !== "expired") return don.status;
  await agent_donation_expire(don.id, don.via_extra);
  return "expired";
}

export async function donation_status(input: unknown) {
  const args = parsed(status_input, input);
  const donation = await donation_get(args.donation_id);
  if (donation?.source !== "bg-agent") {
    throw new AgentDonationError("not_found", "Donation not found.");
  }
  return {
    donation_id: donation.id,
    status: await current_status(donation),
    currency: donation.currency,
    amount: {
      ...donation.amount,
      total:
        donation.amount.base +
        donation.amount.tip +
        donation.amount.fee_allowance,
    },
  };
}
