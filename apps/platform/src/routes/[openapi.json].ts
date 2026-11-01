import type { LoaderFunctionArgs } from "react-router";
import { openapi_doc } from "$/openapi/spec";

export function loader({ request }: LoaderFunctionArgs) {
  const { origin } = new URL(request.url);
  return Response.json(openapi_doc(origin), {
    headers: {
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
