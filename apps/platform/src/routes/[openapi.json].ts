import type { LoaderFunctionArgs } from "react-router";
import { openapi_doc } from "$/openapi/spec";

export function loader({ url }: LoaderFunctionArgs) {
  const { origin } = url;
  return Response.json(openapi_doc(origin), {
    headers: {
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
