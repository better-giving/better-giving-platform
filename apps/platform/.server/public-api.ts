import { report_error } from "#/errors/report";
import { api_error } from "@/helpers/api-error";

/** a public api loader: an unexpected throw is reported and answered as an
 * `internal_error`, never react-router's text/plain 500 or a thrown upstream
 * response passed through to the caller */
export function public_api_route<A extends { request: Request }>(
  handler: (args: A) => Response | Promise<Response>
): (args: A) => Promise<Response> {
  return async (args) => {
    try {
      return await handler(args);
    } catch (err) {
      const { method, url } = args.request;
      // report_error drops a 4xx Response as the caller's fault; a thrown one
      // here is an upstream's answer, so it reaches sentry as an Error. host
      // and path only: an upstream url can carry its api key in the query
      const error = err instanceof Response ? upstream_error(err) : err;
      report_error(error, {
        where: "public-api",
        method,
        path: new URL(url).pathname,
      });
      return api_error(
        "internal_error",
        "Better Giving hit an error and could not complete this request."
      );
    }
  };
}

function upstream_error(res: Response): Error {
  const url = URL.parse(res.url);
  const where = url ? ` ${url.host}${url.pathname}` : "";
  return new Error(`upstream answered ${res.status}${where}`);
}

/** the `action` of a read-only public api route */
export function read_only() {
  return api_error(
    "method_not_allowed",
    "This endpoint answers GET and HEAD only.",
    { allow: "GET, HEAD" }
  );
}
