import { Button } from "@better-giving/ui";
import { CircleAlert } from "lucide-react";
import type { MetaFunction } from "react-router";
import { useFetcher, useParams } from "react-router";
import { admin_ctx } from "#/.server/auth";
import { redirectWithSuccess } from "#/.server/toast";
import { RouteModal } from "#/components/route-modal";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import { resp } from "@/helpers/https";
import { form_get, form_update } from "$/pg/queries/form";

export { ErrorModal as ErrorBoundary } from "#/components/error";

export const action = async (x: {
  params: { form_id?: string };
  context: { get: (key: typeof admin_ctx) => number };
}) => {
  const { form_id } = x.params;
  if (!form_id) throw resp.status(400, "form_id required");

  const form = await form_get(form_id);
  if (!form) throw resp.status(404, "form not found");

  const npo_id = x.context.get(admin_ctx);
  if (form.owner_npo_id !== npo_id) throw resp.status(403, "not authorized");

  await form_update(form_id, { status: "inactive" });
  return redirectWithSuccess("..", "Form deactivated");
};

// keyed, so the modal shell reads the submission Content makes
const fetcher_key = "disable-form";

export const meta: MetaFunction = ({ matches }) =>
  admin_page_meta("Disable form", matches);

export default function DisablePrompt() {
  const fetcher = useFetcher({ key: fetcher_key });
  return (
    <RouteModal
      title="Disable form"
      busy={fetcher.state !== "idle"}
      classes="grid content-start justify-items-center bg-card"
    >
      <Content />
    </RouteModal>
  );
}

function Content() {
  const { form_id } = useParams();
  const fetcher = useFetcher({ key: fetcher_key });
  const is_submitting = fetcher.state !== "idle";

  return (
    <>
      <div className="relative w-full">
        <p className="sm:text-xl font-bold text-center border-b border-hairline bg-gray-3 p-5">
          Disable form
        </p>
      </div>
      <CircleAlert className="mt-6 text-destructive pictogram-lg" />
      <div className="p-6 text-center text-gray-11">
        Are you sure you want to disable this form? It will no longer accept
        donations.
      </div>
      <fetcher.Form method="POST" className="actions actions-band">
        <input type="hidden" name="form_id" value={form_id} />
        <Button variant="secondary" nav to=".." disabled={is_submitting}>
          Cancel
        </Button>
        <Button variant="destructive" type="submit" is_loading={is_submitting}>
          Proceed
        </Button>
      </fetcher.Form>
    </>
  );
}
