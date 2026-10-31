import { Button } from "@better-giving/ui";
import { CircleAlert, X } from "lucide-react";
import { NavLink, useFetcher } from "react-router";
import { RouteModal } from "#/components/route-modal";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import type { Route } from "./+types/route";

interface IContent {
  is_default: boolean;
  is_guarded: boolean;
}

export { ErrorModal as ErrorBoundary } from "#/components/error";
export {
  delete_action as action,
  delete_loader as loader,
} from "#/pages/admin/banking/delete-action";

// keyed, so the modal shell reads the submission Content makes
const fetcher_key = "delete-bank";

export const meta: Route.MetaFunction = ({ matches }) =>
  admin_page_meta("Delete payout method", matches);

export default function DeletePrompt({ loaderData }: Route.ComponentProps) {
  const fetcher = useFetcher({ key: fetcher_key });
  return (
    <RouteModal
      title="Delete payout method"
      busy={fetcher.state !== "idle"}
      classes="grid content-start justify-items-center bg-card"
    >
      <Content {...loaderData} />
    </RouteModal>
  );
}

function Content({ is_default, is_guarded }: IContent) {
  const fetcher = useFetcher({ key: fetcher_key });
  const is_submitting = fetcher.state !== "idle";
  const hold = (e: { preventDefault(): void }) => {
    if (is_submitting) e.preventDefault();
  };
  const [canProceed, message] = is_guarded
    ? [false, "Kindly set another payout method as default before deleting"]
    : is_default
      ? [
          true,
          "Your Nonprofit must have at least one banking connection approved in order to receive payouts. Banking connections that are 'Under Review' do not count towards this and are not eligible to receive payouts until approved. Do you want to proceed with this deletion?",
        ]
      : [true, "Are you sure you want to delete this payment method?"];

  return (
    <>
      <div className="relative w-full">
        <p className="sm:text-xl font-bold text-center border-b border-hairline bg-gray-3 p-5">
          Delete payout method
        </p>
        <NavLink
          to=".."
          aria-label="Close"
          aria-disabled={is_submitting}
          onClick={hold}
          className="[.pending]:text-gray-11 border p-2 rounded absolute top-1/2 right-4 transform -translate-y-1/2 aria-disabled:text-gray-11"
        >
          <X className="size-4.5 sm:size-6" />
        </NavLink>
      </div>
      <CircleAlert className="mt-6 text-destructive pictogram-lg" />

      <div className="p-6 text-center text-gray-11">{message}</div>

      {canProceed && (
        <fetcher.Form method="DELETE" className="actions actions-band">
          <Button variant="secondary" nav to=".." disabled={is_submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" is_loading={is_submitting}>
            Proceed
          </Button>
        </fetcher.Form>
      )}
    </>
  );
}
