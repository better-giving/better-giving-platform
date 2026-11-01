import { beforeEach, describe, expect, test, vi } from "vitest";
import { reset_rate_limits } from "#/.server/auth/rate-limit";
import { operations } from "./spec";

vi.mock("#/.server/npos", () => ({
  search_npos: async () => ({ items: [], page: 1, pages: 1 }),
}));
vi.mock("$/pg/queries/npo", () => ({
  npo_get: async () => null,
  npo_by_slug: async () => null,
  npo_by_regnum: async () => null,
  npo_public: (x: unknown) => x,
  NPO_PUBLIC_KEYS: [],
}));
vi.mock("#/errors/report", () => ({ report_error: vi.fn() }));

const { loader: npos_loader } = await import("#/routes/api.npos._index");
const { loader: npo_loader } = await import("#/routes/api.npos.$id");
const { loader: ein_loader } = await import("#/routes/api.npos.ein.$id");
const { action: exchange } = await import("#/routes/connector.v1.exchange");

type Schema = {
  type?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  allOf?: Schema[];
  anyOf?: Schema[];
};

/** the keywords the spec's input schemas use; a new one throws, so the guard
 * can't go quietly blind */
function spec_accepts(schema: Schema, value: string): boolean {
  const { type, minLength, maxLength, pattern, allOf, anyOf, ...rest } = schema;
  expect(Object.keys(rest), "unmodelled schema keyword").toEqual([]);
  if (type && type !== "string") throw new Error(`unmodelled type ${type}`);
  if (minLength !== undefined && value.length < minLength) return false;
  if (maxLength !== undefined && value.length > maxLength) return false;
  if (pattern && !new RegExp(pattern).test(value)) return false;
  if (allOf && !allOf.every((s) => spec_accepts(s, value))) return false;
  if (anyOf && !anyOf.some((s) => spec_accepts(s, value))) return false;
  return true;
}

const op = (id: string) => {
  const found = operations().find((o) => o.op.operationId === id);
  if (!found) throw new Error(`no operation ${id}`);
  return found.op as {
    parameters?: { name: string; in: string; schema: Schema }[];
    requestBody?: { content: Record<string, { schema: Schema }> };
  };
};
const path_schema = (id: string) =>
  (op(id).parameters ?? []).find((p) => p.in === "path")!.schema;

const args = (path: string, id?: string) =>
  ({ request: new Request(`https://bg.test${path}`), params: { id } }) as never;

const json_of = async (res: Response | Promise<Response>) => {
  const r = await res;
  return [r.status, (await r.json()) as { error?: { code: string } }] as const;
};

beforeEach(() => reset_rate_limits());

describe("a public input the spec documents is the one its route enforces", () => {
  // each literal is one the route is known to answer; the spec schema must
  // draw the same line
  test.each([
    { id: "12345", ok: true },
    { id: "12-345", ok: false },
  ])("get_nonprofit_by_ein: $id", async ({ id, ok }) => {
    const [status, body] = await json_of(
      ein_loader(args(`/api/npos/ein/${id}`, id))
    );
    expect(spec_accepts(path_schema("get_nonprofit_by_ein"), id)).toBe(ok);
    expect(status === 400 && body.error?.code === "invalid_request").toBe(!ok);
  });

  test("get_nonprofit: the slug branch is letters, numbers and - . _ ~ up to 30, not all digits", async () => {
    // the spec's first branch is a bare string (the integer id as it arrives),
    // which accepts anything, so the slug branch is the one that can disagree
    const [as_int, as_slug] = path_schema("get_nonprofit").anyOf!;
    expect(as_int).toEqual({ type: "string" });
    const probes = [
      { id: "my-slug_1.x~", ok: true },
      { id: "a".repeat(30), ok: true },
      { id: "a".repeat(31), ok: false },
      { id: "has space", ok: false },
      { id: "a/b", ok: false },
    ];
    for (const { id, ok } of probes) {
      const [status, body] = await json_of(
        npo_loader(args(`/api/npos/${encodeURIComponent(id)}`, id))
      );
      expect(spec_accepts(as_slug, id), id).toBe(ok);
      expect(status === 400 && body.error?.code === "invalid_request", id).toBe(
        !ok
      );
    }
    // a positive integer is an id; the spec documents the string it arrives as
    expect((await npo_loader(args("/api/npos/42", "42"))).status).toBe(404);
  });

  test("search_nonprofits: every documented parameter is read, and a bad value on a validated one is refused", async () => {
    const refused = {
      page: "0",
      endow_designation: "nope",
      sdgs: "999",
      fields: "nope",
    };
    const free = ["query", "countries", "kyc_only", "fund_opt_in", "published"];
    const documented = (op("search_nonprofits").parameters ?? [])
      .filter((p) => p.in === "query")
      .map((p) => p.name);
    expect([...documented].sort()).toEqual(
      [...Object.keys(refused), ...free].sort()
    );

    for (const [name, value] of Object.entries(refused)) {
      const [status, body] = await json_of(
        npos_loader(args(`/api/npos?${name}=${value}`))
      );
      expect([status, body.error?.code], name).toEqual([
        400,
        "invalid_request",
      ]);
    }
    for (const name of free) {
      const res = await npos_loader(args(`/api/npos?${name}=a`));
      expect(res.status, name).toBe(200);
    }
  });

  test("exchange: a body without a string code is refused", async () => {
    const schema = op("exchange").requestBody?.content["application/json"]
      .schema as { required: string[]; properties: { code: Schema } };
    expect(schema.required).toEqual(["code"]);
    for (const body of ["{}", '{"code":5}', "not json"]) {
      const res = await exchange({
        request: new Request("https://bg.test/connector/v1/exchange", {
          method: "POST",
          body,
          headers: { "x-forwarded-for": "203.0.113.9" },
        }),
        params: {},
        context: {},
      } as never);
      const json = await res.json();
      expect([res.status, json.code], body).toEqual([400, "code_invalid"]);
    }
  });
});
