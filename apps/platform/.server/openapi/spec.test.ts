import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import { reset_rate_limits } from "#/.server/auth/rate-limit";
import { API_ERROR_STATUS } from "@/helpers/api-error";
import { npo_ref, npos_search, reg_number } from "@/npo/schema";
import { CONNECTOR_ACTIONS } from "../connector/actions";
import {
  BODY_KEYS,
  EXPECTED_VERSION,
  exchange_body,
  QUERY_PARAMS,
} from "../connector/inputs";
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
const route_source = (id: string) =>
  readFileSync(new URL(`${id}.ts`, ROUTES_DIR), "utf8");

/** route ids under the documented prefixes: a file's name without its
 * extension, or a folder route's name */
const api_route_ids = () =>
  readdirSync(ROUTES_DIR, { withFileTypes: true })
    .filter((e) => /^(api|connector\.v1)\./.test(e.name))
    .filter((e) => !/\.test\.tsx?$/.test(e.name))
    .map((e) => (e.isDirectory() ? e.name : e.name.replace(/\.tsx?$/, "")));

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

  test("valibot-validated inputs are the schema the route parses", () => {
    const query = wire_schema(npos_search) as {
      properties: Record<string, unknown>;
    };
    expect(
      Object.fromEntries(
        params_in("search_nonprofits", "query").map((p) => [p.name, p.schema])
      )
    ).toEqual(query.properties);
    expect(route_source("api.npos._index")).toMatch(/safeParse\(npos_search,/);

    expect(params_in("get_nonprofit", "path")[0].schema).toEqual(
      wire_schema(npo_ref)
    );
    expect(route_source("api.npos.$id")).toMatch(/safeParse\(npo_ref,/);

    expect(params_in("get_nonprofit_by_ein", "path")[0].schema).toEqual(
      wire_schema(reg_number)
    );
    expect(route_source("api.npos.ein.$id")).toMatch(/safeParse\(reg_number,/);

    expect(
      op_of("exchange").requestBody?.content["application/json"].schema
    ).toEqual(wire_schema(exchange_body));
    expect(route_source("connector.v1.exchange")).toMatch(
      /safeParse\(exchange_body,/
    );
  });

  test("connector query and body keys are the sets the handlers refuse against", () => {
    const sources = readdirSync(CONNECTOR_DIR)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => readFileSync(new URL(f, CONNECTOR_DIR), "utf8"))
      .join("\n");
    for (const [action, keys] of Object.entries(QUERY_PARAMS)) {
      expect(
        params_in(action, "query").map((p) => p.name),
        action
      ).toEqual([...keys]);
      expect(sources, action).toContain(`QUERY_PARAMS.${action},`);
    }
    for (const [action, keys] of Object.entries(BODY_KEYS)) {
      const schema = op_of(action).requestBody?.content["application/json"]
        .schema as { properties: object; additionalProperties: boolean };
      expect(Object.keys(schema.properties), action).toEqual([...keys]);
      expect(schema.additionalProperties, action).toBe(false);
      expect(sources, action).toMatch(
        new RegExp(`_keys\\((parsed\\.)?body, BODY_KEYS\\.${action},`)
      );
    }
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
