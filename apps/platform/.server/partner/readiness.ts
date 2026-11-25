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
import { is_deposit_chain } from "../deposit-addr";
import { nowpayments } from "../env";
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

type RailState = "active" | "pending" | "inactive" | "unrequested";
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
  /** checkout rounds this rail's fee allowance up to the cent
   * (`donation_amounts`); paypal truncates and crypto doesn't round */
  rounds_up: boolean;
  /** checkout offers it at the frequencies the nonprofit picked */
  recurring: boolean;
}

const has_stripe = () => !!stripe_pk;
const has_paypal = () => !!paypal_client_id;

const card_like: IRail = {
  method: "stripe",
  configured: has_stripe,
  fee: fee_terms.stripe,
  rounds_up: true,
  recurring: true,
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
    rounds_up: true,
    recurring: true,
  },
  paypal: {
    method: "stripe",
    configured: has_paypal,
    fee: fee_terms.paypal,
    rounds_up: false,
    recurring: true,
  },
  venmo: {
    method: "stripe",
    configured: has_paypal,
    fee: fee_terms.paypal,
    rounds_up: false,
    recurring: false,
  },
  daf: {
    method: "daf",
    configured: () => !!chariot_connect_id,
    fee: fee_terms.daf,
    rounds_up: true,
    recurring: false,
  },
  crypto: {
    method: "crypto",
    configured: () => !!nowpayments.api_key,
    fee: fee_terms.crypto,
    rounds_up: false,
    recurring: false,
  },
};

const INTERVAL: Partial<Record<TFrequency, Interval>> = {
  monthly: "monthly",
  annual: "yearly",
};

const usd_cents = (usd: number) => to_units(usd, 2);

function fee_rule({ fee, rounds_up }: IRail): IFeeRule {
  return {
    percent: fee.rate,
    fixed_minor: usd_cents(fee.flat ?? 0),
    ...(fee.cap === undefined ? {} : { cap_minor: usd_cents(fee.cap) }),
    ...(rounds_up ? { round_up_minor: 1 } : {}),
  };
}

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
      // the token data carries no memo flag: checkout learns of one from the
      // payment's `payin_extra_id`
      memo_required: false,
      logo: logo_url(x.logo, is_custom(x.id)),
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
}

function body_of(npo: INpoCheckout) {
  const methods = npo.donate_methods ?? all_method_ids;
  const recurring = (freqs_shown(npo.donate_frequencies ?? undefined) ?? [])
    .map((f) => INTERVAL[f])
    .filter((x) => x !== undefined);

  const state = (r: IRail): RailState => {
    if (!methods.includes(r.method)) return "unrequested";
    if (!npo.active || !r.configured()) return "inactive";
    return "active";
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
