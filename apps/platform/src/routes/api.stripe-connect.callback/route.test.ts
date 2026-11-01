import { eq } from "drizzle-orm";
import Stripe from "stripe";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const routing = vi.hoisted(() => ({ on: true }));
const session = vi.hoisted(() => ({
  user: undefined as
    | { id: string; email: string; role?: string | null }
    | undefined,
}));
const token = vi.hoisted(() => vi.fn());
const retrieve = vi.hoisted(() => vi.fn());
const report_error = vi.hoisted(() => vi.fn());

vi.mock("$/pg/db", () => ({
  db: new Proxy(
    {},
    {
      get(_, prop) {
        const real = test_db.current?.db;
        if (!real) throw new Error("test_db not initialized");
        return (real as any)[prop];
      },
    }
  ),
}));
vi.mock("#/.server/auth", async () => ({
  get_session: vi.fn(async () => ({ user: session.user })),
  consume: (await import("#/.server/auth/rate-limit")).consume,
}));
vi.mock("$/kit/stripe", () => ({
  stripe: { oauth: { token }, accounts: { retrieve } },
}));
vi.mock("#/errors/report", () => ({ report_error }));
vi.mock("$/env", async (importOriginal) => {
  const env = await importOriginal<typeof import("$/env")>();
  return {
    ...env,
    stripe: {
      ...env.stripe,
      get connect_routing() {
        return routing.on;
      },
    },
  };
});

const { loader } = await import("./route");
const { sign_state } = await import("$/stripe-connect/state");
const { seed_npo, seed_user } = await import("#/__tests__/fixtures/funds");
const { npos } = await import("$/pg/schema/npo");
const { user_npo_memberships } = await import("$/pg/schema/user");
const { registrations } = await import("$/pg/schema/registration");
const { is_routable, routing_npo } = await import(
  "@/stripe-connect/eligibility"
);

const db = () => test_db.current!.db;

const member_of_npo = async (tag: string, acct?: string) => {
  const u = await seed_user(db(), `${tag}@npo.test`);
  const npo = await seed_npo(db(), {
    registration_number: `EIN-${tag}`,
    stripe_account_id: acct,
  });
  await db()
    .insert(user_npo_memberships)
    .values({ user_id: u!.id, npo_id: npo!.id });
  session.user = { id: u!.id, email: u!.email, role: "user" };
  return { user: u!, npo: npo! };
};

const own_reg = async (
  email: string,
  o: { o_stripe_account_id?: string; status?: "01" | "02" | "03" | "04" } = {}
) => {
  const id = crypto.randomUUID();
  await db()
    .insert(registrations)
    .values({ id, r_id: email, status: "01", ...o });
  session.user = { id: `uid-${email}`, email, role: "user" };
  return id;
};

const reg_acct = async (id: string) => {
  const [r] = await db()
    .select({ acct: registrations.o_stripe_account_id })
    .from(registrations)
    .where(eq(registrations.id, id));
  return r!.acct;
};

const npo_row = async (id: number) => {
  const [r] = await db().select().from(npos).where(eq(npos.id, id));
  return r!;
};

const call = async (q: Record<string, string>) =>
  (await (loader as any)({
    ...doc_args(
      new Request(
        `https://app.test/api/stripe-connect/callback?${new URLSearchParams(q)}`
      )
    ),
    params: {},
    context: {},
  })) as Response;

const landed = (res: Response) => {
  expect(res.status).toBe(302);
  const to = new URL(res.headers.get("location")!, "https://app.test");
  return {
    path: to.pathname,
    result: to.searchParams.get("stripe_connect"),
    reason: to.searchParams.get("stripe_connect_reason"),
  };
};

const account = (id: string) => ({
  id,
  object: "account",
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  requirements: { currently_due: [] },
});

beforeAll(async () => {
  const { create_test_db } = await import("$/pg/test-utils/pglite");
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(() => {
  routing.on = true;
  session.user = undefined;
  token.mockReset();
  retrieve.mockReset();
  report_error.mockReset();
  retrieve.mockImplementation(async (id: string) => account(id));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("stripe connect callback", () => {
  test("refuses while routing is off, storing nothing", async () => {
    routing.on = false;
    const { user, npo } = await member_of_npo("cb-off");
    token.mockResolvedValue({ stripe_user_id: "acct_should_not" });
    const state = sign_state({
      t: { kind: "npo", npo_id: npo.id },
      uid: user.id,
      replace: false,
    });

    const res = await call({ code: "ac_off", state });

    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
    expect(token).not.toHaveBeenCalled();
    expect((await npo_row(npo.id)).stripe_account_id).toBeNull();
  });

  test("an npo member's connect stores the account and fills its readiness", async () => {
    const { user, npo } = await member_of_npo("cb-npo-ok");
    token.mockResolvedValue({
      stripe_user_id: "acct_cb_npo_ok",
      access_token: "sk_test_never_stored",
      refresh_token: "rt_never_stored",
    });
    const state = sign_state({
      t: { kind: "npo", npo_id: npo.id },
      uid: user.id,
      replace: false,
    });

    const res = await call({ code: "ac_ok", state });

    expect(landed(res)).toEqual({
      path: `/admin/${npo.id}/banking`,
      result: "connected",
      reason: null,
    });
    expect(token).toHaveBeenCalledWith({
      grant_type: "authorization_code",
      code: "ac_ok",
    });
    const r = await npo_row(npo.id);
    expect(r.stripe_account_id).toBe("acct_cb_npo_ok");
    expect(r.stripe_charges_enabled).toBe(true);
    expect(r.stripe_payouts_enabled).toBe(true);
    expect(r.stripe_details_submitted).toBe(true);
    expect(r.stripe_synced_at).not.toBeNull();
  });

  test("an applicant's connect stores the account on the registration", async () => {
    const reg_id = await own_reg("cb-reg-ok@reg.test");
    token.mockResolvedValue({ stripe_user_id: "acct_cb_reg_ok" });
    const state = sign_state({
      t: { kind: "reg", reg_id },
      uid: session.user!.id,
      replace: false,
    });

    const res = await call({ code: "ac_reg", state });

    expect(landed(res)).toEqual({
      path: `/register/${reg_id}/4`,
      result: "connected",
      reason: null,
    });
    expect(await reg_acct(reg_id)).toBe("acct_cb_reg_ok");
    const [saved] = await db()
      .select({ at: registrations.o_stripe_connected_at })
      .from(registrations)
      .where(eq(registrations.id, reg_id));
    expect(saved!.at).not.toBeNull();
  });

  describe("refuses, storing nothing", () => {
    const npo_state = (npo_id: number, uid: string, replace = false) =>
      sign_state({ t: { kind: "npo", npo_id }, uid, replace });

    test("a state whose signature doesn't verify", async () => {
      const { user, npo } = await member_of_npo("cb-forged");
      const [body, sig] = npo_state(npo.id, user.id).split(".");
      const flipped = `${sig!.startsWith("A") ? "B" : "A"}${sig!.slice(1)}`;

      const res = await call({
        code: "ac_forged",
        state: `${body}.${flipped}`,
      });

      expect(res.status).toBe(400);
      expect(token).not.toHaveBeenCalled();
      expect((await npo_row(npo.id)).stripe_account_id).toBeNull();
    });

    test("a signed state re-pointed at another npo", async () => {
      const { user, npo } = await member_of_npo("cb-repoint");
      const victim = await seed_npo(db(), {
        registration_number: "EIN-victim",
      });
      const [body, sig] = npo_state(npo.id, user.id).split(".");
      const payload = JSON.parse(Buffer.from(body!, "base64url").toString());
      payload.t.npo_id = victim!.id;
      const forged = Buffer.from(JSON.stringify(payload)).toString("base64url");

      const res = await call({ code: "ac_x", state: `${forged}.${sig}` });

      expect(res.status).toBe(400);
      expect(token).not.toHaveBeenCalled();
      expect((await npo_row(victim!.id)).stripe_account_id).toBeNull();
    });

    test("a state older than fifteen minutes", async () => {
      const { user, npo } = await member_of_npo("cb-expired");
      vi.useFakeTimers({
        toFake: ["Date"],
        now: Date.parse("2026-10-12T12:00:00Z"),
      });
      const state = npo_state(npo.id, user.id);
      vi.setSystemTime(Date.parse("2026-10-12T12:15:01Z"));

      const res = await call({ code: "ac_late", state });

      expect(landed(res)).toEqual({
        path: `/admin/${npo.id}/banking`,
        result: "error",
        reason: "expired",
      });
      expect(token).not.toHaveBeenCalled();
      expect((await npo_row(npo.id)).stripe_account_id).toBeNull();
    });

    // both are members: the state binds the flow to whoever started it
    test("a different signed-in user than the one who started", async () => {
      const { user: starter, npo } = await member_of_npo("cb-starter");
      const other = await seed_user(db(), "cb-other@npo.test");
      await db()
        .insert(user_npo_memberships)
        .values({ user_id: other!.id, npo_id: npo.id });
      const state = npo_state(npo.id, starter.id);
      session.user = { id: other!.id, email: other!.email, role: "user" };

      const res = await call({ code: "ac_other", state });

      expect(landed(res).reason).toBe("forbidden");
      expect(token).not.toHaveBeenCalled();
      expect((await npo_row(npo.id)).stripe_account_id).toBeNull();
    });

    test("no session at all", async () => {
      const { user, npo } = await member_of_npo("cb-nosession");
      const state = npo_state(npo.id, user.id);
      session.user = undefined;

      const res = await call({ code: "ac_nosess", state });

      expect(landed(res).reason).toBe("forbidden");
      expect(token).not.toHaveBeenCalled();
    });

    test("a starter no longer allowed on the npo", async () => {
      const { user, npo } = await member_of_npo("cb-removed");
      const state = npo_state(npo.id, user.id);
      await db()
        .delete(user_npo_memberships)
        .where(eq(user_npo_memberships.user_id, user.id));

      const res = await call({ code: "ac_removed", state });

      expect(landed(res).reason).toBe("forbidden");
      expect(token).not.toHaveBeenCalled();
      expect((await npo_row(npo.id)).stripe_account_id).toBeNull();
    });

    test("a registration submitted since the connect started", async () => {
      const reg_id = await own_reg("cb-submitted@reg.test");
      const state = sign_state({
        t: { kind: "reg", reg_id },
        uid: session.user!.id,
        replace: false,
      });
      await db()
        .update(registrations)
        .set({ status: "02" })
        .where(eq(registrations.id, reg_id));
      token.mockResolvedValue({ stripe_user_id: "acct_after_submit" });

      const res = await call({ code: "ac_submitted", state });

      expect(landed(res).reason).toBe("forbidden");
      expect(token).not.toHaveBeenCalled();
      expect(await reg_acct(reg_id)).toBeNull();
    });

    test("the user declining on stripe goes back as denied", async () => {
      const { user, npo } = await member_of_npo("cb-denied");

      const res = await call({
        error: "access_denied",
        error_description: "The user denied your request",
        state: npo_state(npo.id, user.id),
      });

      expect(landed(res)).toEqual({
        path: `/admin/${npo.id}/banking`,
        result: "denied",
        reason: null,
      });
      expect(token).not.toHaveBeenCalled();
    });

    test("an npo holding an account, with no confirmed replace", async () => {
      const { user, npo } = await member_of_npo("cb-held", "acct_held_before");
      token.mockResolvedValue({ stripe_user_id: "acct_held_after" });

      const res = await call({
        code: "ac_held",
        state: npo_state(npo.id, user.id),
      });

      expect(landed(res).reason).toBe("replace_unconfirmed");
      expect(token).not.toHaveBeenCalled();
      expect((await npo_row(npo.id)).stripe_account_id).toBe(
        "acct_held_before"
      );
    });

    test("an account already linked to another npo", async () => {
      await seed_npo(db(), {
        registration_number: "EIN-cb-owner",
        stripe_account_id: "acct_taken",
      });
      const { user, npo } = await member_of_npo("cb-taker");
      token.mockResolvedValue({ stripe_user_id: "acct_taken" });

      const res = await call({
        code: "ac_taken",
        state: npo_state(npo.id, user.id),
      });

      expect(landed(res).reason).toBe("already_linked");
      expect((await npo_row(npo.id)).stripe_account_id).toBeNull();
    });

    test("an account another pending registration holds", async () => {
      await own_reg("cb-first@reg.test", {
        o_stripe_account_id: "acct_pending",
      });
      const reg_id = await own_reg("cb-second@reg.test");
      token.mockResolvedValue({ stripe_user_id: "acct_pending" });
      const state = sign_state({
        t: { kind: "reg", reg_id },
        uid: session.user!.id,
        replace: false,
      });

      const res = await call({ code: "ac_pending", state });

      expect(landed(res).reason).toBe("already_linked");
      expect(await reg_acct(reg_id)).toBeNull();
    });

    test("an account a nonprofit already holds, connected from a registration", async () => {
      await seed_npo(db(), {
        registration_number: "EIN-cb-npo-holds",
        stripe_account_id: "acct_npo_holds",
      });
      const reg_id = await own_reg("cb-reg-vs-npo@reg.test");
      token.mockResolvedValue({ stripe_user_id: "acct_npo_holds" });
      const state = sign_state({
        t: { kind: "reg", reg_id },
        uid: session.user!.id,
        replace: false,
      });

      const res = await call({ code: "ac_npo_holds", state });

      expect(landed(res).reason).toBe("already_linked");
      expect(await reg_acct(reg_id)).toBeNull();
    });

    // a second exchange of one code revokes the connection at stripe; a
    // sequential replay already meets the stored account, a double request doesn't
    test("one state arriving twice at once is exchanged once", async () => {
      const { user, npo } = await member_of_npo("cb-replay");
      token.mockResolvedValue({ stripe_user_id: "acct_replay" });
      const state = npo_state(npo.id, user.id);

      const results = await Promise.all([
        call({ code: "ac_replay", state }),
        call({ code: "ac_replay", state }),
      ]);

      expect(results.map((r) => landed(r).result).sort()).toEqual([
        "connected",
        "error",
      ]);
      expect(token).toHaveBeenCalledOnce();
    });

    test("a code stripe refuses is reported without the code", async () => {
      const { user, npo } = await member_of_npo("cb-badcode");
      token.mockRejectedValue(
        new Stripe.errors.StripeInvalidGrantError({
          type: "invalid_grant",
          message: "Authorization code does not exist: ac_secret_code",
        })
      );

      const res = await call({
        code: "ac_secret_code",
        state: npo_state(npo.id, user.id),
      });

      expect(landed(res).reason).toBe("failed");
      expect(report_error).toHaveBeenCalledOnce();
      expect(
        JSON.stringify(String(report_error.mock.calls[0]![0]))
      ).not.toContain("ac_secret_code");
      expect((await npo_row(npo.id)).stripe_account_id).toBeNull();
    });
  });

  // the account is read before the exchange and written after it, so a second
  // tab can land between the two
  describe("a connect landing between another's read and write", () => {
    test("an npo whose account was set meanwhile keeps it", async () => {
      const { user, npo } = await member_of_npo("cb-race-npo");
      token.mockImplementation(async () => {
        await db()
          .update(npos)
          .set({ stripe_account_id: "acct_race_npo_first" })
          .where(eq(npos.id, npo.id));
        return { stripe_user_id: "acct_race_npo_second" };
      });

      const res = await call({
        code: "ac_race_npo",
        state: sign_state({
          t: { kind: "npo", npo_id: npo.id },
          uid: user.id,
          replace: false,
        }),
      });

      expect(landed(res).reason).toBe("replace_unconfirmed");
      expect((await npo_row(npo.id)).stripe_account_id).toBe(
        "acct_race_npo_first"
      );
    });

    test("a confirmed replace of an account changed meanwhile is refused", async () => {
      const { user, npo } = await member_of_npo("cb-race-repl", "acct_rr_old");
      token.mockImplementation(async () => {
        await db()
          .update(npos)
          .set({ stripe_account_id: "acct_rr_other_tab" })
          .where(eq(npos.id, npo.id));
        return { stripe_user_id: "acct_rr_new" };
      });

      const res = await call({
        code: "ac_race_repl",
        state: sign_state({
          t: { kind: "npo", npo_id: npo.id },
          uid: user.id,
          replace: true,
        }),
      });

      expect(landed(res).reason).toBe("replace_unconfirmed");
      expect((await npo_row(npo.id)).stripe_account_id).toBe(
        "acct_rr_other_tab"
      );
    });

    test("a registration whose account was set meanwhile keeps it", async () => {
      const reg_id = await own_reg("cb-race-reg@reg.test");
      token.mockImplementation(async () => {
        await db()
          .update(registrations)
          .set({ o_stripe_account_id: "acct_race_reg_first" })
          .where(eq(registrations.id, reg_id));
        return { stripe_user_id: "acct_race_reg_second" };
      });

      const res = await call({
        code: "ac_race_reg",
        state: sign_state({
          t: { kind: "reg", reg_id },
          uid: session.user!.id,
          replace: false,
        }),
      });

      expect(landed(res).reason).toBe("replace_unconfirmed");
      expect(await reg_acct(reg_id)).toBe("acct_race_reg_first");
    });

    test("a registration submitted during the exchange stores nothing", async () => {
      const reg_id = await own_reg("cb-race-submit@reg.test");
      token.mockImplementation(async () => {
        await db()
          .update(registrations)
          .set({ status: "02" })
          .where(eq(registrations.id, reg_id));
        return { stripe_user_id: "acct_race_submit" };
      });

      const res = await call({
        code: "ac_race_submit",
        state: sign_state({
          t: { kind: "reg", reg_id },
          uid: session.user!.id,
          replace: false,
        }),
      });

      expect(landed(res).reason).toBe("forbidden");
      expect(await reg_acct(reg_id)).toBeNull();
    });
  });

  // registrations carry no unique index: only the claim's lock keeps two
  // targets from both passing the held-elsewhere check
  describe("one account connected to two targets at once", () => {
    const as_admin = async (tag: string) => {
      const u = await seed_user(db(), `${tag}@admin.test`);
      session.user = { id: u!.id, email: u!.email, role: "admin" };
      return u!.id;
    };
    const reg_of = async (email: string) => {
      const id = crypto.randomUUID();
      await db()
        .insert(registrations)
        .values({ id, r_id: email, status: "01" });
      return id;
    };

    test("two registrations: one gets it", async () => {
      const a = await reg_of("cb-dup-a@reg.test");
      const b = await reg_of("cb-dup-b@reg.test");
      const uid = await as_admin("cb-dup-regs");
      token.mockResolvedValue({ stripe_user_id: "acct_dup_regs" });

      const results = await Promise.all(
        [a, b].map((reg_id, i) =>
          call({
            code: `ac_dup_regs_${i}`,
            state: sign_state({
              t: { kind: "reg", reg_id },
              uid,
              replace: false,
            }),
          })
        )
      );

      expect(results.map((r) => landed(r).reason).sort()).toEqual([
        "already_linked",
        null,
      ]);
      const held = [await reg_acct(a), await reg_acct(b)];
      expect(held.filter((x) => x === "acct_dup_regs")).toHaveLength(1);
    });

    test("a registration and an npo: one gets it", async () => {
      const reg_id = await reg_of("cb-dup-mixed@reg.test");
      const npo = await seed_npo(db(), {
        registration_number: "EIN-cb-dup-mixed",
      });
      const uid = await as_admin("cb-dup-mixed");
      token.mockResolvedValue({ stripe_user_id: "acct_dup_mixed" });

      const results = await Promise.all([
        call({
          code: "ac_dup_mixed_reg",
          state: sign_state({
            t: { kind: "reg", reg_id },
            uid,
            replace: false,
          }),
        }),
        call({
          code: "ac_dup_mixed_npo",
          state: sign_state({
            t: { kind: "npo", npo_id: npo!.id },
            uid,
            replace: false,
          }),
        }),
      ]);

      expect(results.map((r) => landed(r).reason).sort()).toEqual([
        "already_linked",
        null,
      ]);
      const held = [
        await reg_acct(reg_id),
        (await npo_row(npo!.id)).stripe_account_id,
      ];
      expect(held.filter((x) => x === "acct_dup_mixed")).toHaveLength(1);
    });
  });

  test("a confirmed replace swaps the account and re-reads readiness", async () => {
    const { user, npo } = await member_of_npo("cb-replace", "acct_replace_old");
    token.mockResolvedValue({ stripe_user_id: "acct_replace_new" });
    retrieve.mockResolvedValue({
      ...account("acct_replace_new"),
      charges_enabled: false,
      details_submitted: false,
    });

    const res = await call({
      code: "ac_replace",
      state: sign_state({
        t: { kind: "npo", npo_id: npo.id },
        uid: user.id,
        replace: true,
      }),
    });

    expect(landed(res).result).toBe("connected");
    const r = await npo_row(npo.id);
    expect(r.stripe_account_id).toBe("acct_replace_new");
    expect(retrieve).toHaveBeenCalledWith("acct_replace_new");
    expect(r.stripe_charges_enabled).toBe(false);
  });

  test("a replace whose readiness read fails reads as not ready yet", async () => {
    const { user, npo } = await member_of_npo(
      "cb-replace-sync-fails",
      "acct_ready_old"
    );
    await db()
      .update(npos)
      .set({
        stripe_charges_enabled: true,
        stripe_payouts_enabled: true,
        stripe_details_submitted: true,
      })
      .where(eq(npos.id, npo.id));
    token.mockResolvedValue({ stripe_user_id: "acct_unread_new" });
    const err = new Stripe.errors.StripeAPIError({ message: "stripe is down" });
    retrieve.mockRejectedValue(err);

    const res = await call({
      code: "ac_unread",
      state: sign_state({
        t: { kind: "npo", npo_id: npo.id },
        uid: user.id,
        replace: true,
      }),
    });

    expect(landed(res).result).toBe("connected");
    expect(report_error).toHaveBeenCalledWith(err);
    const r = await npo_row(npo.id);
    expect(r.stripe_account_id).toBe("acct_unread_new");
    expect(r.stripe_charges_enabled).toBe(false);
    expect(r.stripe_payouts_enabled).toBe(false);
    expect(r.stripe_details_submitted).toBe(false);
  });

  describe("a nonprofit reconnecting after it disconnected us", () => {
    const disconnected_npo = async (tag: string) => {
      const m = await member_of_npo(tag, `acct_${tag}_old`);
      await db()
        .update(npos)
        .set({
          hq_country: "United States",
          stripe_deauthorized_at: "2026-10-01T00:00:00.000Z",
        })
        .where(eq(npos.id, m.npo.id));
      return m;
    };

    test.each([
      ["a new account", "new"],
      ["the account it disconnected", "old"],
    ])("connects %s unasked and routes again", async (_case, which) => {
      const tag = `cb-reconnect-${which}`;
      const { user, npo } = await disconnected_npo(tag);
      token.mockResolvedValue({ stripe_user_id: `acct_${tag}_${which}` });

      const res = await call({
        code: `ac_${tag}`,
        state: sign_state({
          t: { kind: "npo", npo_id: npo.id },
          uid: user.id,
          replace: false,
        }),
      });

      expect(landed(res).result).toBe("connected");
      const r = await npo_row(npo.id);
      expect(r.stripe_account_id).toBe(`acct_${tag}_${which}`);
      expect(r.stripe_deauthorized_at).toBeNull();
      expect(is_routable(routing_npo(r), true)).toBe(true);
    });
  });

  // its account was copied onto the npo at approval, and may have moved since
  test("an approved registration's account doesn't block its nonprofit", async () => {
    await own_reg("cb-approved@reg.test", {
      o_stripe_account_id: "acct_from_approval",
      status: "03",
    });
    const { user, npo } = await member_of_npo("cb-approved-npo");
    token.mockResolvedValue({ stripe_user_id: "acct_from_approval" });

    const res = await call({
      code: "ac_approved",
      state: sign_state({
        t: { kind: "npo", npo_id: npo.id },
        uid: user.id,
        replace: false,
      }),
    });

    expect(landed(res).result).toBe("connected");
    expect((await npo_row(npo.id)).stripe_account_id).toBe(
      "acct_from_approval"
    );
  });
});
