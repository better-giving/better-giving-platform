import { createHash } from "node:crypto";
import { ADDRESS_LINES, EIN, LEGAL_NAME } from "@better-giving/brand";
import { is_custom, tokens_list } from "@better-giving/crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  fee_terms,
  type IFeeTerms,
} from "#/components/donation/common/amounts";
import {
  all_method_ids,
  freqs_shown,
  usd_option,
} from "#/components/donation/common/constants";
import { tip_formats } from "#/components/donation/types";
import { CHARIOT_CONNECT_SDK } from "#/constants/chariot";
import {
  chariot_connect_id,
  paypal_client_id,
  stripe_pk,
} from "#/constants/env";
import { PRIVACY_POLICY, TERMS_OF_USE_DONOR } from "#/constants/urls";
import { DEDUCTIBILITY_STATEMENT, logo_url } from "@/constants/common";
import { to_units } from "@/helpers/decimal";
import type { DonateMethodId, TFrequency } from "@/schemas";
import { connect_status, mirror_of } from "@/stripe-connect/readiness";
import { is_deposit_chain } from "../deposit-addr";
import { base_url, nowpayments } from "../env";
import type { DbOrTx } from "../pg/queries/helpers";
import { npos } from "../pg/schema/npo";
import { partner_tenants } from "../pg/schema/partner";

export const RAILS = [
  "card",
  "ach",
  "apple_pay",
  "google_pay",
  "paypal",
  "venmo",
  "daf",
  "crypto",
] as const;
export type Rail = (typeof RAILS)[number];

export const RAIL_STATES = [
  "active",
  "pending",
  "inactive",
  "unrequested",
] as const;
type RailState = (typeof RAIL_STATES)[number];
type Interval = "monthly" | "yearly";

interface IFeeRule {
  percent: number;
  fixed_minor: number;
  cap_minor?: number;
  round_up_minor?: number;
}

interface IRail {
  /** the checkout method whose tab offers it */
  method: DonateMethodId;
  /** the platform credential checkout needs for it */
  configured: () => boolean;
  fee: IFeeTerms;
  /** usd cents checkout rounds the gift total up to a multiple of: the cent
   * on stripe's rails (`donation_amounts`), the whole dollar on daf
   * (`whole_dollar_amounts`), both in common/amounts. the daf top-up lands on
   * the fee allowance when the donor covers fees, else on the tip. absent
   * where checkout doesn't round up: paypal truncates and crypto doesn't round */
  round_up_minor?: number;
  /** checkout offers it at the frequencies the nonprofit picked */
  recurring: boolean;
  /** the processor capability is the nonprofit's connected stripe account
   * (`connect_status`); paypal, daf and crypto have no such account here */
  connected_account?: true;
}

const has_stripe = () => !!stripe_pk;
const has_paypal = () => !!paypal_client_id;

const card_like: IRail = {
  method: "stripe",
  configured: has_stripe,
  fee: fee_terms.stripe,
  round_up_minor: 1,
  recurring: true,
  connected_account: true,
};

// paypal and venmo mount inside the card tab (methods/stripe/form.tsx), so
// they follow the `stripe` method; venmo is one-time only (methods/paypal.tsx)
const RAIL: Record<Rail, IRail> = {
  card: card_like,
  apple_pay: card_like,
  google_pay: card_like,
  ach: {
    method: "stripe_bank",
    configured: has_stripe,
    fee: fee_terms.stripe_bank,
    round_up_minor: 1,
    recurring: true,
    connected_account: true,
  },
  paypal: {
    method: "stripe",
    configured: has_paypal,
    fee: fee_terms.paypal,
    recurring: true,
  },
  venmo: {
    method: "stripe",
    configured: has_paypal,
    fee: fee_terms.paypal,
    recurring: false,
  },
  daf: {
    method: "daf",
    configured: () => !!chariot_connect_id,
    fee: fee_terms.daf,
    round_up_minor: 100,
    recurring: false,
  },
  crypto: {
    method: "crypto",
    configured: () => !!nowpayments.api_key,
    fee: fee_terms.crypto,
    recurring: false,
  },
};

const INTERVAL: Partial<Record<TFrequency, Interval>> = {
  monthly: "monthly",
  annual: "yearly",
};

const usd_cents = (usd: number) => to_units(usd, 2);

function fee_rule({ fee, round_up_minor }: IRail): IFeeRule {
  return {
    percent: fee.rate,
    fixed_minor: usd_cents(fee.flat ?? 0),
    ...(fee.cap === undefined ? {} : { cap_minor: usd_cents(fee.cap) }),
    ...(round_up_minor === undefined ? {} : { round_up_minor }),
  };
}

/** the memo flags nowpayments reports per token. the committed token data
 * (packages/crypto `generated/tokens`) carries neither, so every coin reads
 * as not requiring one */
export interface IMemoFlags {
  extra_id_exists?: boolean;
  extra_id_optional?: boolean;
}

/** a deposit memo is mandatory only where the coin has one and it isn't optional */
export const memo_required_of = (t: IMemoFlags): boolean =>
  t.extra_id_exists === true && t.extra_id_optional !== true;

/** the coins checkout's crypto intent takes: a custom token only on a chain
 * with a deposit address (api.donation-intents/crypto) */
const coins = () =>
  tokens_list
    .filter((x) => !is_custom(x.id) || is_deposit_chain(x.network))
    .map((x) => ({
      coin: x.code,
      ticker: x.symbol,
      name: x.name,
      network: x.network,
      memo_required: memo_required_of(x as IMemoFlags),
      // a custom token's logo is a path on this app; the integrator renders it
      // on its own origin
      logo: is_custom(x.id) ? `${base_url}${x.logo}` : logo_url(x.logo),
    }));

const clients = () => [
  ...(stripe_pk ? [{ name: "stripe", publishable_key: stripe_pk }] : []),
  ...(paypal_client_id
    ? [{ name: "paypal", publishable_key: paypal_client_id }]
    : []),
  ...(chariot_connect_id
    ? [
        {
          name: "chariot",
          publishable_key: chariot_connect_id,
          sdk_url: CHARIOT_CONNECT_SDK,
        },
      ]
    : []),
];

interface INpoCheckout {
  active: boolean;
  donate_methods: DonateMethodId[] | null;
  donate_frequencies: TFrequency[] | null;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  stripe_details_submitted: boolean;
  stripe_requirements_due: string[];
  stripe_deauthorized_at: string | null;
}

/** the state a rail that runs on the nonprofit's connected stripe account is in:
 * `unrequested` without an account, `pending` while stripe reviews it, and
 * not chargeable (`inactive`) while the nonprofit has to finish or has left */
function account_state(npo: INpoCheckout): RailState {
  if (npo.stripe_account_id === null) return "unrequested";
  switch (connect_status(mirror_of(npo), npo.stripe_deauthorized_at)) {
    case "ready":
      return "active";
    case "pending":
      return "pending";
    default:
      return "inactive";
  }
}

function body_of(npo: INpoCheckout) {
  const methods = npo.donate_methods ?? all_method_ids;
  const recurring = (freqs_shown(npo.donate_frequencies ?? undefined) ?? [])
    .map((f) => INTERVAL[f])
    .filter((x) => x !== undefined);

  const state = (r: IRail): RailState => {
    if (!methods.includes(r.method)) return "unrequested";
    if (!npo.active || !r.configured()) return "inactive";
    return r.connected_account ? account_state(npo) : "active";
  };
  const per_rail = <T>(f: (rail: Rail, r: IRail) => T) =>
    Object.fromEntries(RAILS.map((x) => [x, f(x, RAIL[x])])) as Record<Rail, T>;

  const rails = per_rail((_, r) => {
    const s = state(r);
    return { state: s, offered: s === "active" };
  });
  return {
    charges_enabled: Object.values(rails).some((r) => r.offered),
    currencies: [usd_option.code],
    sponsor: {
      legal_name: LEGAL_NAME,
      ein: EIN,
      address: [...ADDRESS_LINES],
      deductibility_statement: DEDUCTIBILITY_STATEMENT,
      terms_url: TERMS_OF_USE_DONOR,
      privacy_url: PRIVACY_POLICY,
    },
    clients: clients(),
    rails,
    intervals: per_rail((x, r) =>
      rails[x].offered && r.recurring ? recurring : []
    ),
    fee_rules: per_rail((_, r) => fee_rule(r)),
    coins: coins(),
    contribution: {
      // checkout's tip presets as fractions. not gated on the nonprofit's
      // `hide_bg_tip`: the hosted site's sponsor row is not that setting
      options: tip_formats
        .map(Number)
        .filter((n) => Number.isFinite(n))
        .map((n) => n / 100),
      starts_at: null,
    },
    wallet_hosts: [],
  };
}

export type ReadinessBody = ReturnType<typeof body_of> & { revision: number };

/** JSON with every object's keys sorted, so equal bodies hash equal */
const stable_json = (x: unknown): string =>
  JSON.stringify(x, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        )
      : v
  );

/** what the nonprofit's checkout offers, under the tenant's revision. the
 * revision rises in the same statement that records a changed body's
 * fingerprint, so it moves exactly when the body does */
export async function readiness(
  db: DbOrTx,
  npo_id: number
): Promise<ReadinessBody> {
  const [npo] = await db
    .select({
      active: npos.active,
      donate_methods: npos.donate_methods,
      donate_frequencies: npos.donate_frequencies,
      stripe_account_id: npos.stripe_account_id,
      stripe_charges_enabled: npos.stripe_charges_enabled,
      stripe_payouts_enabled: npos.stripe_payouts_enabled,
      stripe_details_submitted: npos.stripe_details_submitted,
      stripe_requirements_due: npos.stripe_requirements_due,
      stripe_deauthorized_at: npos.stripe_deauthorized_at,
    })
    .from(npos)
    .where(eq(npos.id, npo_id));
  if (!npo) throw new Error(`readiness: no nonprofit ${npo_id}`);

  const body = body_of(npo);
  const fingerprint = createHash("sha256")
    .update(stable_json(body), "utf8")
    .digest("hex");

  const [bumped] = await db
    .update(partner_tenants)
    .set({ revision: sql`${partner_tenants.revision} + 1`, fingerprint })
    .where(
      and(
        eq(partner_tenants.npo_id, npo_id),
        sql`${partner_tenants.fingerprint} is distinct from ${fingerprint}`
      )
    )
    .returning({ revision: partner_tenants.revision });
  const [row] = bumped
    ? [bumped]
    : await db
        .select({ revision: partner_tenants.revision })
        .from(partner_tenants)
        .where(eq(partner_tenants.npo_id, npo_id));
  // mint creates the tenant with the first key, so a live key always has one
  if (!row) throw new Error(`readiness: no partner tenant for npo ${npo_id}`);

  return { revision: row.revision, ...body };
}
