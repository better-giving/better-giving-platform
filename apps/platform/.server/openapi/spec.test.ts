import { readdirSync, readFileSync } from "node:fs";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { reset_rate_limits } from "#/.server/auth/rate-limit";
import { seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import { API_ERROR_STATUS } from "@/helpers/api-error";
import { npo_ref } from "@/npo/schema";
import { CONNECTOR_ACTIONS } from "../connector/actions";
import { BODY_KEYS, EXPECTED_VERSION, QUERY_PARAMS } from "../connector/inputs";
import { PROBLEM_CODES } from "../connector/problem";
import { mint_key } from "../partner/keys";
import { PROBLEM_CODES as PARTNER_PROBLEM_CODES } from "../partner/problem";
import { RAIL_STATES, RAILS, readiness } from "../partner/readiness";
import { create_test_db } from "../pg/test-utils/pglite";
import { read_only } from "../public-api";
import { EXCLUDED, type IOperation, openapi_doc, operations } from "./spec";
import { wire_schema } from "./wire-schema";

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

beforeEach(() => reset_rate_limits());

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

  test("a partner operation is a keyed GET, and its route refuses every other method as not_found", async () => {
    const partner = of_surface("partner");
    expect(partner.length).toBeGreaterThan(0);
    for (const o of partner) {
      const mod = await route_module(o.route);
      expect(o.method, o.route).toBe("get");
      expect(o.op.security, o.route).toEqual([{ partnerKey: [] }]);
      if (!mod.loader || !mod.action) throw new Error(`${o.route} handlers`);
      const keyless = await call(mod.loader, "get", o.path);
      expect([keyless.status, (await keyless.json()).code]).toEqual([
        401,
        "key_invalid",
      ]);
      const post = await call(mod.action, "post", o.path);
      expect([post.status, (await post.json()).code]).toEqual([
        404,
        "not_found",
      ]);
    }
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

  test("a partner operation's handler answers a throw with its documented 500", () => {
    for (const o of of_surface("partner")) {
      const source = route_source_of(`src/routes/${o.route}.ts`);
      expect(source, o.route).toMatch(/export const loader = partner_route\(/);
    }
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
 * schema doesn't declare is a failure here (the published schema leaves
 * `additionalProperties` open, but a body field it omits is the drift) */
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
      if (!(key in props)) errs.push(`${at}.${key}: not in schema`);
      else errs.push(...schema_errors(props[key], v, `${at}.${key}`));
    }
  }
  return errs;
};

describe("readiness body against the published schema", () => {
  let t: Awaited<ReturnType<typeof create_test_db>>;
  type Db = Parameters<typeof mint_key>[0];
  const as_db = (x: unknown) => x as Db;

  beforeAll(async () => {
    t = await create_test_db();
  }, 30_000);
  afterAll(async () => {
    await t?.client.close();
  });

  const real_body = async () => {
    const staff = (await seed_user(t.db, "ada@test.com"))!;
    const npo = (await seed_npo(t.db, { donate_methods: null }))!;
    await mint_key(as_db(t.db), { npo_id: npo.id, minted_by: staff.id });
    return readiness(as_db(t.db), npo.id);
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
