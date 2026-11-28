import { is_custom, tokens_list } from "@better-giving/crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import { fee_terms } from "#/components/donation/common/amounts";
import {
  all_method_ids,
  freqs_shown,
} from "#/components/donation/common/constants";
import { logo_url } from "@/constants/common";
import { to_units } from "@/helpers/decimal";
import type { DonateMethodId, TFrequency } from "@/schemas";
import { is_deposit_chain } from "../deposit-addr";
import type { Rail } from "./readiness";

// the publishable ids checkout reads, switchable per test
const pub = vi.hoisted(() => ({
  paypal_client_id: "" as string | undefined,
  stripe_pk: "" as string | undefined,
  chariot_connect_id: "" as string | undefined,
}));
vi.mock("#/constants/env", async (orig) => {
  const real = await orig<typeof import("#/constants/env")>();
  Object.assign(pub, {
    paypal_client_id: real.paypal_client_id,
    stripe_pk: real.stripe_pk,
    chariot_connect_id: real.chariot_connect_id,
  });
  return {
    ...real,
    get paypal_client_id() {
      return pub.paypal_client_id;
    },
    get stripe_pk() {
      return pub.stripe_pk;
    },
    get chariot_connect_id() {
      return pub.chariot_connect_id;
    },
  };
});

// the sponsor's name and the policy urls, switchable per test
const swap = vi.hoisted(() => ({
  legal_name: undefined as string | undefined,
  privacy: undefined as string | undefined,
}));
vi.mock("@better-giving/brand", async (orig) => {
  const real = await orig<typeof import("@better-giving/brand")>();
  return {
    ...real,
    get LEGAL_NAME() {
      return swap.legal_name ?? real.LEGAL_NAME;
    },
  };
});
vi.mock("#/constants/urls", async (orig) => {
  const real = await orig<typeof import("#/constants/urls")>();
  return {
    ...real,
    get PRIVACY_POLICY() {
      return swap.privacy ?? real.PRIVACY_POLICY;
    },
  };
});

const { npos } = await import("../pg/schema/npo");
const { user } = await import("../pg/schema/auth");
const { partner_keys, partner_tenants } = await import("../pg/schema/partner");
const { create_test_db } = await import("../pg/test-utils/pglite");
const { mint_key } = await import("./keys");
const { fingerprint_of, readiness } = await import("./readiness");
const env = await import("#/constants/env");
const { base_url, nowpayments: np } = await import("../env");
// declared read-only; the rail reads it per call, so a test swaps it
const nowpayments = np as { api_key: string | undefined };

type Db = Parameters<typeof mint_key>[0];
// pglite's drizzle handle differs from neon's only in the result-type HKT
const as_db = (x: unknown) => x as Db;

let t: Awaited<ReturnType<typeof create_test_db>>;
let real_pub: typeof pub;
let real_np_key: string | undefined;

beforeAll(async () => {
  t = await create_test_db();
  real_pub = { ...pub };
  real_np_key = nowpayments.api_key;
}, 30_000);

afterAll(async () => {
  await t?.client.close();
});

beforeEach(async () => {
  Object.assign(pub, real_pub);
  Object.assign(swap, { legal_name: undefined, privacy: undefined });
  nowpayments.api_key = real_np_key;
  await t.db.delete(partner_keys);
  await t.db.delete(partner_tenants);
  await t.db.delete(npos);
  await t.db.delete(user);
});

/** a connected stripe account that can take charges and pay out */
const READY_ACCOUNT = {
  stripe_charges_enabled: true,
  stripe_payouts_enabled: true,
  stripe_details_submitted: true,
  stripe_requirements_due: [] as string[],
};

let seeded = 0;

const seed_tenant = async (
  over: Parameters<typeof seed_npo>[1] = {}
): Promise<number> => {
  seeded += 1;
  const staff = (await seed_user(t.db, `staff-${seeded}@test.com`))!;
  const npo = (await seed_npo(t.db, {
    registration_number: `EIN-T${seeded}`,
    stripe_account_id: `acct_${seeded}`,
    ...READY_ACCOUNT,
    ...over,
  }))!;
  await mint_key(as_db(t.db), { npo_id: npo.id, minted_by: staff.id });
  return npo.id;
};

const read = (npo_id: number) => readiness(as_db(t.db), npo_id);

/** the test db, running `before` ahead of every transaction it opens and
 * counting them */
const watched = (before: () => Promise<unknown> = async () => {}) => {
  const seen = { transactions: 0 };
  const db = new Proxy(t.db, {
    get(target, prop, receiver) {
      if (prop !== "transaction") return Reflect.get(target, prop, receiver);
      return async (...args: Parameters<typeof target.transaction>) => {
        seen.transactions += 1;
        await before();
        return target.transaction(...args);
      };
    },
  });
  return { db: as_db(db), seen };
};

// which checkout method's tab offers each rail, written out apart from
// readiness.ts so a wrong mapping there fails here
const RAIL_METHOD: Record<Rail, DonateMethodId> = {
  card: "stripe",
  apple_pay: "stripe",
  google_pay: "stripe",
  ach: "stripe_bank",
  paypal: "stripe",
  venmo: "stripe",
  daf: "daf",
  crypto: "crypto",
};
const RAIL_NAMES = Object.keys(RAIL_METHOD) as Rail[];

/** what checkout's frequency selector offers, in the contract's words */
const recurring_of = (freqs: TFrequency[] | null): string[] =>
  (freqs_shown(freqs ?? undefined) ?? []).flatMap((f) =>
    f === "weekly"
      ? ["weekly"]
      : f === "monthly"
        ? ["monthly"]
        : f === "annual"
          ? ["yearly"]
          : []
  );

/** the coins checkout's crypto intent accepts */
const accepted_coins = () =>
  tokens_list
    .filter((x) => !is_custom(x.id) || is_deposit_chain(x.network))
    .map((x) => ({
      coin: x.code,
      ticker: x.symbol,
      name: x.name,
      network: x.network,
      logo: is_custom(x.id) ? `${base_url}${x.logo}` : logo_url(x.logo),
    }));

const cents = (usd: number) => to_units(usd, 2);

describe("readiness", () => {
  test("a nonprofit with donate_methods restricted: rails, intervals, coins and fee rules are what its checkout offers", async () => {
    const methods: DonateMethodId[] = ["stripe", "crypto"];
    const freqs: TFrequency[] = ["one-time", "weekly", "monthly", "annual"];
    const npo_id = await seed_tenant({
      donate_methods: methods,
      donate_frequencies: freqs,
    });

    const r = await read(npo_id);

    for (const rail of RAIL_NAMES) {
      const on = methods.includes(RAIL_METHOD[rail]);
      expect(r.rails[rail], rail).toEqual({
        state: on ? "active" : "unrequested",
        offered: on,
      });
    }
    const recurring = recurring_of(freqs);
    expect(r.intervals).toEqual({
      card: recurring,
      apple_pay: recurring,
      google_pay: recurring,
      paypal: recurring,
      // venmo is one-time only in checkout, and crypto has no frequency
      venmo: [],
      // not offered
      ach: [],
      daf: [],
      crypto: [],
    });
    expect(r.coins).toEqual(
      accepted_coins().map((c) => ({ ...c, memo_required: false }))
    );
    expect(r.fee_rules).toEqual({
      card: {
        percent: fee_terms.stripe.rate,
        fixed_minor: cents(fee_terms.stripe.flat),
        round_up_minor: 1,
      },
      apple_pay: {
        percent: fee_terms.stripe.rate,
        fixed_minor: cents(fee_terms.stripe.flat),
        round_up_minor: 1,
      },
      google_pay: {
        percent: fee_terms.stripe.rate,
        fixed_minor: cents(fee_terms.stripe.flat),
        round_up_minor: 1,
      },
      ach: {
        percent: fee_terms.stripe_bank.rate,
        fixed_minor: 0,
        cap_minor: cents(fee_terms.stripe_bank.cap),
        round_up_minor: 1,
      },
      paypal: {
        percent: fee_terms.paypal.rate,
        fixed_minor: cents(fee_terms.paypal.flat),
      },
      venmo: {
        percent: fee_terms.paypal.rate,
        fixed_minor: cents(fee_terms.paypal.flat),
      },
      // chariot grants whole dollars, so checkout tops the total up to one
      daf: { percent: fee_terms.daf.rate, fixed_minor: 0, round_up_minor: 100 },
      crypto: { percent: fee_terms.crypto.rate, fixed_minor: 0 },
    });
    expect(r.charges_enabled).toBe(true);
  });

  test("every coin's logo is an absolute url, custom tokens' on the app's own origin", async () => {
    const npo_id = await seed_tenant({ donate_methods: ["crypto"] });

    const { coins } = await read(npo_id);

    const custom = tokens_list.filter(
      (x) => is_custom(x.id) && is_deposit_chain(x.network)
    );
    expect(custom.length).toBeGreaterThan(0);
    for (const x of custom) {
      const coin = coins.find(
        (c) => c.coin === x.code && c.network === x.network
      );
      expect(coin?.logo, x.code).toBe(`${base_url}${x.logo}`);
    }
    for (const c of coins) {
      expect(new URL(c.logo).protocol, c.coin).toMatch(/^https?:$/);
    }
  });

  test("donate_methods null offers every rail, at checkout's default frequencies", async () => {
    const npo_id = await seed_tenant({
      donate_methods: null,
      donate_frequencies: null,
    });

    const r = await read(npo_id);

    expect(new Set(Object.values(RAIL_METHOD))).toEqual(
      new Set(all_method_ids.filter((m) => m !== "stocks" && m !== "ira_qcd"))
    );
    for (const rail of RAIL_NAMES) {
      expect(r.rails[rail], rail).toEqual({ state: "active", offered: true });
    }
    const recurring = recurring_of(null);
    expect(recurring).toEqual(["monthly"]);
    expect(r.intervals).toEqual({
      card: recurring,
      apple_pay: recurring,
      google_pay: recurring,
      ach: recurring,
      paypal: recurring,
      venmo: [],
      daf: [],
      crypto: [],
    });
  });

  test("one-time only offers no interval anywhere", async () => {
    const npo_id = await seed_tenant({ donate_frequencies: ["one-time"] });

    const { intervals } = await read(npo_id);

    expect(Object.values(intervals).flat()).toEqual([]);
  });

  // the repeating rails are the stripe family and paypal; venmo, daf and
  // crypto take one-time gifts only
  const REPEATING = ["card", "ach", "apple_pay", "google_pay", "paypal"];

  test("a weekly-only setting offers weekly on the repeating rails", async () => {
    const npo_id = await seed_tenant({
      donate_frequencies: ["one-time", "weekly"],
    });

    const { intervals } = await read(npo_id);

    for (const rail of RAIL_NAMES) {
      expect(intervals[rail], rail).toEqual(
        REPEATING.includes(rail) ? ["weekly"] : []
      );
    }
  });

  test("weekly, monthly and annual together come back as weekly, monthly, yearly", async () => {
    const npo_id = await seed_tenant({
      donate_frequencies: ["one-time", "weekly", "monthly", "annual"],
    });

    const { intervals } = await read(npo_id);

    for (const rail of RAIL_NAMES) {
      expect(intervals[rail], rail).toEqual(
        REPEATING.includes(rail) ? ["weekly", "monthly", "yearly"] : []
      );
    }
  });

  test("weekly alongside monthly leaves out the annual interval", async () => {
    const npo_id = await seed_tenant({
      donate_frequencies: ["weekly", "monthly"],
    });

    const { intervals } = await read(npo_id);

    expect(intervals.card).toEqual(["weekly", "monthly"]);
    expect(intervals.venmo).toEqual([]);
  });

  test("a nonprofit that is not active has every requested rail inactive, and no charges", async () => {
    const npo_id = await seed_tenant({
      active: false,
      donate_methods: ["daf"],
    });

    const r = await read(npo_id);

    expect(r.rails.daf).toEqual({ state: "inactive", offered: false });
    expect(r.rails.card).toEqual({ state: "unrequested", offered: false });
    expect(r.charges_enabled).toBe(false);
    expect(Object.values(r.intervals).flat()).toEqual([]);
  });

  test("without paypal's client id, paypal and venmo are inactive and its client is not served", async () => {
    pub.paypal_client_id = undefined;
    const npo_id = await seed_tenant({ donate_methods: null });

    const r = await read(npo_id);

    expect(r.rails.paypal).toEqual({ state: "inactive", offered: false });
    expect(r.rails.venmo).toEqual({ state: "inactive", offered: false });
    expect(r.rails.card.state).toBe("active");
    expect(r.intervals.paypal).toEqual([]);
    expect(r.clients.map((c) => c.name)).toEqual(["stripe", "chariot"]);
  });

  test("without stripe's key, card, ach and the wallets are inactive and its client is not served", async () => {
    pub.stripe_pk = undefined;
    const npo_id = await seed_tenant({ donate_methods: null });

    const r = await read(npo_id);

    for (const rail of ["card", "ach", "apple_pay", "google_pay"] as const) {
      expect(r.rails[rail], rail).toEqual({
        state: "inactive",
        offered: false,
      });
      expect(r.intervals[rail], rail).toEqual([]);
    }
    expect(r.rails.paypal.state).toBe("active");
    expect(r.rails.daf.state).toBe("active");
    expect(r.clients.map((c) => c.name)).toEqual(["paypal", "chariot"]);
    expect(r.charges_enabled).toBe(true);
  });

  test("without chariot's connect id, daf is inactive and its client is not served", async () => {
    pub.chariot_connect_id = undefined;
    const npo_id = await seed_tenant({ donate_methods: null });

    const r = await read(npo_id);

    expect(r.rails.daf).toEqual({ state: "inactive", offered: false });
    expect(r.rails.card.state).toBe("active");
    expect(r.clients.map((c) => c.name)).toEqual(["stripe", "paypal"]);
  });

  test("without nowpayments' api key, crypto is inactive", async () => {
    nowpayments.api_key = undefined;
    const npo_id = await seed_tenant({ donate_methods: null });

    const r = await read(npo_id);

    expect(r.rails.crypto).toEqual({ state: "inactive", offered: false });
    expect(r.rails.daf.state).toBe("active");
  });

  test("donate_methods [] is every rail unrequested, with no charges and no interval", async () => {
    const npo_id = await seed_tenant({ donate_methods: [] });

    const r = await read(npo_id);

    for (const rail of RAIL_NAMES) {
      expect(r.rails[rail], rail).toEqual({
        state: "unrequested",
        offered: false,
      });
    }
    expect(r.charges_enabled).toBe(false);
    expect(Object.values(r.intervals).flat()).toEqual([]);
  });

  test("clients, sponsor and contribution come from what checkout reads", async () => {
    const npo_id = await seed_tenant();
    const { tip_formats } = await import("#/components/donation/types");
    const brand = await import("@better-giving/brand");
    const urls = await import("#/constants/urls");
    const { CHARIOT_CONNECT_SDK } = await import("#/constants/chariot");
    const { DEDUCTIBILITY_STATEMENT } = await import("@/constants/common");

    const r = await read(npo_id);

    expect(r.clients).toEqual([
      { name: "stripe", publishable_key: env.stripe_pk },
      { name: "paypal", publishable_key: env.paypal_client_id },
      {
        name: "chariot",
        publishable_key: env.chariot_connect_id,
        sdk_url: CHARIOT_CONNECT_SDK,
      },
    ]);
    expect(r.sponsor).toEqual({
      legal_name: brand.LEGAL_NAME,
      ein: brand.EIN,
      address: [...brand.ADDRESS_LINES],
      deductibility_statement: DEDUCTIBILITY_STATEMENT,
      terms_url: urls.TERMS_OF_USE_DONOR,
      privacy_url: urls.PRIVACY_POLICY,
    });
    expect(r.contribution).toEqual({
      options: tip_formats
        .filter((f) => /^\d+$/.test(f))
        .map((f) => Number(f) / 100),
      starts_at: null,
    });
    expect(r.contribution.options).toEqual([0.1, 0.15, 0.2]);
    expect(r.currencies).toEqual(["USD"]);
    expect(r.wallet_hosts).toEqual([]);
  });
});

const STRIPE_RAILS = ["card", "ach", "apple_pay", "google_pay"] as const;
const OTHER_RAILS = ["paypal", "venmo", "daf", "crypto"] as const;

describe("rails on the connected stripe account", () => {
  const states_of = async (over: Parameters<typeof seed_npo>[1]) => {
    const r = await read(await seed_tenant({ donate_methods: null, ...over }));
    return r.rails;
  };

  test("under review at stripe: pending, not offered, no interval and no charges from them", async () => {
    const npo_id = await seed_tenant({
      donate_methods: ["stripe", "stripe_bank"],
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
    });

    const r = await read(npo_id);

    for (const rail of STRIPE_RAILS) {
      expect(r.rails[rail], rail).toEqual({ state: "pending", offered: false });
      expect(r.intervals[rail], rail).toEqual([]);
    }
    // paypal and venmo have no connected account here
    expect(r.rails.paypal).toEqual({ state: "active", offered: true });
    expect(r.rails.venmo).toEqual({ state: "active", offered: true });
    expect(r.charges_enabled).toBe(true);
  });

  // checkout charges card without a connected account (the account only picks
  // where the money settles), so readiness offers it
  test("no stripe account is never pending: the rails follow checkout and are active", async () => {
    const rails = await states_of({
      stripe_account_id: null,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
      stripe_details_submitted: false,
    });

    for (const rail of [...STRIPE_RAILS, ...OTHER_RAILS]) {
      expect(rails[rail], rail).toEqual({ state: "active", offered: true });
    }
  });

  test("no stripe account still reads unrequested where the method is not enabled, and inactive without stripe's key", async () => {
    const not_enabled = await states_of({
      donate_methods: ["crypto"],
      stripe_account_id: null,
    });
    for (const rail of STRIPE_RAILS) {
      expect(not_enabled[rail], rail).toEqual({
        state: "unrequested",
        offered: false,
      });
    }

    pub.stripe_pk = undefined;
    const no_key = await states_of({ stripe_account_id: null });
    for (const rail of STRIPE_RAILS) {
      expect(no_key[rail], rail).toEqual({ state: "inactive", offered: false });
    }
  });

  test("only ach's own method enabled: ach is offered, the card rails are not requested", async () => {
    const rails = await states_of({
      donate_methods: ["stripe_bank"],
    });

    expect(rails.ach).toEqual({ state: "active", offered: true });
    // paypal and venmo mount in the card tab, so they follow `stripe`
    for (const rail of [
      "card",
      "apple_pay",
      "google_pay",
      "paypal",
      "venmo",
    ] as const) {
      expect(rails[rail], rail).toEqual({
        state: "unrequested",
        offered: false,
      });
    }
  });

  test("an account the nonprofit has to finish is inactive, not pending", async () => {
    const unfinished = await states_of({
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
      stripe_details_submitted: false,
    });
    const owes = await states_of({
      stripe_charges_enabled: false,
      stripe_requirements_due: ["external_account"],
    });

    for (const rails of [unfinished, owes]) {
      for (const rail of STRIPE_RAILS) {
        expect(rails[rail], rail).toEqual({
          state: "inactive",
          offered: false,
        });
      }
    }
  });

  test("charges on but payouts off, details submitted and nothing due: pending", async () => {
    const rails = await states_of({ stripe_payouts_enabled: false });

    for (const rail of STRIPE_RAILS) {
      expect(rails[rail], rail).toEqual({ state: "pending", offered: false });
    }
  });

  test("charges on but payouts off with requirements due: inactive, the nonprofit's move", async () => {
    const rails = await states_of({
      stripe_payouts_enabled: false,
      stripe_requirements_due: ["external_account"],
    });

    for (const rail of STRIPE_RAILS) {
      expect(rails[rail], rail).toEqual({ state: "inactive", offered: false });
    }
  });

  // pins connect_status as it stands: `ready` is decided before requirements
  // are read, so a mirror with all three flags on is active whatever is due
  test("charges, payouts and details on with requirements due still reads active", async () => {
    const rails = await states_of({
      stripe_requirements_due: ["individual.verification.document"],
    });

    for (const rail of STRIPE_RAILS) {
      expect(rails[rail], rail).toEqual({ state: "active", offered: true });
    }
  });

  test("a nonprofit that disconnected is inactive, even with a ready mirror", async () => {
    const rails = await states_of({
      stripe_deauthorized_at: "2026-11-01T00:00:00.000Z",
    });

    for (const rail of STRIPE_RAILS) {
      expect(rails[rail], rail).toEqual({ state: "inactive", offered: false });
    }
  });

  test("a ready account is active", async () => {
    const rails = await states_of({});

    for (const rail of STRIPE_RAILS) {
      expect(rails[rail], rail).toEqual({ state: "active", offered: true });
    }
  });

  test("pending never hides a stronger refusal: excluded stays unrequested, missing key or inactive nonprofit stays inactive", async () => {
    const excluded = await states_of({
      donate_methods: ["crypto"],
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
    });
    expect(excluded.card).toEqual({ state: "unrequested", offered: false });

    const inactive = await states_of({
      active: false,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
    });
    expect(inactive.card).toEqual({ state: "inactive", offered: false });
  });

  test("without stripe's key a pending account reads inactive", async () => {
    pub.stripe_pk = undefined;
    const rails = await states_of({
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
    });

    expect(rails.card).toEqual({ state: "inactive", offered: false });
  });
});

describe("coins' memo flag", () => {
  // a code can sit on several networks; id and network name the one token
  const coin_of = (
    r: Awaited<ReturnType<typeof read>>,
    x: { code: string; network: string }
  ) => {
    const hits = r.coins.filter(
      (c) => c.coin === x.code && c.network === x.network
    );
    expect(hits, `${x.code} on ${x.network}`).toHaveLength(1);
    return hits[0];
  };

  test("required, optional and absent memo", async () => {
    const npo_id = await seed_tenant({ donate_methods: ["crypto"] });
    const [needs, optional, none] = tokens_list.filter((x) => !is_custom(x.id));
    const flagged = [needs, optional, none];
    const keep = flagged.map((x) => ({ ...x }));
    try {
      Object.assign(needs, { extra_id_exists: true, extra_id_optional: false });
      Object.assign(optional, {
        extra_id_exists: true,
        extra_id_optional: true,
      });
      Object.assign(none, { extra_id_exists: false });

      const r = await read(npo_id);

      expect(coin_of(r, needs)?.memo_required).toBe(true);
      expect(coin_of(r, optional)?.memo_required).toBe(false);
      expect(coin_of(r, none)?.memo_required).toBe(false);
    } finally {
      flagged.forEach((x, i) => {
        for (const k of ["extra_id_exists", "extra_id_optional"]) {
          delete (x as unknown as Record<string, unknown>)[k];
        }
        Object.assign(x, keep[i]);
      });
    }
  });

  test("a token with the flag unset, or only the optional flag, is not required", async () => {
    const { memo_required_of } = await import("./readiness");
    expect(memo_required_of({})).toBe(false);
    expect(memo_required_of({ extra_id_optional: true })).toBe(false);
    expect(memo_required_of({ extra_id_exists: true })).toBe(true);
    expect(
      memo_required_of({ extra_id_exists: true, extra_id_optional: true })
    ).toBe(false);
    expect(memo_required_of({ extra_id_exists: false })).toBe(false);
  });
});

describe("revision", () => {
  const tenant_row = async (npo_id: number) => {
    const [row] = await t.db
      .select({
        revision: partner_tenants.revision,
        fingerprint: partner_tenants.fingerprint,
      })
      .from(partner_tenants)
      .where(eq(partner_tenants.npo_id, npo_id));
    return row;
  };

  test("a read whose body matches the stored fingerprint returns the stored revision without opening a transaction", async () => {
    const npo_id = await seed_tenant({ donate_methods: ["stripe"] });
    const first = await read(npo_id);
    const stored = await tenant_row(npo_id);

    const { db, seen } = watched();
    expect(await readiness(db, npo_id)).toEqual(first);
    expect(seen.transactions).toBe(0);
    expect(await tenant_row(npo_id)).toEqual(stored);
  });

  test("stays put on a second read of the same body, and rises once when donate_methods changes", async () => {
    const npo_id = await seed_tenant({ donate_methods: ["stripe"] });

    const first = await read(npo_id);
    const stored = await tenant_row(npo_id);
    const second = await read(npo_id);

    expect(first.revision).toBe(1);
    expect(second).toEqual(first);
    expect(await tenant_row(npo_id)).toEqual(stored);

    await t.db
      .update(npos)
      .set({ donate_methods: ["stripe", "daf"] })
      .where(eq(npos.id, npo_id));
    const third = await read(npo_id);
    const fourth = await read(npo_id);

    expect(third.revision).toBe(2);
    expect(third.rails.daf.offered).toBe(true);
    expect(fourth.revision).toBe(2);
  });

  describe("rises once for a change in each input of the body", () => {
    const rises = async (
      npo_id: number,
      change: () => void | Promise<void>
    ) => {
      const before = await read(npo_id);
      expect((await read(npo_id)).revision).toBe(before.revision);
      await change();
      const after = await read(npo_id);
      expect(after.revision).toBe(before.revision + 1);
      expect((await read(npo_id)).revision).toBe(after.revision);
    };

    test("active", async () => {
      const npo_id = await seed_tenant({ donate_methods: ["daf"] });
      await rises(npo_id, async () => {
        await t.db
          .update(npos)
          .set({ active: false })
          .where(eq(npos.id, npo_id));
      });
    });

    test("donate_frequencies", async () => {
      const npo_id = await seed_tenant({
        donate_frequencies: ["one-time", "monthly"],
      });
      await rises(npo_id, async () => {
        await t.db
          .update(npos)
          .set({ donate_frequencies: ["one-time"] })
          .where(eq(npos.id, npo_id));
      });
    });

    test("an env credential", async () => {
      const npo_id = await seed_tenant({ donate_methods: null });
      await rises(npo_id, () => {
        pub.stripe_pk = undefined;
      });
    });

    test("a publishable id's value, with the client still served", async () => {
      const npo_id = await seed_tenant({ donate_methods: null });
      await rises(npo_id, () => {
        pub.paypal_client_id = "a-rotated-client-id";
      });
    });

    test("a policy url", async () => {
      const npo_id = await seed_tenant({ donate_methods: null });
      await rises(npo_id, () => {
        swap.privacy = "https://example.test/privacy";
      });
    });

    test("the sponsor's identity", async () => {
      const npo_id = await seed_tenant({ donate_methods: null });
      await rises(npo_id, () => {
        swap.legal_name = "A Renamed Sponsor";
      });
    });

    test("a fee rule", async () => {
      const npo_id = await seed_tenant({ donate_methods: null });
      // the terms are declared read-only; the rail reads them per call
      const terms = fee_terms.crypto as { rate: number };
      const keep = terms.rate;
      try {
        await rises(npo_id, () => {
          terms.rate = keep + 0.001;
        });
      } finally {
        terms.rate = keep;
      }
    });

    test("the coin list", async () => {
      const npo_id = await seed_tenant({ donate_methods: null });
      const added = { ...tokens_list[0], code: "NEWCOIN" };
      try {
        await rises(npo_id, () => {
          tokens_list.push(added);
        });
      } finally {
        tokens_list.splice(tokens_list.indexOf(added), 1);
      }
    });
  });

  describe("rises once when the connected stripe account's mirror changes", () => {
    const rises_on_npo = (
      name: string,
      seed: Parameters<typeof seed_npo>[1],
      set: Partial<typeof npos.$inferInsert>
    ) =>
      test(name, async () => {
        const npo_id = await seed_tenant({
          donate_methods: ["stripe"],
          ...seed,
        });
        const before = await read(npo_id);
        await t.db.update(npos).set(set).where(eq(npos.id, npo_id));
        const after = await read(npo_id);
        expect(after.rails.card.state).not.toBe(before.rails.card.state);
        expect(after.revision).toBe(before.revision + 1);
        expect((await read(npo_id)).revision).toBe(after.revision);
      });

    // an account under review holds card back; with none it is offered again
    rises_on_npo(
      "account id",
      { stripe_charges_enabled: false, stripe_payouts_enabled: false },
      { stripe_account_id: null }
    );
    rises_on_npo("charges enabled", {}, { stripe_charges_enabled: false });
    rises_on_npo("payouts enabled", {}, { stripe_payouts_enabled: false });
    rises_on_npo("details submitted", {}, { stripe_details_submitted: false });
    // charges off keeps the account out of `ready`, where requirements are read
    rises_on_npo(
      "requirements due",
      { stripe_charges_enabled: false },
      { stripe_requirements_due: ["external_account"] }
    );
    rises_on_npo(
      "deauthorized",
      {},
      { stripe_deauthorized_at: "2026-11-01T00:00:00.000Z" }
    );
  });

  // the id is not in the body, only whether an account exists; the tests
  // above prove the same read does move when that state changes
  test("swapping one connected account for another moves no revision", async () => {
    const npo_id = await seed_tenant({ donate_methods: ["stripe"] });
    const before = await read(npo_id);
    await t.db
      .update(npos)
      .set({ stripe_account_id: "acct_swapped" })
      .where(eq(npos.id, npo_id));
    const after = await read(npo_id);
    expect(after.rails.card).toEqual(before.rails.card);
    expect(after.revision).toBe(before.revision);
  });

  test("a nonprofit's revision moves only with its own body", async () => {
    const mine = await seed_tenant({ donate_methods: ["stripe"] });
    const staff = (await seed_user(t.db, "bo@test.com"))!;
    const theirs = (await seed_npo(t.db, { registration_number: "EIN-2" }))!;
    await mint_key(as_db(t.db), { npo_id: theirs.id, minted_by: staff.id });
    await read(mine);
    await read(theirs.id);

    await t.db
      .update(npos)
      .set({ donate_methods: ["crypto"] })
      .where(eq(npos.id, theirs.id));
    await read(theirs.id);

    expect((await read(mine)).revision).toBe(1);
    expect((await read(theirs.id)).revision).toBe(2);
  });

  describe("the body and the revision are one stored pair", () => {
    /** the stored row the answer has to be, and the hash of the body it carries */
    const stored = async (npo_id: number) => ({
      row: await tenant_row(npo_id),
    });
    const pair_of = (r: Awaited<ReturnType<typeof read>>) => {
      const { revision, ...body } = r;
      return { revision, fingerprint: fingerprint_of(body) };
    };

    test("a write that lands after the plain reads saw a changed body is in the body and the revision it returns", async () => {
      const npo_id = await seed_tenant({ donate_methods: ["stripe"] });
      const first = await read(npo_id);
      expect(first.revision).toBe(1);
      await t.db
        .update(npos)
        .set({ donate_methods: ["stripe", "crypto"] })
        .where(eq(npos.id, npo_id));

      // the plain reads built a crypto body; a newer write lands before the
      // locked settle. the settle re-reads the nonprofit, so the newer write
      // is in the body, and the revision is the one stored with that body
      const { db, seen } = watched(() =>
        t.db
          .update(npos)
          .set({ donate_methods: ["stripe", "daf"] })
          .where(eq(npos.id, npo_id))
      );
      const late = await readiness(db, npo_id);

      expect(seen.transactions).toBe(1);
      expect(late.rails.daf.offered).toBe(true);
      expect(late.rails.crypto.offered).toBe(false);
      expect(late.revision).toBe(2);
      const { row } = await stored(npo_id);
      expect(pair_of(late)).toEqual({
        revision: row.revision,
        fingerprint: row.fingerprint,
      });
      // and the next plain read agrees with it
      expect(await read(npo_id)).toEqual(late);
    });

    test("every answer from interleaved reads and writes is a pair that was stored", async () => {
      const npo_id = await seed_tenant({ donate_methods: ["stripe"] });
      const settings: DonateMethodId[][] = [
        ["stripe"],
        ["stripe", "daf"],
        ["stripe", "crypto"],
        ["daf"],
        ["stripe"],
      ];

      const answers: Awaited<ReturnType<typeof read>>[] = [];
      await Promise.all([
        ...settings.map((methods) =>
          t.db
            .update(npos)
            .set({ donate_methods: methods })
            .where(eq(npos.id, npo_id))
        ),
        ...settings.map(async () => {
          answers.push(await read(npo_id));
        }),
      ]);
      answers.push(await read(npo_id));

      // one hash per revision, never two bodies under one number
      const by_revision = new Map<number, string>();
      for (const a of answers) {
        const { revision, fingerprint } = pair_of(a);
        expect(
          by_revision.get(revision) ?? fingerprint,
          `revision ${revision}`
        ).toBe(fingerprint);
        by_revision.set(revision, fingerprint);
      }
      // the last answer is what is stored
      const { row } = await stored(npo_id);
      expect(pair_of(answers.at(-1)!)).toEqual({
        revision: row.revision,
        fingerprint: row.fingerprint,
      });
    });
  });

  test("a nonprofit with no partner tenant throws, creating nothing", async () => {
    const npo_id = await seed_tenant();
    await t.db.delete(partner_tenants);

    await expect(read(npo_id)).rejects.toThrow(/no partner tenant/);
    expect(await t.db.select().from(partner_tenants)).toEqual([]);
  });
});
