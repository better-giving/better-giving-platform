import { readdirSync, readFileSync } from "node:fs";
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
import {
  donation_amounts,
  fee_terms,
  whole_dollar_amounts,
} from "#/components/donation/common/amounts";
import { API_ERROR_STATUS } from "@/helpers/api-error";
import { rd } from "@/helpers/decimal";
import { min_fee_allowance } from "@/helpers/donation";
import { npo_ref } from "@/npo/schema";
import { CONNECTOR_ACTIONS } from "../connector/actions";
import { BODY_KEYS, EXPECTED_VERSION, QUERY_PARAMS } from "../connector/inputs";
import { PROBLEM_CODES } from "../connector/problem";
import { mint_key } from "../partner/keys";
import {
  PROBLEM_CODES as PARTNER_PROBLEM_CODES,
  rate_limited,
} from "../partner/problem";
import { RAIL_STATES, RAILS, readiness } from "../partner/readiness";
import { partner_tenants } from "../pg/schema/partner";
import { create_test_db, type TestDb } from "../pg/test-utils/pglite";
import { read_only } from "../public-api";
import { EXCLUDED, type IOperation, openapi_doc, operations } from "./spec";
import { wire_schema } from "./wire-schema";

// the partner routes read the database through `$/pg/db`: a pglite one
const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
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
vi.mock("#/errors/report", () => ({ report_error }));

const ROUTES_DIR = new URL("../../src/routes/", import.meta.url);
const CONNECTOR_DIR = new URL("../connector/", import.meta.url);

type Handler = (args: unknown) => Response | Promise<Response>;
type RouteModule = { loader?: Handler; action?: Handler };
const modules = import.meta.glob<RouteModule>([
  "/src/routes/api.*.ts",
  "/src/routes/connector.v1.*.ts",
  "!**/*.test.ts",
]);
const route_module = (id: string) => modules[`/src/routes/${id}.ts`]();
const route_source_of = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const connector_sources = readdirSync(CONNECTOR_DIR)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) =>
    readFileSync(new URL(f, CONNECTOR_DIR), "utf8").replace(
      /\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm,
      ""
    )
  );

/** a handler whose body reads its key set from a helper it calls */
const OWNING_FUNCTION: Record<string, string> = {
  create_campaign: "insert_campaign",
  create_form: "insert_form",
  list_recurring_gifts: "list_recurring",
};

/** which `<table>.<action>` sets the action's own handler body names,
 * comments excluded: a swapped or missing reference shows here */
const refs_in = (action: string, table: "QUERY_PARAMS" | "BODY_KEYS") => {
  const fn = OWNING_FUNCTION[action] ?? action;
  const head = new RegExp(`^(export )?(async )?function ${fn}\\(`, "m");
  const owners = connector_sources.filter((t) => head.test(t));
  expect(owners, `one function ${fn}`).toHaveLength(1);
  const text = owners[0];
  const from = text.search(head);
  const body = text.slice(from, text.indexOf("\n}\n", from));
  return [...body.matchAll(new RegExp(`${table}\\.(\\w+)`, "g"))].map(
    (m) => m[1]
  );
};

/** route ids under the documented prefixes: a file's name without its
 * extension, or a folder route's name */
const api_route_ids = () =>
  readdirSync(ROUTES_DIR, { withFileTypes: true })
    .filter((e) => /^(api|connector\.v1)\./.test(e.name))
    .filter((e) => !/\.test\.tsx?$/.test(e.name))
    .map((e) => (e.isDirectory() ? e.name : e.name.replace(/\.tsx?$/, "")));

/** operations whose route never refuses a request, so their only error is a
 * throw's 500; the api_error-codes test below confirms they send no 4xx */
const REFUSES_NOTHING = [
  "list_currencies",
  "search_tickers",
  "search_tokens",
  "list_top_countries",
];

type Json = Record<string, unknown>;
const doc = openapi_doc("https://better.giving");
type Param = { name: string; in: string; schema: unknown };
const op_of = (id: string) => {
  const found = operations().find((o) => o.op.operationId === id);
  if (!found) throw new Error(`no operation ${id}`);
  return found.op as {
    parameters?: Param[];
    responses?: Record<string, unknown>;
    requestBody?: {
      required: boolean;
      content: Record<string, { schema: { properties?: object } }>;
    };
  };
};
const params_in = (id: string, where: string) =>
  (op_of(id).parameters ?? []).filter((p) => p.in === where);

/** the surface an operation belongs to: its one tag */
const surface_of = (o: IOperation) => (o.op.tags as string[])[0];
const of_surface = (surface: string) =>
  operations().filter((o) => surface_of(o) === surface);

const call = (handler: Handler, method: string, path: string) =>
  handler({
    request: new Request(`https://bg.test${path.replace(/\{id\}/, "x1")}`, {
      method: method.toUpperCase(),
      ...(method === "get" ? {} : { body: "{}" }),
      headers: { "x-forwarded-for": "203.0.113.9" },
    }),
    params: { id: "x1" },
    context: {},
  });

type Db = Parameters<typeof mint_key>[0];
const as_db = (x: unknown) => x as Db;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);
afterAll(async () => {
  await test_db.current?.client.close();
});
beforeEach(() => {
  reset_rate_limits();
  report_error.mockReset();
});

/** a nonprofit with a live key, its own email and registration number so a
 * test can seed one without meeting another's rows */
const keyed_npo = async (tag: string) => {
  const { db } = test_db.current!;
  const staff = (await seed_user(db, `${tag}@test.com`))!;
  const npo = (await seed_npo(db, { registration_number: `EIN-${tag}` }))!;
  const key = await mint_key(as_db(db), {
    npo_id: npo.id,
    minted_by: staff.id,
  });
  return { npo, key };
};

describe("openapi drift", () => {
  test("every api.* and connector.v1.* route is documented or excluded", () => {
    const documented = new Set(operations().map((o) => o.route));
    const ids = api_route_ids();
    expect(
      ids.filter((id) => !documented.has(id) && !(id in EXCLUDED))
    ).toEqual([]);
    expect(
      [...documented, ...Object.keys(EXCLUDED)].filter(
        (id) => !ids.includes(id)
      )
    ).toEqual([]);
  });

  test("every connector action is one operation", () => {
    const connector_ids = operations()
      .filter((o) => o.route.startsWith("connector.v1."))
      .map((o) => o.op.operationId);
    expect([...connector_ids].sort()).toEqual([...CONNECTOR_ACTIONS].sort());
  });

  test("every operation is on exactly one surface, and its route is under that surface's prefix", () => {
    const prefix: Record<string, RegExp> = {
      public: /^api\.(?!partner\.)/,
      connector: /^connector\.v1\./,
      partner: /^api\.partner\.v1\./,
    };
    for (const o of operations()) {
      expect(o.op.tags, o.op.operationId).toHaveLength(1);
      expect(o.route, o.op.operationId).toMatch(prefix[surface_of(o)]);
    }
  });

  test("each public operation is a GET its route's loader serves", async () => {
    for (const o of of_surface("public")) {
      const mod = await route_module(o.route);
      expect(o.method, o.route).toBe("get");
      expect(mod.loader, o.route).toBeTypeOf("function");
      expect(mod.action, o.route).toBe(read_only);
    }
  });

  test("a connector route serves exactly its documented methods", async () => {
    const by_route = new Map<string, IOperation[]>();
    for (const o of operations()) {
      if (!o.route.startsWith("connector.v1.")) continue;
      by_route.set(o.route, [...(by_route.get(o.route) ?? []), o]);
    }
    for (const [route, ops] of by_route) {
      const mod = await route_module(route);
      for (const method of ["get", "post", "patch"]) {
        const handler = method === "get" ? mod.loader : mod.action;
        if (!handler) throw new Error(`${route} has no ${method} handler`);
        const op = ops.find((o) => o.method === method);
        const res = await call(handler, method, op?.path ?? `/${route}`);
        const { code } = await res.json();
        const label = `${method} ${route}`;
        if (!op) {
          expect([res.status, code], label).toEqual([404, "unknown_action"]);
        } else if (op.op.operationId === "hello") {
          expect(res.status, label).toBe(200);
        } else if (op.op.operationId === "exchange") {
          expect([res.status, code], label).toEqual([400, "code_invalid"]);
        } else {
          // keyed: reached the key check, so the method is served
          expect(op.op.security, label).toEqual([{ connectorKey: [] }]);
          expect([res.status, code], label).toEqual([401, "key_refused"]);
        }
      }
    }
  });

  test("each documented query and body key set is the one its own handler refuses against", () => {
    for (const [action, keys] of Object.entries(QUERY_PARAMS)) {
      expect(
        params_in(action, "query").map((p) => p.name),
        action
      ).toEqual([...keys]);
      expect(refs_in(action, "QUERY_PARAMS"), action).toEqual([action]);
    }
    for (const [action, keys] of Object.entries(BODY_KEYS)) {
      const schema = op_of(action).requestBody?.content["application/json"]
        .schema as { properties: object; additionalProperties: boolean };
      expect(Object.keys(schema.properties), action).toEqual([...keys]);
      expect(schema.additionalProperties, action).toBe(false);
      expect(refs_in(action, "BODY_KEYS"), action).toEqual([action]);
    }
  });

  test("get_block_catalog refuses a parameter its documented set lacks", async () => {
    const { get_block_catalog } = await import("../connector/reads");
    expect(QUERY_PARAMS.get_block_catalog).toEqual([]);
    const res = get_block_catalog(new URL("https://bg.test/x?stray=1"));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: "invalid",
      errors: [{ path: "stray", message: "is not a parameter of this action" }],
    });
    expect(get_block_catalog(new URL("https://bg.test/x")).status).toBe(200);
  });

  test("a create replayed under its Idempotency-Key documents the replay's 200", () => {
    for (const id of ["create_campaign", "create_form"]) {
      expect(Object.keys(op_of(id).responses ?? {}), id).toEqual(
        expect.arrayContaining(["200", "201"])
      );
    }
    // no idempotency record: every call issues a fresh link
    expect(op_of("create_photo_upload_link").responses).not.toHaveProperty(
      "200"
    );
  });

  test("an Idempotency-Key header that's sent can be refused with a 400", () => {
    for (const o of operations()) {
      const sends = (o.op.parameters as Param[] | undefined)?.some(
        (p) => p.name === "Idempotency-Key"
      );
      if (sends)
        expect(
          op_of(o.op.operationId).responses,
          o.op.operationId
        ).toHaveProperty("400");
    }
  });

  test("a write that reads no body at all as {} doesn't require one", () => {
    for (const o of operations()) {
      const body = op_of(o.op.operationId).requestBody;
      if (!body || o.route === "connector.v1.exchange") continue;
      const optional = ["end_campaign", "publish_campaign"].includes(
        o.op.operationId
      );
      expect(body.required, o.op.operationId).toBe(!optional);
    }
    for (const action of ["end_campaign", "publish_campaign"]) {
      expect(route_source_of(".server/connector/campaign-writes.ts")).toMatch(
        new RegExp(
          `function ${action}\\([\\s\\S]*?read_body\\(request, \\{ allow_empty: true \\}\\)`
        )
      );
    }
  });

  test("expected_version carries the pattern the route enforces", () => {
    for (const id of ["update_campaign_settings", "update_campaign_blocks"]) {
      const schema = op_of(id).requestBody?.content["application/json"]
        .schema as { properties: Record<string, { pattern?: string }> };
      expect(schema.properties.expected_version.pattern, id).toBe(
        EXPECTED_VERSION.source
      );
    }
    expect(route_source_of(".server/connector/campaign-writes.ts")).toContain(
      "EXPECTED_VERSION.test("
    );
  });

  test("a partner operation is keyed, and its route refuses the other method as not_found", async () => {
    const partner = of_surface("partner");
    expect(partner.length).toBeGreaterThan(0);
    for (const o of partner) {
      const mod = await route_module(o.route);
      expect(["get", "post"], o.route).toContain(o.method);
      expect(o.op.security, o.route).toEqual([{ partnerKey: [] }]);
      if (!mod.loader || !mod.action) throw new Error(`${o.route} handlers`);
      const [served, other] =
        o.method === "get"
          ? [mod.loader, mod.action]
          : [mod.action, mod.loader];
      const keyless = await call(served, o.method, o.path);
      expect([keyless.status, (await keyless.json()).code]).toEqual([
        401,
        "key_invalid",
      ]);
      const refused = await call(
        other,
        o.method === "get" ? "post" : "get",
        o.path
      );
      expect([refused.status, (await refused.json()).code]).toEqual([
        404,
        "not_found",
      ]);
    }
  });

  const declared = (status: number) => {
    const res = op_of("get_readiness").responses?.[status] as {
      headers?: Record<string, { schema: Json }>;
    };
    return Object.fromEntries(
      Object.entries(res.headers ?? {}).map(([k, v]) => [
        k.toLowerCase(),
        v.schema,
      ])
    );
  };
  const expect_documented = (status: number, r: Response) => {
    expect(r.status).toBe(status);
    const sent = [...r.headers].filter(([k]) => k !== "content-type");
    const schemas = declared(status);
    expect(Object.keys(schemas).sort(), `${status}`).toEqual(
      sent.map(([k]) => k).sort()
    );
    for (const [k, v] of sent) {
      const value = /^\d+$/.test(v) ? Number(v) : v;
      expect(schema_errors(schemas[k], value, k), `${status}`).toEqual([]);
    }
  };
  const readiness_get = async (token?: string) => {
    const mod = await route_module("api.partner.v1.readiness");
    if (!mod.loader) throw new Error("readiness loader");
    return mod.loader({
      request: new Request("https://bg.test/api/partner/v1/readiness", {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
      params: {},
      context: {},
    });
  };

  test("a partner response declares exactly the headers its route sends, each value inside its schema", async () => {
    const { key } = await keyed_npo("headers");

    const ok = await readiness_get(key.key);
    expect_documented(200, ok);
    expect(await ok.json()).toHaveProperty("revision", 1);
    expect_documented(401, await readiness_get());
    // gate's charge answers with this constructor
    expect_documented(429, rate_limited(30));
  });

  test("the readiness response schema names every rail in each per-rail map", () => {
    const ok = op_of("get_readiness").responses?.["200"] as {
      content: Record<string, { schema: { $ref: string } }>;
    };
    const schema = ok.content["application/json"].schema;
    expect(schema).toEqual({ $ref: "#/components/schemas/PartnerReadiness" });
    const { properties, required } = doc.components.schemas.PartnerReadiness;
    for (const map of ["rails", "intervals", "fee_rules"] as const) {
      expect(properties[map].required, map).toEqual([...RAILS]);
      expect(Object.keys(properties[map].properties), map).toEqual([...RAILS]);
    }
    expect(required).toEqual(Object.keys(properties));
    expect(properties.rails).toMatchObject({
      properties: {
        card: { properties: { state: { enum: [...RAIL_STATES] } } },
      },
    });
  });

  test("error code enums are the codes the routes send", () => {
    const { ApiError, ConnectorProblem, PartnerProblem } =
      doc.components.schemas;
    expect(PartnerProblem.properties.code.enum).toEqual([
      ...PARTNER_PROBLEM_CODES,
    ]);
    expect(PartnerProblem.properties.error.properties.code.enum).toEqual([
      ...PARTNER_PROBLEM_CODES,
    ]);
    expect(ApiError.properties.error.properties.code.enum).toEqual(
      Object.keys(API_ERROR_STATUS)
    );
    expect(ConnectorProblem.properties.code.enum).toEqual([...PROBLEM_CODES]);
    expect(ConnectorProblem.properties.error.properties.code.enum).toEqual([
      ...PROBLEM_CODES,
    ]);
  });

  test("every operation documents a 4xx and a 5xx, unless its route refuses nothing", () => {
    for (const o of operations()) {
      const id = o.op.operationId;
      const classes = Object.keys(op_of(id).responses ?? {}).map((s) => s[0]);
      expect(classes, id).toContain("5");
      expect(classes.includes("4"), id).toBe(!REFUSES_NOTHING.includes(id));
    }
  });

  test("every error response carries its surface's error schema, built on the shared ErrorDetail", () => {
    const { schemas } = doc.components;
    expect(schemas.ApiError.properties.error.allOf).toEqual([
      { $ref: "#/components/schemas/ErrorDetail" },
    ]);
    expect(schemas.ConnectorProblem.properties.error.allOf).toEqual([
      { $ref: "#/components/schemas/ErrorDetail" },
    ]);
    expect(schemas.PartnerProblem.properties.error.allOf).toEqual([
      { $ref: "#/components/schemas/ErrorDetail" },
    ]);
    const error_schema: Record<string, [string, string]> = {
      public: ["application/json", "ApiError"],
      connector: ["application/problem+json", "ConnectorProblem"],
      partner: ["application/problem+json", "PartnerProblem"],
    };
    for (const o of operations()) {
      const [media, schema] = error_schema[surface_of(o)];
      for (const [status, res] of Object.entries(o.op.responses as Json)) {
        if (Number(status) < 400) continue;
        expect(
          (res as { content: Json }).content,
          `${o.op.operationId} ${status}`
        ).toEqual({
          [media]: { schema: { $ref: `#/components/schemas/${schema}` } },
        });
      }
    }
  });

  test("a public operation's 4xx are the api_error codes its route sends", () => {
    for (const o of of_surface("public")) {
      const source = route_source_of(`src/routes/${o.route}.ts`);
      const sent = [...source.matchAll(/api_error\(\s*"(\w+)"/g)]
        .map((m) => API_ERROR_STATUS[m[1] as keyof typeof API_ERROR_STATUS])
        .filter((s) => s < 500);
      const documented = Object.keys(o.op.responses as Json)
        .map(Number)
        .filter((s) => s >= 400 && s < 500);
      expect(documented, o.route).toEqual(
        [...new Set(sent)].sort((a, b) => a - b)
      );
      // public_api_route answers any throw with the documented 500
      expect(source, o.route).toMatch(
        /export const loader = public_api_route\(/
      );
    }
  });

  test("a connector operation's handler answers a throw with its documented 500", () => {
    for (const o of operations()) {
      if (!o.route.startsWith("connector.v1.")) continue;
      const source = route_source_of(`src/routes/${o.route}.ts`);
      const handler = o.method === "get" ? "loader" : "action";
      expect(source, `${o.method} ${o.route}`).toMatch(
        new RegExp(`export const ${handler} = connector_route\\(`)
      );
    }
  });

  test("a partner route that throws answers the documented 500 and reports it", async () => {
    const { key } = await keyed_npo("throws");
    // a live key whose tenant row is gone: readiness throws
    await test_db.current!.db.delete(partner_tenants);

    const res = await readiness_get(key.key);

    expect_documented(500, res);
    expect(await res.json()).toMatchObject({
      code: "provider_error",
      status: 500,
    });
    expect(report_error).toHaveBeenCalledOnce();
  });

  test("every $ref resolves inside the document", () => {
    const refs: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "$ref" && typeof v === "string") refs.push(v);
          else walk(v);
        }
      }
    };
    walk(doc);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of new Set(refs)) {
      expect(r, r).toMatch(/^#\//);
      const target = r
        .slice(2)
        .split("/")
        .reduce<unknown>(
          (at, seg) => (at as Record<string, unknown> | undefined)?.[seg],
          doc
        );
      expect(target, r).toBeDefined();
    }
  });
});

/** the subset of JSON Schema the published bodies use. an object key the
 * schema doesn't declare is a failure here (a body field it omits is the
 * drift) unless the schema gives `additionalProperties` a schema: the open
 * per-method maps, whose unknown keys are checked against it */
const schema_errors = (schema: Json, value: unknown, at = "$"): string[] => {
  const s = schema as {
    type?: string;
    enum?: unknown[];
    required?: string[];
    properties?: Record<string, Json>;
    items?: Json;
    minimum?: number;
    maximum?: number;
    pattern?: string;
    format?: string;
    additionalProperties?: Json | boolean;
  };
  const kind = (v: unknown) =>
    v === null
      ? "null"
      : Array.isArray(v)
        ? "array"
        : Number.isInteger(v)
          ? "integer"
          : typeof v;
  const k = kind(value);
  if (s.type && s.type !== k && !(s.type === "number" && k === "integer"))
    return [`${at}: expected ${s.type}, got ${k}`];
  const errs: string[] = [];
  if (s.enum && !s.enum.includes(value))
    errs.push(`${at}: ${JSON.stringify(value)} not in enum`);
  if (typeof value === "number") {
    if (s.minimum !== undefined && value < s.minimum) errs.push(`${at}: < min`);
    if (s.maximum !== undefined && value > s.maximum) errs.push(`${at}: > max`);
  }
  if (typeof value === "string") {
    if (s.pattern && !new RegExp(s.pattern).test(value))
      errs.push(`${at}: ${value} fails pattern`);
    if (s.format === "uri" && !URL.canParse(value))
      errs.push(`${at}: ${value} is not a uri`);
  }
  if (Array.isArray(value) && s.items) {
    for (const [i, x] of value.entries())
      errs.push(...schema_errors(s.items, x, `${at}[${i}]`));
  }
  if (k === "object") {
    const obj = value as Record<string, unknown>;
    const props = s.properties ?? {};
    for (const key of s.required ?? [])
      if (!(key in obj)) errs.push(`${at}.${key}: missing`);
    for (const [key, v] of Object.entries(obj)) {
      if (key in props) {
        errs.push(...schema_errors(props[key], v, `${at}.${key}`));
      } else if (typeof s.additionalProperties === "object") {
        errs.push(...schema_errors(s.additionalProperties, v, `${at}.${key}`));
      } else {
        errs.push(`${at}.${key}: not in schema`);
      }
    }
  }
  return errs;
};

describe("readiness body against the published schema", () => {
  let bodies = 0;
  const real_body = async () => {
    const { db } = test_db.current!;
    bodies += 1;
    const staff = (await seed_user(db, `body-${bodies}@test.com`))!;
    const npo = (await seed_npo(db, {
      donate_methods: null,
      registration_number: `EIN-B${bodies}`,
    }))!;
    await mint_key(as_db(db), { npo_id: npo.id, minted_by: staff.id });
    return readiness(as_db(db), npo.id);
  };

  test("a real body validates, and the validator refuses an added, missing or out-of-enum field", async () => {
    const schema = doc.components.schemas.PartnerReadiness as Json;
    const body = await real_body();
    expect(body.coins.length).toBeGreaterThan(0);
    expect(body.clients.length).toBeGreaterThan(0);

    expect(schema_errors(schema, body)).toEqual([]);

    // proves each failure mode of the check is live
    expect(schema_errors(schema, { ...body, added: 1 })).toEqual([
      "$.added: not in schema",
    ]);
    const { revision: _, ...renamed } = body;
    expect(schema_errors(schema, { ...renamed, rev: 1 })).toEqual([
      "$.revision: missing",
      "$.rev: not in schema",
    ]);
    expect(
      schema_errors(schema, {
        ...body,
        rails: { ...body.rails, card: { state: "paused", offered: false } },
      })
    ).toEqual(['$.rails.card.state: "paused" not in enum']);
  });

  test("the per-method maps are open, with every named method required, and the description says unknown keys and values are ignored", () => {
    const schema = doc.components.schemas.PartnerReadiness as unknown as {
      description: string;
      properties: Record<
        string,
        {
          additionalProperties: Json;
          required: string[];
          properties: Record<string, Json>;
        }
      >;
    };
    for (const map of ["rails", "intervals", "fee_rules"]) {
      const m = schema.properties[map];
      expect(m.required, map).toEqual([...RAILS]);
      expect(Object.keys(m.properties), map).toEqual([...RAILS]);
      // an unknown key carries the same shape as a known one
      expect(m.additionalProperties, map).toEqual(m.properties.card);
    }
    expect(schema.description).toMatch(
      /ignore a key or value you don't recognize/
    );
    expect(schema.description).toMatch(/unknown state as not offered/);
    expect(schema.description).toMatch(/\.offered` alone/);
  });

  test("a body with a method the schema doesn't name validates in each map, and an unknown method of the wrong shape does not", async () => {
    const schema = doc.components.schemas.PartnerReadiness as Json;
    const body = await real_body();
    const grown = {
      ...body,
      rails: { ...body.rails, wire: { state: "active", offered: true } },
      intervals: { ...body.intervals, wire: ["monthly"] },
      fee_rules: {
        ...body.fee_rules,
        wire: { percent: 0.01, fixed_minor: 25 },
      },
    };

    expect(schema_errors(schema, grown)).toEqual([]);

    // the open map still holds an unknown key to the shape of a known one,
    // so the pass above is the schema's doing and not a validator that skips it
    expect(
      schema_errors(schema, {
        ...body,
        fee_rules: { ...body.fee_rules, wire: { percent: "1%" } },
      })
    ).toEqual([
      "$.fee_rules.wire.fixed_minor: missing",
      "$.fee_rules.wire.percent: expected number, got string",
    ]);
    expect(
      schema_errors(schema, {
        ...body,
        rails: { ...body.rails, wire: { state: "active" } },
      })
    ).toEqual(["$.rails.wire.offered: missing"]);
    expect(
      schema_errors(schema, {
        ...body,
        intervals: { ...body.intervals, wire: "monthly" },
      })
    ).toEqual(["$.intervals.wire: expected array, got string"]);
  });

  test("a rail's states include pending, and the amounts are integer USD cents", async () => {
    const schema = doc.components.schemas.PartnerReadiness as unknown as {
      properties: {
        currencies: Json;
        rails: { properties: { card: { properties: { state: Json } } } };
        fee_rules: {
          properties: { card: { properties: Record<string, Json> } };
        };
      };
    };
    expect(
      schema.properties.rails.properties.card.properties.state.enum
    ).toEqual(["active", "pending", "inactive", "unrequested"]);
    const fee = schema.properties.fee_rules.properties.card.properties;
    for (const key of ["fixed_minor", "cap_minor", "round_up_minor"]) {
      expect(fee[key], key).toMatchObject({ type: "integer", minimum: 0 });
    }
    const body = await real_body();
    expect(body.currencies).toEqual(["USD"]);
    for (const rule of Object.values(body.fee_rules)) {
      for (const key of [
        "fixed_minor",
        "cap_minor",
        "round_up_minor",
      ] as const) {
        const v = rule[key];
        if (v !== undefined) expect(Number.isInteger(v), key).toBe(true);
      }
    }
  });
});

describe("fee_rules against the checkout's fee", () => {
  let rules_seeded: Awaited<ReturnType<typeof readiness>>["fee_rules"];
  const rule_of = async () => {
    if (rules_seeded) return rules_seeded;
    const { db } = test_db.current!;
    const staff = (await seed_user(db, "fees@test.com"))!;
    const npo = (await seed_npo(db, { registration_number: "EIN-FEES" }))!;
    await mint_key(as_db(db), { npo_id: npo.id, minted_by: staff.id });
    rules_seeded = (await readiness(as_db(db), npo.id)).fee_rules;
    return rules_seeded;
  };

  /** the formula as `fee_rules`' description states it, in minor units */
  const documented_fee = (
    r: { percent: number; fixed_minor: number; cap_minor?: number },
    base_minor: number
  ) =>
    Math.min(
      (base_minor * r.percent + r.fixed_minor) / (1 - r.percent),
      r.cap_minor ?? Number.POSITIVE_INFINITY
    );

  /** what checkout adds to the gift of `usd` for a donor covering fees, in
   * cents, through the function each rail's checkout calls */
  const checkout_fee = (rail: string, usd: number) => {
    const none = {
      amount: usd,
      tip_format: "none",
      tip: "",
      cover_processing_fee: true,
    } as const;
    if (rail === "paypal" || rail === "venmo") {
      const { rate, flat } = fee_terms.paypal;
      return Math.round(+rd(min_fee_allowance(usd, rate, flat), 2) * 100);
    }
    if (rail === "crypto") {
      return min_fee_allowance(usd, fee_terms.crypto.rate) * 100;
    }
    const terms = {
      card: fee_terms.stripe,
      apple_pay: fee_terms.stripe,
      google_pay: fee_terms.stripe,
      ach: fee_terms.stripe_bank,
      daf: fee_terms.daf,
    }[rail];
    if (!terms) throw new Error(`no checkout fee for ${rail}`);
    const amounts = donation_amounts(none, 2, terms);
    // a daf grants whole dollars, as its checkout does
    return (
      (rail === "daf" ? whole_dollar_amounts(amounts) : amounts).fee_allowance *
      100
    );
  };

  /** the published rule: the total (gift + fee) rounds up to a multiple of
   * round_up_minor and the difference lands on the fee */
  const rounded_fee = (
    formula: number,
    base_minor: number,
    round_up_minor: number
  ) =>
    Math.ceil((base_minor + formula - 1e-9) / round_up_minor) * round_up_minor -
    base_minor;

  test("each published rule's formula is the fee checkout adds, rounded as the rule says", async () => {
    const rules = await rule_of();
    for (const [rail, rule] of Object.entries(rules)) {
      // 1000 USD reaches ach's cap
      for (const usd of [10, 100, 1000]) {
        const formula = documented_fee(rule, usd * 100);
        const expected =
          rule.round_up_minor === undefined
            ? Math.floor(formula)
            : rounded_fee(formula, usd * 100, rule.round_up_minor);
        const sent = checkout_fee(rail, usd);
        // crypto doesn't round
        if (rail === "crypto")
          expect(sent, `${rail} ${usd}`).toBeCloseTo(formula);
        else expect(sent, `${rail} ${usd}`).toBe(expected);
      }
    }
    expect(rules.ach.cap_minor).toBe(500);
    expect(documented_fee(rules.ach, 100_000)).toBe(500);
  });

  test("the rule's rounding fields: cents on stripe's rails, whole dollars on daf, none on paypal, venmo and crypto", async () => {
    const rules = await rule_of();
    // the daf's 100 is tied to checkout's whole_dollar_amounts by the formula
    // test above and the worked gifts below
    expect(
      Object.fromEntries(
        Object.entries(rules).map(([k, r]) => [k, r.round_up_minor])
      )
    ).toEqual({
      card: 1,
      ach: 1,
      apple_pay: 1,
      google_pay: 1,
      paypal: undefined,
      venmo: undefined,
      daf: 100,
      crypto: undefined,
    });
  });

  test("a daf gift's fee lands the total on a whole dollar, as the published rule of 100 says", async () => {
    const { daf } = await rule_of();
    expect(daf.round_up_minor).toBe(100);
    // whole-dollar gifts (daf takes no other), totals worked by hand at the
    // daf's 0.029: 100 + 2.99 up to 103.00, 10 + 0.30 up to 11.00,
    // 250 + 7.47 up to 258.00, 1000 + 29.87 up to 1030.00
    expect(checkout_fee("daf", 100)).toBe(300);
    expect(checkout_fee("daf", 10)).toBe(100);
    expect(checkout_fee("daf", 250)).toBe(800);
    expect(checkout_fee("daf", 1000)).toBe(3000);
    // the rule holds for gifts the worked examples don't spell out: the total
    // is a whole dollar, at or above gift + formula and less than a dollar over
    for (const usd of [1, 7, 33, 250, 999]) {
      const gift_minor = Math.round(usd * 100);
      const total = gift_minor + checkout_fee("daf", usd);
      const unrounded = gift_minor + documented_fee(daf, gift_minor);
      expect(total % 100, `${usd} whole dollar`).toBe(0);
      expect(total, `${usd} not below gift + fee`).toBeGreaterThanOrEqual(
        unrounded - 1e-6
      );
      expect(total, `${usd} under a dollar over`).toBeLessThan(unrounded + 100);
    }
  });

  test("the example in the description: 0.029 and 30 on a 10000-cent gift is 329.6, 330 rounded up and 329 truncated", () => {
    const rule = { percent: 0.029, fixed_minor: 30 };
    expect(documented_fee(rule, 10_000)).toBeCloseTo(329.6, 1);
    const terms = { rate: 0.029, flat: 0.3 };
    expect(
      donation_amounts(
        {
          amount: 100,
          tip_format: "none",
          tip: "",
          cover_processing_fee: true,
        },
        2,
        terms
      ).fee_allowance * 100
    ).toBe(330);
    expect(Math.round(+rd(min_fee_allowance(100, 0.029, 0.3), 2) * 100)).toBe(
      329
    );
    const { description } =
      doc.components.schemas.PartnerReadiness.properties.fee_rules.properties
        .card;
    expect(description).toContain("(290 + 30) / 0.971 ≈ 329.6");
    expect(description).toContain(
      "330 with round_up_minor 1, or 329 when truncated"
    );
  });
});

describe("wire_schema", () => {
  test("keeps both patterns of a two-regex string", () => {
    const [, segment] = (wire_schema(npo_ref) as { anyOf: object[] }).anyOf;
    expect(segment).toMatchObject({
      type: "string",
      maxLength: 30,
      pattern: "^(?!^\\d+$)",
      allOf: [{ pattern: "^[a-zA-Z0-9-._~]+$" }],
    });
  });
});
