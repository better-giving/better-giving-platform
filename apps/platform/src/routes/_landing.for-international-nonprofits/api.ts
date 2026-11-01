import { lead_application } from "#/pages/registration/lead-application";
import type { Route } from "./+types/route";

/* `action` only — see the note in `_landing.for-nonprofits/api.ts`. */
export const action = async ({ request, url }: Route.ActionArgs) =>
  lead_application(request, url, await request.formData());
