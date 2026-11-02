import type { LoaderFunctionArgs } from "react-router";

/** the homepage as markdown: the same page, rendered by the `Accept:
 * text/markdown` path in entry.server, so the twin cannot drift from it */
export async function loader({ url }: LoaderFunctionArgs) {
  const page = await fetch(new URL("/", url.origin), {
    headers: { accept: "text/markdown" },
    redirect: "manual",
  });
  const type = page.headers.get("content-type") ?? "";
  if (!page.ok || !type.startsWith("text/markdown")) {
    return new Response("The markdown version is unavailable.\n", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(await page.text(), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, s-maxage=60, stale-while-revalidate=86400",
      link: `<${url.origin}/>; rel="canonical"`,
    },
  });
}
