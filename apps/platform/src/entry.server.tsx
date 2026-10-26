// react-router framework server entry — path is fixed at `src/entry.server.tsx`.
// rr discovers it via convention and calls the default export per request.
// required exports (names matter, rr looks them up):
//   - default: (request, status, headers, routerContext, loadContext) => Response | Promise<Response>
//   - streamTimeout?: number — abort renderToPipeableStream after N ms
//   - handleError?: (error, { request, params, context }) => void — fires on loader/action throws
// runs on the vercel node runtime; full process.env is available (no VITE_ prefix needed).
// vercel auto-injects: VERCEL_ENV, VERCEL_DEPLOYMENT_ID, VERCEL_SKEW_PROTECTION_ENABLED, VERCEL_GIT_COMMIT_SHA.
// docs:
//   rr entry.server:   https://reactrouter.com/api/framework-conventions/entry.server.tsx
//   sentry server:     https://docs.sentry.io/platforms/javascript/guides/react-router/
//   vercel skew prot:  https://vercel.com/docs/skew-protection
//   vercel system env: https://vercel.com/docs/environment-variables/system-environment-variables
import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import * as Sentry from "@sentry/react-router";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import {
  type AppLoadContext,
  type EntryContext,
  ServerRouter,
} from "react-router";
import { redact } from "#/errors/redact";
import { report_error } from "#/errors/report";
import { sentry, stage } from "$/env";

// only report from prod — preview/dev noise drowns out real signal.
if (stage === "production") {
  Sentry.init({
    dsn: sentry.dsn,
    environment: stage,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // the request url, breadcrumbs and messages can all carry a photo-upload token in a page's path
    beforeSend: (event) => redact(event),
  });
}

export const streamTimeout = 5_000;

// skew protection has two layers:
//   1. content-hashed client assets are served from a deploy-independent
//      origin (vercel blob — see vite.config.ts `base` +
//      utils/upload-client-assets.ts), so cached html from a rotated-out
//      deployment never 404s on its js/css/images.
//   2. no .data pinning — loader/action contracts are kept additive-only so
//      old js hitting a newer deployment's loaders is safe without
//      per-request deployment pinning. keeps html cdn-cacheable (no
//      set-cookie).
// docs: https://vercel.com/docs/skew-protection

export default async function handle_request(
  request: Request,
  response_status_code: number,
  response_headers: Headers,
  router_context: EntryContext,
  _load_context: AppLoadContext
) {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: response_status_code,
      headers: response_headers,
    });
  }

  return new Promise((resolve, reject) => {
    let shell_rendered = false;
    const user_agent = request.headers.get("user-agent");

    const ready_option: keyof RenderToPipeableStreamOptions =
      (user_agent && isbot(user_agent)) || router_context.isSpaMode
        ? "onAllReady"
        : "onShellReady";

    let timeout_id: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => abort(),
      streamTimeout + 1000
    );

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={router_context} url={request.url} />,
      {
        [ready_option]() {
          shell_rendered = true;
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeout_id);
              timeout_id = undefined;
              callback();
            },
          });
          const stream = createReadableStreamFromReadable(body);

          response_headers.set("content-type", "text/html");

          resolve(
            new Response(stream, {
              headers: response_headers,
              status: response_status_code,
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          response_status_code = 500;
          if (shell_rendered) {
            report_error(error);
          }
        },
      }
    );
  });
}

// react-router calls handleError for loader/action throws; report_error filters
// out 4xx Responses so only true app errors page sentry.
export function handleError(error: unknown, { request }: { request: Request }) {
  if (request.signal.aborted) return;
  report_error(error, { method: request.method, url: request.url });
}
