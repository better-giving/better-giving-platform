import type { LoaderFunctionArgs } from "react-router";

/**
 * the design registry, served as static text from the files packages/ui
 * generates (`pnpm --filter @better-giving/ui registry:build`). read at build
 * time, so there is no runtime dependency and nothing here to keep in sync.
 */
const files = import.meta.glob("../../../../packages/ui/registry/**", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const prefix = "../../../../packages/ui/registry/";
const by_path = new Map(
  Object.entries(files).map(([k, v]) => [k.slice(prefix.length), v])
);

const types: Record<string, string> = {
  json: "application/json; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
};

export function loader({ params }: LoaderFunctionArgs) {
  const path = params["*"] ?? "";
  const body = by_path.get(path);
  if (body === undefined) return new Response("Not found", { status: 404 });
  return new Response(body, {
    headers: {
      "content-type": types[path.split(".").pop() ?? ""] ?? "text/plain",
      "cache-control": "public, max-age=300, s-maxage=300",
      "access-control-allow-origin": "*",
    },
  });
}
