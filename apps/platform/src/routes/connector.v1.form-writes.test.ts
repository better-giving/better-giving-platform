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
import { form_update } from "$/pg/queries/form";
import type { DbOrTx } from "$/pg/queries/helpers";
import { user } from "$/pg/schema/auth";
import {
  connector_codes,
  connector_idempotency,
  connector_keys,
} from "$/pg/schema/connector";
import { forms } from "$/pg/schema/form";
import { npos } from "$/pg/schema/npo";
import { programs } from "$/pg/schema/program";
import { user_npo_memberships } from "$/pg/schema/user";
import type { TestDb } from "$/pg/test-utils/pglite";
import { create_test_db } from "$/pg/test-utils/pglite";
import { action as forms_action } from "./connector.v1.forms";
import {
  action as form_action,
  loader as form_loader,
} from "./connector.v1.forms.$id";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
vi.mock("$/pg/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (test_db.current!.db as any)[prop];
    },
  }),
}));

const db = () => test_db.current!.db;
const as_db = (x: unknown) => x as DbOrTx;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  reset_rate_limits();
  await db().delete(forms);
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

const send = (
  handler: Handler,
  method: string,
  id: string | null,
  key: string | undefined,
  body?: unknown,
  extra: Record<string, string> = {}
) => {
  const headers = new Headers({ "content-type": "application/json", ...extra });
  if (key) headers.set("authorization", `Bearer ${key}`);
  const path =
    id === null ? "/connector/v1/forms" : `/connector/v1/forms/${id}`;
  const request = new Request(`https://bg.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handler({
    request,
    params: id === null ? {} : { id },
    context: {},
    url: new URL(request.url),
    pattern: id === null ? "/connector/v1/forms" : "/connector/v1/forms/:id",
  } as unknown as ActionFunctionArgs & LoaderFunctionArgs) as Promise<Response>;
};

const create = (key: string | undefined, body: unknown, idem?: string) =>
  send(
    forms_action as Handler,
    "POST",
    null,
    key,
    body,
    idem ? { "Idempotency-Key": idem } : {}
  );
const update = (id: string, key: string | undefined, body: unknown) =>
  send(form_action as Handler, "PATCH", id, key, body);
const read = (id: string, key: string) =>
  send(form_loader as Handler, "GET", id, key);

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

async function seed_program(npo_id: number, title: string) {
  const id = crypto.randomUUID();
  await db()
    .insert(programs)
    .values({ id, npo_id, title, description_pt: "[]" });
  return id;
}

const row_of = async (id: string) => {
  const [row] = await db().select().from(forms).where(eq(forms.id, id));
  return row!;
};

const errors_of = async (res: Response) =>
  ((await res.json()) as { errors: { path: string }[] }).errors.map(
    (e) => e.path
  );

describe("create_form", () => {
  test("a name alone makes a form owned by and giving to the key's nonprofit, with the admin create's defaults", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");

    const res = await create(a.key, { name: "  Year-end appeal " });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body).toEqual({
      id: expect.any(String),
      name: "Year-end appeal",
      status: "live",
      suggested_amounts: [],
      frequencies: ["one-time", "monthly"],
      donate_methods: [
        "stripe",
        "stripe_bank",
        "daf",
        "stocks",
        "ira_qcd",
        "crypto",
      ],
      minimum: null,
      maximum: null,
      allowed_origins: [],
      gifts_go_to: { mode: "none", program_id: null },
      campaign_id: null,
      updated_at: expect.any(String),
    });
    const row = await row_of(body.id);
    expect(row).toMatchObject({
      name: "Alpha",
      tag: "Year-end appeal",
      owner_npo_id: a.npo.id,
      owner_user_id: null,
      recipient_npo_id: a.npo.id,
      recipient_fund_id: null,
      status: "active",
      target_smart: true,
      target_number: null,
      ltd: 0,
      ltd_count: 0,
      increments: null,
      freq_opts: null,
      donate_methods: null,
      success_redirect: null,
      accent_primary: null,
    });
    expect(row.date_created).not.toBeNull();
    expect((await read(body.id, a.key)).status).toBe(200);
  });

  test("every writable field is stored, and get_form reads them back", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const program = await seed_program(a.npo.id, "Literacy");

    const res = await create(a.key, {
      name: "Spring",
      status: "draft",
      suggested_amounts: [
        { amount: "25", currency: "USD" },
        { amount: "100.50", currency: "USD" },
      ],
      frequencies: ["monthly", "one-time"],
      donate_methods: ["daf", "stripe"],
      gifts_go_to: { mode: "pinned", program_id: program },
      minimum: null,
      maximum: null,
      allowed_origins: [],
    });

    expect(res.status).toBe(201);
    const made = (await res.json()) as { id: string };
    expect(made).toMatchObject({
      name: "Spring",
      status: "draft",
      suggested_amounts: [
        { amount: "25.00", currency: "USD" },
        { amount: "100.50", currency: "USD" },
      ],
      frequencies: ["one-time", "monthly"],
      donate_methods: ["daf", "stripe"],
      gifts_go_to: { mode: "pinned", program_id: program },
    });
    expect(await (await read(made.id, a.key)).json()).toEqual(made);
    expect(await row_of(made.id)).toMatchObject({
      status: "inactive",
      increments: [
        { value: "25", label: "" },
        { value: "100.5", label: "" },
      ],
      freq_opts: ["one-time", "monthly"],
      donate_methods: ["daf", "stripe"],
      program_id: program,
      program_name: "Literacy",
    });
  });

  test("each bad field is a 422 on its own path, and nothing is written", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const b = await pair("Beta", "EIN-B", "b@test.com");
    const theirs = await seed_program(b.npo.id, "Theirs");
    const cases: [unknown, string[]][] = [
      [{}, ["name"]],
      [{ name: "   " }, ["name"]],
      [{ name: "x".repeat(201) }, ["name"]],
      [{ name: "F", status: "active" }, ["status"]],
      [
        { name: "F", suggested_amounts: [{ amount: "0", currency: "USD" }] },
        ["suggested_amounts[0].amount"],
      ],
      [
        { name: "F", suggested_amounts: [{ amount: 25, currency: "USD" }] },
        ["suggested_amounts[0].amount"],
      ],
      [
        { name: "F", suggested_amounts: [{ amount: "5", currency: "EUR" }] },
        ["suggested_amounts[0].currency"],
      ],
      [
        {
          name: "F",
          suggested_amounts: [
            { amount: "5", currency: "USD" },
            { amount: "5.00", currency: "USD" },
          ],
        },
        ["suggested_amounts[1].amount"],
      ],
      [
        {
          name: "F",
          suggested_amounts: ["1", "2", "3", "4", "5"].map((amount) => ({
            amount,
            currency: "USD",
          })),
        },
        ["suggested_amounts"],
      ],
      [{ name: "F", frequencies: ["one-time", "daily"] }, ["frequencies[1]"]],
      [
        { name: "F", frequencies: ["one-time", "one-time"] },
        ["frequencies[1]"],
      ],
      [{ name: "F", frequencies: [] }, ["frequencies"]],
      [{ name: "F", frequencies: ["monthly"] }, ["frequencies"]],
      [{ name: "F", donate_methods: ["paypal"] }, ["donate_methods[0]"]],
      [
        { name: "F", donate_methods: ["stripe", "stripe"] },
        ["donate_methods[1]"],
      ],
      [{ name: "F", donate_methods: [] }, ["donate_methods"]],
      [
        { name: "F", gifts_go_to: { mode: "pinned", program_id: theirs } },
        ["gifts_go_to.program_id"],
      ],
      [{ name: "F", gifts_go_to: { mode: "all" } }, ["gifts_go_to.mode"]],
      [
        { name: "F", success_redirect: "https://evil.example" },
        ["success_redirect"],
      ],
      [{ name: "F", accent_primary: "#ff0000" }, ["accent_primary"]],
      [{ name: "F", thank_you_url: "https://x.example" }, ["thank_you_url"]],
      [{ name: "F", colour: "red" }, ["colour"]],
      [{ name: "F", confirm: true }, ["confirm"]],
      [{ name: "F", id: "mine" }, ["id"]],
      [{ name: "F", campaign_id: null }, ["campaign_id"]],
      [{ name: "F", minimum: { amount: "5", currency: "USD" } }, ["minimum"]],
      [
        { name: "F", allowed_origins: ["https://x.example"] },
        ["allowed_origins"],
      ],
    ];
    for (const [body, paths] of cases) {
      const res = await create(a.key, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(await errors_of(res), JSON.stringify(body)).toEqual(paths);
    }
    expect(await db().select().from(forms)).toHaveLength(0);
  });

  test("an Idempotency-Key replays the first create; without one each call makes a form", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");

    const first = await create(a.key, { name: "Once" }, "idem-1");
    const again = await create(a.key, { name: "Once" }, "idem-1");

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    const id = ((await first.json()) as { id: string }).id;
    expect(((await again.json()) as { id: string }).id).toBe(id);
    expect(await db().select().from(forms)).toHaveLength(1);

    expect((await create(a.key, { name: "Twice" })).status).toBe(201);
    expect((await create(a.key, { name: "Twice" })).status).toBe(201);
    expect(await db().select().from(forms)).toHaveLength(3);
  });

  test("the same Idempotency-Key from another nonprofit is its own create", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const b = await pair("Beta", "EIN-B", "b@test.com");

    const first = await create(a.key, { name: "Shared" }, "idem-shared");
    const other = await create(b.key, { name: "Shared" }, "idem-shared");

    expect(first.status).toBe(201);
    expect(other.status).toBe(201);
    const a_id = ((await first.json()) as { id: string }).id;
    const b_id = ((await other.json()) as { id: string }).id;
    expect(b_id).not.toBe(a_id);
    expect((await row_of(b_id)).owner_npo_id).toBe(b.npo.id);
    expect(await db().select().from(forms)).toHaveLength(2);
  });

  test("the same Idempotency-Key with a different body is a conflict and creates nothing", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");

    const first = await create(a.key, { name: "One" }, "idem-body");
    const changed = await create(a.key, { name: "Two" }, "idem-body");

    expect(first.status).toBe(201);
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({
      code: "idempotency_conflict",
      status: 409,
    });
    const rows = await db().select().from(forms);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tag).toBe("One");
  });

  test("no key is 401, and a method other than POST is unknown_action", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");

    const anon = await create(undefined, { name: "F" });
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ code: "key_refused", status: 401 });

    const put = await send(forms_action as Handler, "PUT", null, a.key, {
      name: "F",
    });
    expect(put.status).toBe(404);
    expect(await put.json()).toEqual({ code: "unknown_action", status: 404 });
    expect(await db().select().from(forms)).toHaveLength(0);
  });
});

async function seed_form(
  npo_id: number,
  vals: Partial<typeof forms.$inferInsert> = {}
) {
  const id = vals.id ?? crypto.randomUUID();
  await db()
    .insert(forms)
    .values({
      id,
      owner_npo_id: npo_id,
      recipient_npo_id: npo_id,
      name: "Alpha",
      tag: "Main form",
      status: "inactive",
      target_smart: true,
      increments: [
        { value: "25", label: "Feeds a family" },
        { value: "50", label: "" },
      ],
      date_created: "2026-01-02T00:00:00.000Z",
      ...vals,
    });
  return id;
}

describe("update_form", () => {
  test("an edit moves updated_at, get_form shows it, and an unchanged send leaves it", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_form(a.npo.id);
    const updated_at = async () =>
      ((await (await read(id, a.key)).json()) as { updated_at: string })
        .updated_at;
    expect(await updated_at()).toBe("2026-01-02T00:00:00.000Z");

    const before = Date.now();
    const res = await update(id, a.key, { name: "Renamed" });
    const edited = ((await res.json()) as { updated_at: string }).updated_at;
    expect(Date.parse(edited)).toBeGreaterThanOrEqual(before - 1);
    expect(await updated_at()).toBe(edited);

    await update(id, a.key, { name: "Renamed" });
    expect(await updated_at()).toBe(edited);
  });

  test("the dashboard's edit moves updated_at too", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_form(a.npo.id);
    const before = Date.now();
    await form_update(id, { status: "inactive" });
    const shown = (await (await read(id, a.key)).json()) as {
      updated_at: string;
    };
    expect(Date.parse(shown.updated_at)).toBeGreaterThanOrEqual(before - 1);
  });

  test("only the fields sent change, and an amount that stays keeps its label", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_form(a.npo.id, {
      freq_opts: ["one-time", "monthly"],
      donate_methods: ["stripe", "daf"],
    });

    const res = await update(id, a.key, {
      suggested_amounts: [
        { amount: "25.00", currency: "USD" },
        { amount: "75", currency: "USD" },
      ],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id,
      name: "Main form",
      status: "draft",
      suggested_amounts: [
        { amount: "25.00", currency: "USD" },
        { amount: "75.00", currency: "USD" },
      ],
      frequencies: ["one-time", "monthly"],
      donate_methods: ["stripe", "daf"],
    });
    expect(await row_of(id)).toMatchObject({
      tag: "Main form",
      name: "Alpha",
      increments: [
        { value: "25", label: "Feeds a family" },
        { value: "75", label: "" },
      ],
    });
  });

  test("a form of another nonprofit and an unknown id are the same 404", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const b = await pair("Beta", "EIN-B", "b@test.com");
    const theirs = await seed_form(b.npo.id);

    const foreign = await update(theirs, a.key, { name: "Mine now" });
    const unknown = await update("nope", a.key, { name: "Mine now" });

    for (const [res, id] of [
      [foreign, theirs],
      [unknown, "nope"],
    ] as const) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        code: "not_found",
        status: 404,
        detail: `Form ${id} does not exist for this nonprofit.`,
      });
    }
    expect((await row_of(theirs)).tag).toBe("Main form");
  });

  test("a live form refuses a donor-visible change without confirm, and applies it with", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const program = await seed_program(a.npo.id, "Literacy");
    const id = await seed_form(a.npo.id, { status: "active" });
    const change = {
      frequencies: ["one-time", "weekly"],
      donate_methods: ["crypto"],
      gifts_go_to: { mode: "pinned", program_id: program },
      suggested_amounts: [
        { amount: "10", currency: "USD" },
        { amount: "40", currency: "USD" },
      ],
    };

    for (const [key, value] of Object.entries(change)) {
      const held = await update(id, a.key, { [key]: value });
      expect(held.status, key).toBe(409);
      const problem = (await held.json()) as { code: string; detail: string };
      expect(problem.code).toBe("confirm_required");
      expect(problem.detail).toContain(key);
    }
    expect(await row_of(id)).toMatchObject({
      freq_opts: null,
      donate_methods: null,
      program_id: null,
      increments: [
        { value: "25", label: "Feeds a family" },
        { value: "50", label: "" },
      ],
    });

    const applied = await update(id, a.key, { ...change, confirm: true });
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({
      status: "live",
      frequencies: ["one-time", "weekly"],
      donate_methods: ["crypto"],
      gifts_go_to: { mode: "pinned", program_id: program },
      suggested_amounts: [
        { amount: "10.00", currency: "USD" },
        { amount: "40.00", currency: "USD" },
      ],
    });
    expect((await row_of(id)).program_name).toBe("Literacy");
    expect((await row_of(id)).increments).toEqual([
      { value: "10", label: "" },
      { value: "40", label: "" },
    ]);

    const cleared = await update(id, a.key, {
      gifts_go_to: { mode: "none" },
      confirm: true,
    });
    expect(await cleared.json()).toMatchObject({
      gifts_go_to: { mode: "none", program_id: null },
    });
    expect(await row_of(id)).toMatchObject({
      program_id: null,
      program_name: null,
    });
  });

  test("the name is the form's label, so renaming a live form needs no confirm and leaves what donors see", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_form(a.npo.id, { status: "active" });

    const res = await update(id, a.key, { name: "  Gala 2026 " });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      name: "Gala 2026",
      status: "live",
    });
    expect(await row_of(id)).toMatchObject({ tag: "Gala 2026", name: "Alpha" });

    // a rename riding with a donor-visible change is still held, and named apart
    const held = await update(id, a.key, {
      name: "Gala",
      donate_methods: ["stripe"],
    });
    expect(held.status).toBe(409);
    const detail = ((await held.json()) as { detail: string }).detail;
    expect(detail).toContain("donate_methods");
    expect(detail).not.toContain("name");
    expect((await row_of(id)).tag).toBe("Gala 2026");
  });

  test("taking a live form to draft needs confirm; a draft form's changes do not", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const live = await seed_form(a.npo.id, { status: "active" });
    const draft = await seed_form(a.npo.id);

    const held = await update(live, a.key, { status: "draft" });
    expect(held.status).toBe(409);
    expect(((await held.json()) as { detail: string }).detail).toContain(
      "status"
    );
    expect((await row_of(live)).status).toBe("active");
    const off = await update(live, a.key, { status: "draft", confirm: true });
    expect(off.status).toBe(200);
    expect((await row_of(live)).status).toBe("inactive");

    const edited = await update(draft, a.key, {
      name: "Draft renamed",
      donate_methods: ["stripe"],
      status: "live",
    });
    expect(edited.status).toBe(200);
    expect(await row_of(draft)).toMatchObject({
      tag: "Draft renamed",
      name: "Alpha",
      donate_methods: ["stripe"],
      status: "active",
    });

    // a form with no stored status reads as draft and takes the same write
    const unset = await seed_form(a.npo.id, { status: null });
    const named = await update(unset, a.key, { donate_methods: ["daf"] });
    expect(named.status).toBe(200);
    expect((await row_of(unset)).donate_methods).toEqual(["daf"]);
  });

  test("a GET body sent back unchanged is a 200 no-op on a live form, without confirm", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_form(a.npo.id, {
      status: "active",
      freq_opts: ["one-time", "monthly"],
    });
    const before = await row_of(id);
    const shown = await (await read(id, a.key)).json();

    const res = await update(id, a.key, shown);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(shown);
    expect(await row_of(id)).toEqual(before);
  });

  test("refused fields are 422s on their paths, and nothing is written", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_form(a.npo.id, { status: "active" });
    const cases: [unknown, string[]][] = [
      [{ success_redirect: "https://evil.example" }, ["success_redirect"]],
      [{ accent_secondary: "#000" }, ["accent_secondary"]],
      [{ owner_npo_id: 9 }, ["owner_npo_id"]],
      [{ id: "other" }, ["id"]],
      [{ campaign_id: "fund-x" }, ["campaign_id"]],
      [{ updated_at: "2020-01-01T00:00:00.000Z" }, ["updated_at"]],
      [{ maximum: { amount: "500", currency: "USD" } }, ["maximum"]],
      [{ name: "Renamed", confirm: "yes" }, ["confirm"]],
      [{ name: "" }, ["name"]],
    ];
    for (const [body, paths] of cases) {
      const res = await update(id, a.key, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(await errors_of(res), JSON.stringify(body)).toEqual(paths);
    }
    expect((await row_of(id)).tag).toBe("Main form");
  });

  test("no key is 401, and a method other than PATCH is unknown_action", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_form(a.npo.id);

    const anon = await update(id, undefined, { name: "F" });
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ code: "key_refused", status: 401 });

    const post = await send(form_action as Handler, "POST", id, a.key, {
      name: "F",
    });
    expect(post.status).toBe(404);
    expect(await post.json()).toEqual({ code: "unknown_action", status: 404 });
    expect((await row_of(id)).tag).toBe("Main form");
  });
});
