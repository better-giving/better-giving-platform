import { eq } from "drizzle-orm";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { reset_rate_limits } from "#/.server/auth/rate-limit";
import { seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import { exchange_code, issue_code } from "$/connector/keys";
import type { DbOrTx } from "$/pg/queries/helpers";
import { user } from "$/pg/schema/auth";
import { campaign_members, campaigns } from "$/pg/schema/campaign";
import {
  connector_codes,
  connector_idempotency,
  connector_keys,
} from "$/pg/schema/connector";
import { npos } from "$/pg/schema/npo";
import { programs } from "$/pg/schema/program";
import { user_npo_memberships } from "$/pg/schema/user";
import type { TestDb } from "$/pg/test-utils/pglite";
import { create_test_db } from "$/pg/test-utils/pglite";
import { loader as campaign_loader } from "./connector.v1.campaigns.$id";
import { action as blocks_action } from "./connector.v1.campaigns.$id.blocks";
import { action as end_action } from "./connector.v1.campaigns.$id.end";
import { action as publish_action } from "./connector.v1.campaigns.$id.publish";
import { action as settings_action } from "./connector.v1.campaigns.$id.settings";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
vi.mock("$/pg/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (test_db.current!.db as any)[prop];
    },
  }),
}));

// a write landing between the connector's read of the campaign and its own
// write; one-shot, fired after the first campaign_get resolves
const between = vi.hoisted(() => ({
  write: null as (() => Promise<void>) | null,
}));
vi.mock("$/pg/queries/campaign", async (load) => {
  const real = await load<typeof import("$/pg/queries/campaign")>();
  return {
    ...real,
    campaign_get: async (...args: Parameters<typeof real.campaign_get>) => {
      const row = await real.campaign_get(...args);
      const write = between.write;
      between.write = null;
      await write?.();
      return row;
    },
  };
});

const db = () => test_db.current!.db;
const as_db = (x: unknown) => x as DbOrTx;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  between.write = null;
  reset_rate_limits();
  await db().delete(campaign_members);
  await db().delete(campaigns);
  await db().delete(programs);
  await db().delete(connector_idempotency);
  await db().delete(connector_keys);
  await db().delete(connector_codes);
  await db().delete(user_npo_memberships);
  await db().delete(npos);
  await db().delete(user);
});

type Handler = (
  args: ActionFunctionArgs & LoaderFunctionArgs
) => Promise<Response> | Response;

/** `body` undefined sends no body at all */
const send = (
  handler: Handler,
  method: "GET" | "POST" | "PATCH",
  id: string,
  path: string,
  key: string | undefined,
  body?: unknown
) => {
  const headers = new Headers({ "content-type": "application/json" });
  if (key) headers.set("authorization", `Bearer ${key}`);
  const request = new Request(
    `https://bg.test/connector/v1/campaigns/${id}${path}`,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }
  );
  return handler({
    request,
    params: { id },
    context: {},
    url: new URL(request.url),
    pattern: `/connector/v1/campaigns/:id${path}`,
  } as unknown as ActionFunctionArgs & LoaderFunctionArgs) as Promise<Response>;
};

const read = (id: string, key: string) =>
  send(campaign_loader as Handler, "GET", id, "", key);

async function mint(npo_id: number, user_id: string) {
  const issued = await issue_code(as_db(db()), {
    npo_id,
    allowed_by: user_id,
    iss: "https://zap.example",
  });
  const exchanged = await exchange_code(as_db(db()), issued.code);
  if (!exchanged.ok) throw new Error("exchange failed");
  return exchanged.key;
}

async function pair(name: string, ein: string, email: string) {
  const npo = (await seed_npo(db(), { name, registration_number: ein }))!;
  const owner = (await seed_user(db(), email, name, "Owner"))!;
  await db()
    .insert(user_npo_memberships)
    .values({ user_id: owner.id, npo_id: npo.id });
  const key = await mint(npo.id, owner.id);
  return { npo, owner, key };
}

async function seed_campaign(
  owner: { npo: { id: number }; owner: { id: string } },
  vals: {
    id?: string;
    status?: "draft" | "live" | "ended";
    ends_at?: string | null;
    target_number?: number | null;
    target_smart?: boolean | null;
    banner?: string | null;
    description_pt?: string;
    published_at?: string | null;
    program_id?: string | null;
    program_name?: string | null;
  } = {}
) {
  const id = vals.id ?? crypto.randomUUID();
  await db()
    .insert(campaigns)
    .values({
      id,
      owner_npo_id: owner.npo.id,
      creator_id: owner.owner.id,
      name: "Library drive",
      slug: `library-drive-${id.slice(0, 8)}`,
      description_pt: vals.description_pt ?? "[]",
      banner: vals.banner ?? null,
      status: vals.status ?? "draft",
      ends_at: vals.ends_at ?? null,
      target_number: vals.target_number ?? null,
      target_smart: vals.target_smart ?? null,
      published_at: vals.published_at ?? null,
      program_id: vals.program_id ?? null,
      program_name: vals.program_name ?? null,
    });
  await db()
    .insert(campaign_members)
    .values({ campaign_id: id, npo_id: owner.npo.id, position: 0 });
  return id;
}

async function seed_program(npo_id: number, title: string) {
  const id = crypto.randomUUID();
  await db()
    .insert(programs)
    .values({ id, npo_id, title, description_pt: "[]" });
  return id;
}

const row_of = async (id: string) => {
  const [row] = await db().select().from(campaigns).where(eq(campaigns.id, id));
  return row!;
};

describe("end_campaign", () => {
  test("ends the campaign, and a second call is 200 with the same detail", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a, {
      status: "live",
      published_at: "2026-01-01T00:00:00.000Z",
    });

    const ended = await send(end_action, "POST", id, "/end", a.key, {});
    expect(ended.status).toBe(200);
    const body = (await ended.json()) as { id: string; status: string };
    expect(body).toMatchObject({ id, status: "ended" });
    expect((await row_of(id)).status).toBe("ended");
    const before = await row_of(id);

    const again = await send(end_action, "POST", id, "/end", a.key);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ id, status: "ended" });
    expect(await row_of(id)).toEqual(before);
  });

  test("refuses a body with fields, and another org's campaign is 404", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const b = await pair("Beta", "EIN-B", "b@test.com");
    const id = await seed_campaign(a, { status: "live" });

    const extra = await send(end_action, "POST", id, "/end", a.key, {
      confirm: true,
    });
    expect(extra.status).toBe(422);
    expect(await extra.json()).toMatchObject({
      code: "invalid",
      errors: [{ path: "confirm", message: "is not a field on this action" }],
    });

    const foreign = await send(end_action, "POST", id, "/end", b.key, {});
    const unknown = await send(
      end_action,
      "POST",
      crypto.randomUUID(),
      "/end",
      b.key,
      {}
    );
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    const [f, u] = (await Promise.all([foreign.json(), unknown.json()])) as {
      code: string;
      detail: string;
    }[];
    expect(f!.code).toBe("not_found");
    expect(u!.code).toBe("not_found");
    expect(f!.detail.replace(id, "")).toBe(
      u!.detail.replace(/[0-9a-f-]{36}/, "")
    );
    expect((await row_of(id)).status).toBe("live");

    const keyless = await send(end_action, "POST", id, "/end", undefined, {});
    expect(keyless.status).toBe(401);
    expect((await row_of(id)).status).toBe("live");
  });

  test("the wrong method is unknown_action", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a);
    const { loader } = await import("./connector.v1.campaigns.$id.end");
    const res = await send(loader as Handler, "GET", id, "/end", a.key);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "unknown_action" });
  });
});

describe("publish_campaign", () => {
  const publish = (id: string, key: string | undefined, body?: unknown) =>
    send(publish_action, "POST", id, "/publish", key, body);

  test("the first publish requires gifts_go_to, and a program id sends gifts there", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const program = await seed_program(a.npo.id, "Literacy");
    const id = await seed_campaign(a);

    const bare = await publish(id, a.key, {});
    expect(bare.status).toBe(422);
    expect(await bare.json()).toMatchObject({
      code: "invalid",
      errors: [
        {
          path: "gifts_go_to",
          message:
            "is required on the first publish: a program id, or null for the general fund",
        },
      ],
    });
    expect((await row_of(id)).status).toBe("draft");

    const live = await publish(id, a.key, { gifts_go_to: program });
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ id, status: "published" });
    const row = await row_of(id);
    expect(row).toMatchObject({
      status: "live",
      program_id: program,
      program_name: "Literacy",
    });
    expect(row.published_at).not.toBeNull();
  });

  test("null on the first publish is the general fund", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a, {
      program_id: await seed_program(a.npo.id, "Stale pick"),
      program_name: "Stale pick",
    });
    const live = await publish(id, a.key, { gifts_go_to: null });
    expect(live.status).toBe(200);
    expect(await row_of(id)).toMatchObject({
      status: "live",
      program_id: null,
      program_name: null,
    });
  });

  test("another org's program, an unknown one, or a stray field is 422 and writes nothing", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const b = await pair("Beta", "EIN-B", "b@test.com");
    const theirs = await seed_program(b.npo.id, "Beta program");
    const id = await seed_campaign(a);

    for (const gifts_go_to of [theirs, crypto.randomUUID(), 7]) {
      const res = await publish(id, a.key, { gifts_go_to });
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        errors: [{ path: "gifts_go_to" }],
      });
    }
    const stray = await publish(id, a.key, { gifts_go_to: null, when: "now" });
    expect(stray.status).toBe(422);
    expect(await stray.json()).toMatchObject({
      errors: [{ path: "when", message: "is not a field on this action" }],
    });
    expect(await row_of(id)).toMatchObject({
      status: "draft",
      program_id: null,
      published_at: null,
    });
  });

  test("already published: absent or the same destination is 200 and writes nothing, another is 409", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const program = await seed_program(a.npo.id, "Literacy");
    const other = await seed_program(a.npo.id, "Meals");
    const id = await seed_campaign(a, {
      status: "live",
      published_at: "2026-01-01T00:00:00.000Z",
      program_id: program,
      program_name: "Literacy",
    });
    const before = await row_of(id);

    for (const body of [{}, { gifts_go_to: program }, undefined]) {
      const res = await publish(id, a.key, body);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ id, status: "published" });
    }
    expect(await row_of(id)).toEqual(before);

    for (const gifts_go_to of [other, null]) {
      const moved = await publish(id, a.key, { gifts_go_to });
      expect(moved.status).toBe(409);
      expect(await moved.json()).toMatchObject({
        code: "already_published",
        status: 409,
        detail: expect.stringContaining("dashboard"),
      });
    }
    expect(await row_of(id)).toEqual(before);
  });

  test("published from the dashboard after the connector's read: another program is 409 and the live destination stays", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const theirs = await seed_program(a.npo.id, "Literacy");
    const mine = await seed_program(a.npo.id, "Meals");
    const id = await seed_campaign(a);
    between.write = async () => {
      await db()
        .update(campaigns)
        .set({
          status: "live",
          published_at: "2026-01-01T00:00:00.000Z",
          program_id: theirs,
          program_name: "Literacy",
        })
        .where(eq(campaigns.id, id));
    };
    const res = await publish(id, a.key, { gifts_go_to: mine });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "already_published" });
    expect(await row_of(id)).toMatchObject({
      status: "live",
      published_at: "2026-01-01T00:00:00.000Z",
      program_id: theirs,
      program_name: "Literacy",
    });
  });

  test("published from the dashboard after the connector's read to the same program is the unchanged detail", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const program = await seed_program(a.npo.id, "Literacy");
    const id = await seed_campaign(a);
    between.write = async () => {
      await db()
        .update(campaigns)
        .set({
          status: "live",
          published_at: "2026-01-01T00:00:00.000Z",
          program_id: program,
          program_name: "Literacy",
        })
        .where(eq(campaigns.id, id));
    };
    const res = await publish(id, a.key, { gifts_go_to: program });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, status: "published" });
    expect(await row_of(id)).toMatchObject({
      status: "live",
      published_at: "2026-01-01T00:00:00.000Z",
      program_id: program,
    });
  });

  test("ended after the connector's read: 409 campaign_ended, and neither program nor status moves", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const program = await seed_program(a.npo.id, "Literacy");
    const id = await seed_campaign(a);
    between.write = async () => {
      await db()
        .update(campaigns)
        .set({ status: "ended" })
        .where(eq(campaigns.id, id));
    };

    const res = await publish(id, a.key, { gifts_go_to: program });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "campaign_ended" });
    expect(await row_of(id)).toMatchObject({
      status: "ended",
      program_id: null,
      program_name: null,
      published_at: null,
    });
  });

  test("deleted after the connector's read: 404, and nothing is recreated", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a);
    between.write = async () => {
      await db()
        .delete(campaign_members)
        .where(eq(campaign_members.campaign_id, id));
      await db().delete(campaigns).where(eq(campaigns.id, id));
    };

    const res = await publish(id, a.key, { gifts_go_to: null });
    expect(res.status).toBe(404);
    expect(
      await db().select().from(campaigns).where(eq(campaigns.id, id))
    ).toHaveLength(0);
  });

  test("an ended campaign is 409 campaign_ended", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a, {
      status: "ended",
      published_at: "2026-01-01T00:00:00.000Z",
    });
    const res = await publish(id, a.key, { gifts_go_to: null });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "campaign_ended" });
    expect((await row_of(id)).status).toBe("ended");
  });

  test("another org's campaign is 404 and a missing key is 401", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const b = await pair("Beta", "EIN-B", "b@test.com");
    const id = await seed_campaign(a);
    const foreign = await publish(id, b.key, { gifts_go_to: null });
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toMatchObject({ code: "not_found" });
    expect((await publish(id, undefined, { gifts_go_to: null })).status).toBe(
      401
    );
    expect((await publish(id, "bgk_nope", { gifts_go_to: null })).status).toBe(
      401
    );
    expect((await row_of(id)).status).toBe("draft");
  });
});

describe("update_campaign_settings", () => {
  const patch = (id: string, key: string | undefined, body: unknown) =>
    send(settings_action, "PATCH", id, "/settings", key, body);
  const next_year = `${new Date().getUTCFullYear() + 1}-03-15`;

  test("sets the goal and end date, and null clears them", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a);

    const set = await patch(id, a.key, {
      goal: { amount: "2500.5", currency: "USD" },
      end_date: next_year,
    });
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({
      id,
      goal: { amount: "2500.50", currency: "USD" },
      end_date: next_year,
      blocks: expect.arrayContaining([
        { type: "goal-bar", goal: { amount: "2500.50", currency: "USD" } },
      ]),
    });
    expect(await row_of(id)).toMatchObject({
      target_number: 2500.5,
      target_smart: null,
      ends_at: `${next_year}T23:59:59.999Z`,
    });

    const cleared = await patch(id, a.key, { goal: null, end_date: null });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ goal: null, end_date: null });
    expect(await row_of(id)).toMatchObject({
      target_number: null,
      ends_at: null,
    });
  });

  test("a field left out stays, and {} is the unchanged detail", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a, {
      target_number: 900,
      ends_at: `${next_year}T23:59:59.999Z`,
    });
    const before = await row_of(id);

    const empty = await patch(id, a.key, {});
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual(await (await read(id, a.key)).json());
    expect(await row_of(id)).toEqual(before);

    const goal_only = await patch(id, a.key, {
      goal: { amount: "1000", currency: "USD" },
    });
    expect(await goal_only.json()).toMatchObject({
      goal: { amount: "1000.00", currency: "USD" },
      end_date: next_year,
    });
  });

  test("sending back what get_campaign returned writes nothing", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const smart = await seed_campaign(a, { target_smart: true });
    // an admin-set end instant other than end of day still reads as its day
    const timed = await seed_campaign(a, {
      target_number: 1234.5,
      ends_at: `${next_year}T08:30:00.000Z`,
    });
    for (const id of [smart, timed]) {
      const before = await row_of(id);
      const got = (await (await read(id, a.key)).json()) as {
        goal: unknown;
        end_date: unknown;
      };
      const res = await patch(id, a.key, {
        goal: got.goal,
        end_date: got.end_date,
      });
      expect(res.status).toBe(200);
      expect(await row_of(id)).toEqual(before);
    }
  });

  test("time_zone and sharing sent back as get_campaign shows them write nothing", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a, { target_number: 50 });
    const before = await row_of(id);
    const got = (await (await read(id, a.key)).json()) as {
      time_zone: unknown;
      sharing: unknown;
    };

    const res = await patch(id, a.key, {
      time_zone: got.time_zone,
      sharing: got.sharing,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      time_zone: got.time_zone,
      sharing: got.sharing,
    });
    expect(await row_of(id)).toEqual(before);
  });

  test("time_zone and sharing other than as read are refused alongside every other issue", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a, { target_number: 50 });
    const res = await patch(id, a.key, {
      time_zone: "America/New_York",
      sharing: { message: "hi" },
      goal: { amount: "0", currency: "USD" },
      end_date: "2020-01-01",
      color: "red",
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      code: string;
      errors: { path: string; message: string }[];
    };
    expect(body.code).toBe("invalid");
    expect(body.errors).toEqual(
      expect.arrayContaining([
        { path: "time_zone", message: "is not supported on Better Giving" },
        { path: "sharing", message: "is not supported on Better Giving" },
        { path: "color", message: "is not a field on this action" },
        expect.objectContaining({ path: "goal.amount" }),
        expect.objectContaining({ path: "end_date" }),
      ])
    );
    expect(body.errors).toHaveLength(5);
    for (const [key, value] of [
      ["time_zone", "UTC"],
      ["sharing", null],
      ["sharing", { message: null, channels: ["email"] }],
      ["sharing", { message: null }],
    ] as const) {
      const one = await patch(id, a.key, { [key]: value });
      expect(one.status, JSON.stringify(value)).toBe(422);
      expect(await one.json()).toMatchObject({
        errors: [{ path: key, message: "is not supported on Better Giving" }],
      });
    }
    expect((await row_of(id)).target_number).toBe(50);
  });

  test("a goal is a positive USD amount of at most two decimals, and nothing else", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a);
    const bad: [unknown, string][] = [
      [{ amount: "1.234", currency: "USD" }, "goal.amount"],
      [{ amount: "-5", currency: "USD" }, "goal.amount"],
      [{ amount: 50, currency: "USD" }, "goal.amount"],
      [{ amount: "0.00", currency: "USD" }, "goal.amount"],
      [{ amount: "1e3", currency: "USD" }, "goal.amount"],
      [{ amount: "10", currency: "EUR" }, "goal.currency"],
      [{ amount: "10", currency: "USD", note: "x" }, "goal.note"],
      ["10.00", "goal"],
    ];
    for (const [goal, path] of bad) {
      const res = await patch(id, a.key, { goal });
      expect(res.status, JSON.stringify(goal)).toBe(422);
      expect(await res.json()).toMatchObject({ errors: [{ path }] });
    }
    for (const end_date of ["2027-02-30", "15/03/2027", 20270315]) {
      const res = await patch(id, a.key, { end_date });
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        errors: [{ path: "end_date" }],
      });
    }
    expect((await row_of(id)).target_number).toBeNull();
  });

  test("an ended campaign is 409 campaign_ended", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const stored = await seed_campaign(a, { status: "ended" });
    const lapsed = await seed_campaign(a, {
      status: "live",
      published_at: "2026-01-01T00:00:00.000Z",
      ends_at: "2026-01-31T23:59:59.999Z",
    });
    for (const id of [stored, lapsed]) {
      const res = await patch(id, a.key, { goal: null });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: "campaign_ended",
        status: 409,
      });
    }
  });

  test("another org's campaign is 404 and a missing key is 401", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const b = await pair("Beta", "EIN-B", "b@test.com");
    const id = await seed_campaign(a, { target_number: 50 });
    const body = { goal: null };
    const foreign = await patch(id, b.key, body);
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toMatchObject({ code: "not_found" });
    expect((await patch(id, undefined, body)).status).toBe(401);
    expect((await row_of(id)).target_number).toBe(50);
  });
});

describe("update_campaign_blocks", () => {
  const patch = (id: string, key: string | undefined, body: unknown) =>
    send(blocks_action, "PATCH", id, "/blocks", key, body);
  const BLOB = "https://cnfc6hjkztdschkg.public.blob.vercel-storage.com";
  const RICH = JSON.stringify([
    {
      _type: "block",
      _key: "k1",
      style: "h2",
      markDefs: [],
      children: [
        { _type: "span", _key: "s1", text: "Bold start", marks: ["strong"] },
      ],
    },
  ]);
  const blocks_of = async (id: string, key: string) =>
    (
      (await (await read(id, key)).json()) as {
        blocks: Record<string, unknown>[];
      }
    ).blocks;

  test("writes every block in one update and returns the detail; the slug stays", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a);
    const { slug } = await row_of(id);
    const image = `${BLOB}/u/hero-Xk2Lm9.webp`;

    const res = await patch(id, a.key, {
      blocks: [
        { type: "title", text: "  Spring reading  " },
        {
          type: "story",
          text: "First paragraph.\nSame paragraph.\n\n\n  Second one.  ",
        },
        { type: "hero", image_url: image },
        { type: "goal-bar", goal: { amount: "750", currency: "USD" } },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      title: string;
      slug: string;
      blocks: unknown;
    };
    expect(body.title).toBe("Spring reading");
    expect(body.slug).toBe(slug);
    expect(body.blocks).toEqual([
      { type: "title", text: "Spring reading" },
      {
        type: "story",
        text: "First paragraph.\nSame paragraph.\n\nSecond one.",
      },
      { type: "hero", image_url: image },
      { type: "goal-bar", goal: { amount: "750.00", currency: "USD" } },
    ]);
    const row = await row_of(id);
    expect(row).toMatchObject({
      name: "Spring reading",
      slug,
      banner: image,
      target_number: 750,
      description_v2: "First paragraph.\nSame paragraph.\n\nSecond one.",
    });
    const pt = JSON.parse(row.description_pt) as {
      _type: string;
      style: string;
      markDefs: unknown[];
      children: { _type: string; text: string; marks: unknown[] }[];
    }[];
    expect(pt).toHaveLength(2);
    expect(pt.map((b) => [b._type, b.style, b.markDefs, b.children])).toEqual([
      [
        "block",
        "normal",
        [],
        [
          expect.objectContaining({
            _type: "span",
            text: "First paragraph.\nSame paragraph.",
            marks: [],
          }),
        ],
      ],
      [
        "block",
        "normal",
        [],
        [
          expect.objectContaining({
            _type: "span",
            text: "Second one.",
            marks: [],
          }),
        ],
      ],
    ]);
  });

  test("sending back what get_campaign returned keeps the stored story and image", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a, {
      description_pt: RICH,
      banner: "https://legacy-cdn.example/logo.png",
      target_smart: true,
    });
    const before = await row_of(id);
    const res = await patch(id, a.key, { blocks: await blocks_of(id, a.key) });
    expect(res.status).toBe(200);
    expect(await row_of(id)).toEqual(before);
  });

  test("null clears the image and the goal", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a, {
      banner: `${BLOB}/x.png`,
      target_number: 10,
    });
    const blocks = await blocks_of(id, a.key);
    blocks[2] = { type: "hero", image_url: null };
    blocks[3] = { type: "goal-bar", goal: null };
    expect((await patch(id, a.key, { blocks })).status).toBe(200);
    expect(await row_of(id)).toMatchObject({
      banner: null,
      target_number: null,
    });
  });

  test("refuses an add, a remove, a reorder, an unknown type, an extra key or a wrong value", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a, { target_number: 10 });
    const before = await row_of(id);
    const good = await blocks_of(id, a.key);
    const [title, story, hero, goal] = good as [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    const cases: [unknown, string][] = [
      [[...good, { type: "story", text: "more" }], "blocks"],
      [[title, story, hero], "blocks"],
      [[story, title, hero, goal], "blocks[0].type"],
      [
        [title, story, { type: "photo-grid", images: [] }, goal],
        "blocks[2].type",
      ],
      [[{ ...title, foo: 1 }, story, hero, goal], "blocks[0].foo"],
      [[{ type: "title", text: "   " }, story, hero, goal], "blocks[0].text"],
      [
        [{ type: "title", text: "x".repeat(201) }, story, hero, goal],
        "blocks[0].text",
      ],
      [[title, { type: "story", text: 5 }, hero, goal], "blocks[1].text"],
      [
        [title, { type: "story", text: "x".repeat(10_001) }, hero, goal],
        "blocks[1].text",
      ],
      [
        [
          title,
          story,
          { type: "hero", image_url: "https://evil.example/a.png" },
          goal,
        ],
        "blocks[2].image_url",
      ],
      [
        [
          title,
          story,
          {
            type: "hero",
            image_url: `http://cnfc6hjkztdschkg.public.blob.vercel-storage.com/a.png`,
          },
          goal,
        ],
        "blocks[2].image_url",
      ],
      [
        [
          title,
          story,
          {
            type: "hero",
            image_url: `https://cnfc6hjkztdschkg.public.blob.vercel-storage.com.evil.example/a.png`,
          },
          goal,
        ],
        "blocks[2].image_url",
      ],
      ...[
        "/assets/entry-abc123.js",
        "/migrated/static/logo.png",
        "/a.png",
        "/u/nested/a.png",
        "/u/statement-Q1.pdf",
        "/u/logo-x.svg",
        "/u/photo.png.html",
      ].map((path): [unknown, string] => [
        [title, story, { type: "hero", image_url: `${BLOB}${path}` }, goal],
        "blocks[2].image_url",
      ]),
      [
        [
          title,
          story,
          hero,
          { type: "goal-bar", goal: { amount: "ten", currency: "USD" } },
        ],
        "blocks[3].goal.amount",
      ],
      [[title, story, hero, "goal-bar"], "blocks[3]"],
      ["title", "blocks"],
    ];
    for (const [blocks, path] of cases) {
      const res = await patch(id, a.key, { blocks });
      expect(res.status, path).toBe(422);
      const body = (await res.json()) as { errors: { path: string }[] };
      expect(
        body.errors.map((e) => e.path),
        JSON.stringify(blocks).slice(0, 80)
      ).toContain(path);
    }
    const stray = await patch(id, a.key, { blocks: good, title: "x" });
    expect(stray.status).toBe(422);
    expect(await stray.json()).toMatchObject({
      errors: [{ path: "title", message: "is not a field on this action" }],
    });
    const none = await patch(id, a.key, {});
    expect(none.status).toBe(422);
    expect(await none.json()).toMatchObject({ errors: [{ path: "blocks" }] });
    expect(await row_of(id)).toEqual(before);
  });

  test("a photo the upload page stored is a hero, whatever the extension's case", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a);
    const blocks = await blocks_of(id, a.key);
    for (const name of [
      "Garden day-Xk2Lm9.png",
      "IMG_0042-Ab3.JPEG",
      "a-1.jpg",
      "b-2.WebP",
    ]) {
      const image = `${BLOB}/u/${encodeURIComponent(name)}`;
      blocks[2] = { type: "hero", image_url: image };
      const res = await patch(id, a.key, { blocks });
      expect(res.status, name).toBe(200);
      expect((await row_of(id)).banner).toBe(image);
    }
  });

  test("an ended campaign is 409 campaign_ended, after the blocks are checked, and nothing is written", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const stored = await seed_campaign(a, { status: "ended" });
    const lapsed = await seed_campaign(a, {
      status: "live",
      published_at: "2026-01-01T00:00:00.000Z",
      ends_at: "2026-01-31T23:59:59.999Z",
    });
    for (const id of [stored, lapsed]) {
      const before = await row_of(id);
      const blocks = await blocks_of(id, a.key);
      blocks[0] = { type: "title", text: "Rewritten" };

      const res = await patch(id, a.key, { blocks });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: "campaign_ended",
        status: 409,
      });

      const malformed = await patch(id, a.key, { blocks: "title" });
      expect(malformed.status).toBe(422);
      expect(await row_of(id)).toEqual(before);
    }
  });

  test("another org's campaign is 404 and a missing key is 401", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const b = await pair("Beta", "EIN-B", "b@test.com");
    const id = await seed_campaign(a);
    const blocks = await blocks_of(id, a.key);
    blocks[0] = { type: "title", text: "Taken over" };
    const foreign = await patch(id, b.key, { blocks });
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toMatchObject({ code: "not_found" });
    expect((await patch(id, undefined, { blocks })).status).toBe(401);
    expect((await row_of(id)).name).toBe("Library drive");
  });
});
