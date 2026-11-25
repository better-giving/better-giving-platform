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

const { npos } = await import("../pg/schema/npo");
const { user } = await import("../pg/schema/auth");
const { partner_keys, partner_tenants } = await import("../pg/schema/partner");
const { create_test_db } = await import("../pg/test-utils/pglite");
const { mint_key } = await import("./keys");
const { readiness } = await import("./readiness");
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
  nowpayments.api_key = real_np_key;
  await t.db.delete(partner_keys);
  await t.db.delete(partner_tenants);
  await t.db.delete(npos);
  await t.db.delete(user);
});

const seed_tenant = async (
  over: Parameters<typeof seed_npo>[1] = {}
): Promise<number> => {
  const staff = (await seed_user(t.db, "ada@test.com"))!;
  const npo = (await seed_npo(t.db, over))!;
  await mint_key(as_db(t.db), { npo_id: npo.id, minted_by: staff.id });
  return npo.id;
};

const read = (npo_id: number) => readiness(as_db(t.db), npo_id);

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
    f === "monthly" ? ["monthly"] : f === "annual" ? ["yearly"] : []
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

  test("a nonprofit with no partner tenant throws, creating nothing", async () => {
    const npo_id = await seed_tenant();
    await t.db.delete(partner_tenants);

    await expect(read(npo_id)).rejects.toThrow(/no partner tenant/);
    expect(await t.db.select().from(partner_tenants)).toEqual([]);
  });
});
