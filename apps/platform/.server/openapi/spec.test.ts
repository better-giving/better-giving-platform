import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import { reset_rate_limits } from "#/.server/auth/rate-limit";
import { API_ERROR_STATUS } from "@/helpers/api-error";
import { npo_ref } from "@/npo/schema";
import { CONNECTOR_ACTIONS } from "../connector/actions";
import { BODY_KEYS, EXPECTED_VERSION, QUERY_PARAMS } from "../connector/inputs";
import { PROBLEM_CODES } from "../connector/problem";
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

/** operations whose route answers every request it serves, so only a throw
 * (the 500) is an error; the public-source test below confirms they send no
 * 4xx `api_error` */
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

  test("each public operation is a GET its route's loader serves", async () => {
    for (const o of operations().filter((x) => x.route.startsWith("api."))) {
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

  test("error code enums are the codes the routes send", () => {
    const { ApiError, ConnectorProblem } = doc.components.schemas;
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

  test("every error response is a component carrying its surface's error schema", () => {
    const { responses } = doc.components as {
      responses: Record<string, { content: Record<string, { schema: Json }> }>;
    };
    for (const o of operations()) {
      const [media, schema] = o.route.startsWith("api.")
        ? ["application/json", "ApiError"]
        : ["application/problem+json", "ConnectorProblem"];
      for (const [status, res] of Object.entries(o.op.responses as Json)) {
        if (Number(status) < 400) continue;
        const label = `${o.op.operationId} ${status}`;
        const $ref = (res as { $ref?: string }).$ref ?? "";
        expect($ref, label).toMatch(/^#\/components\/responses\//);
        const component = responses[$ref.split("/").at(-1) ?? ""];
        expect(component?.content, label).toEqual({
          [media]: { schema: { $ref: `#/components/schemas/${schema}` } },
        });
      }
    }
  });

  test("a public operation's 4xx are the api_error codes its route sends", () => {
    for (const o of operations().filter((x) => x.route.startsWith("api."))) {
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
