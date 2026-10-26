// react-router framework client entry — path is fixed at `src/entry.client.tsx`.
// rr discovers it via convention; default export not required, the module body
// runs at hydration time. only `import.meta.env.VITE_*` vars are exposed to
// client code (vite inlines them at build); other process.env values are not
// available here.
// docs:
//   rr entry.client:  https://reactrouter.com/api/framework-conventions/entry.client.tsx
//   vite client env:  https://vite.dev/guide/env-and-mode
//   sentry browser:   https://docs.sentry.io/platforms/javascript/guides/react-router/
import * as Sentry from "@sentry/react-router";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { client_integrations } from "#/errors/integrations";
import { redact } from "#/errors/redact";
import { report_error, report_unhandled } from "#/errors/report";

// only report from prod — preview/dev noise drowns out real signal.
const stage = import.meta.env.VITE_STAGE;
const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn && stage === "production") {
  Sentry.init({
    dsn,
    environment: stage,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // the request url, breadcrumbs and messages can all carry a page's path
    beforeSend: (event) => redact(event),
    integrations: client_integrations,
  });

  window.addEventListener("unhandledrejection", (e) => {
    report_unhandled(e.reason);
  });
  window.addEventListener("error", (e) => {
    report_error(e.error ?? e.message, {
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
    });
  });
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>
  );
});
