import { describe, expect, test } from "vitest";
import { sources_of } from "./conformance/walk";

/** a page module's loader/action signals a refusal by throwing `resp.status(…)`
 *  so the route's ErrorBoundary renders it. a `return` hands the Response to the
 *  fetcher/loaderData as data, where the page treats it as success. resource
 *  routes (no default export) answer a bare client, so they return. */

const P = "apps/platform/src/";
const EXEMPT = new Set([`${P}routes/_helpers/validate-api-key.ts`]);

const corpus = new Map(
  sources_of(import.meta.url, (t) =>
    t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  )
    .filter((s) => s.file.startsWith(P) && /\.tsx?$/.test(s.file))
    .map((s) => [s.file, s.text])
);

const in_scope = (f: string) =>
  f.startsWith(`${P}routes/`) || f.startsWith(`${P}pages/`);
const has_default = (t: string) =>
  /^export\s+default\b|^export\s*\{[^}]*\bas\s+default\b/m.test(t);

const dirname = (f: string) => f.slice(0, f.lastIndexOf("/"));
function normalize(path: string) {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "..") out.pop();
    else if (seg !== ".") out.push(seg);
  }
  return out.join("/");
}
function resolve_import(from: string, spec: string): string | undefined {
  let base: string;
  if (spec.startsWith("#/")) base = P + spec.slice(2);
  else if (spec.startsWith(".")) base = normalize(`${dirname(from)}/${spec}`);
  else return undefined;
  return [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    base,
  ].find((c) => corpus.has(c));
}
const IMPORT_RE = /(?:from|import\()\s*["']([^"']+)["']/g;

/** every routes/pages module a page module (default export) reaches */
function page_graph() {
  const seen = new Set<string>();
  const stack = [...corpus]
    .filter(([f, t]) => f.startsWith(`${P}routes/`) && has_default(t))
    .map(([f]) => f);
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const m of corpus.get(f)!.matchAll(IMPORT_RE)) {
      const r = resolve_import(f, m[1]);
      if (r && in_scope(r) && !seen.has(r)) stack.push(r);
    }
  }
  return seen;
}

// each matcher stops at the first `;`, so a trailing comment after the
// returned statement can't let it reach a later throw's status
const RETURNED_REFUSAL = [
  /\breturn\s+resp\.status\(/,
  // a `new Response(…)` return whose init carries a 4xx/5xx status
  /\breturn\s+new Response\([^;]*?status:\s*[45]\d\d\b/m,
  // `Response.json(…, { status })`. react-router's `data(…, { status })` is
  // absent on purpose: it is the action-data error pages read off `props.error`
  /\breturn\s+Response\.json\([^;]*?status:\s*[45]\d\d\b/m,
  // `resp.err` always answers an error; `resp.json`/`resp.txt` take the status
  // as a bare numeric arg. `resp.fail` is absent on purpose: a tagged json the
  // client reads off `fetcher.data`
  /\breturn\s+resp\.err\(/,
  /\breturn\s+resp\.(?:json|txt)\([^;]*?,\s*[45]\d\d\s*[,)]/m,
  // a plain object shaped like one: a 200 nobody reads
  /\breturn\s+\{\s*status:\s*[45]\d\d\b/,
];
const returns_refusal = (text: string) =>
  RETURNED_REFUSAL.some((re) => re.test(text));

describe("page modules throw refusals, never return them", () => {
  const files = [...page_graph()].filter((f) => !EXEMPT.has(f)).sort();

  test("the walk reaches the page modules and the pages/** modules they import", () => {
    expect(files).toContain(`${P}routes/admin.$id.organization/api.ts`);
    expect(files).toContain(`${P}pages/admin/endow-update-action.ts`);
    expect(files).not.toContain(`${P}routes/api.paypal-webhook/route.ts`);
  });

  test("the matcher flags a returned refusal and passes a thrown one", () => {
    expect(returns_refusal(`if (!x) return resp.status(404);`)).toBe(true);
    expect(
      returns_refusal(`return new Response("no", {\n status: 404,\n});`)
    ).toBe(true);
    expect(returns_refusal(`if (!x) return { status: 404 };`)).toBe(true);
    expect(
      returns_refusal(`return { status: 400, statusText: "not member" };`)
    ).toBe(true);
    expect(returns_refusal(`if (!x) throw resp.status(404);`)).toBe(false);
    expect(
      returns_refusal(
        `return new Response("ok", { status: 200 }); // success\nthrow new Response("no", { status: 404 });`
      )
    ).toBe(false);
    expect(
      returns_refusal(
        `return Response.json(x); // ok\nthrow Response.json(y, { status: 404 });`
      )
    ).toBe(false);
    expect(
      returns_refusal(`return resp.json(x); // ok\nthrow resp.txt("n", 404);`)
    ).toBe(false);
    expect(
      returns_refusal(`return Response.json({ a: 1 }, { status: 403 });`)
    ).toBe(true);
    expect(
      returns_refusal(`return Response.json(\n{ a: 1 },\n{ status: 500 }\n);`)
    ).toBe(true);
    expect(returns_refusal(`throw Response.json({}, { status: 403 });`)).toBe(
      false
    );
    expect(returns_refusal(`return Response.json({ ok: true });`)).toBe(false);
    expect(returns_refusal(`return data({ e: 1 }, { status: 422 });`)).toBe(
      false
    );
    expect(returns_refusal(`return data(\n x,\n { status: 400 }\n);`)).toBe(
      false
    );
    expect(returns_refusal(`return data(page);`)).toBe(false);
    expect(returns_refusal(`return resp.txt("no", 400);`)).toBe(true);
    expect(returns_refusal(`return resp.txt(\n"no",\n409\n);`)).toBe(true);
    expect(returns_refusal(`return resp.json({ e: 1 }, 500);`)).toBe(true);
    expect(returns_refusal(`return resp.err(400, "no");`)).toBe(true);
    expect(returns_refusal(`throw resp.txt("no", 400);`)).toBe(false);
    expect(returns_refusal(`throw resp.err(400, "no");`)).toBe(false);
    expect(returns_refusal(`return resp.txt("ok");`)).toBe(false);
    expect(returns_refusal(`return resp.json(x, 200, { a: "b" });`)).toBe(
      false
    );
    expect(returns_refusal(`return resp.fail(400, "bad");`)).toBe(false);
    expect(returns_refusal(`return new Response("ok", { status: 200 });`)).toBe(
      false
    );
  });

  test("no loader/action returns a 4xx/5xx Response", () => {
    const offenders = files.filter((f) => returns_refusal(corpus.get(f)!));
    expect(offenders).toEqual([]);
  });
});
