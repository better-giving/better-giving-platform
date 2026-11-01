import type { LoaderFunctionArgs } from "react-router";

const CONTENT_TYPE =
  'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';

/** RFC 9727: one linkset entry per API, each pointing at its machine-readable
 * description and its human guide */
export function loader({ request }: LoaderFunctionArgs) {
  const { origin } = new URL(request.url);
  const links = {
    "service-desc": [
      { href: `${origin}/openapi.json`, type: "application/json" },
    ],
    "service-doc": [{ href: `${origin}/agents`, type: "text/markdown" }],
  };
  return Response.json(
    {
      linkset: [
        { anchor: `${origin}/api`, ...links },
        { anchor: `${origin}/connector/v1`, ...links },
      ],
    },
    {
      headers: {
        "content-type": CONTENT_TYPE,
        "cache-control": "public, max-age=300",
        "access-control-allow-origin": "*",
        link: `<${origin}/.well-known/api-catalog>; rel="api-catalog"`,
      },
    }
  );
}
