import { lead_application } from "#/pages/registration/lead-application";
import type { Route } from "./+types/route";

/* `action` only. `meta` runs in the browser, so re-exporting it from here
 * would keep this module — and `lead_application`'s reach into `.server/auth`
 * — in the client graph, and the page would never hydrate. `meta`/`headers`
 * live in `route.tsx`. */
export const action = async ({ request, url }: Route.ActionArgs) =>
  lead_application(request, url, await request.formData());
