import { href, redirect } from "react-router";
import { loader as detail_loader } from "#/pages/platform-admin/banking-applications/api";
import { Prompt } from "#/pages/platform-admin/banking-applications/prompt";
import { is_approvable } from "#/routes/platform.banking-applications_.$id/approvable";
import type { Route } from "./+types/route";

export { action } from "#/pages/platform-admin/banking-applications/api";

/** the detail page disables Approve; this keeps the URL from going around it */
export const loader = async (args: Route.LoaderArgs) => {
  if (!is_approvable(await detail_loader(args))) {
    throw redirect(
      href("/platform/banking-applications/:id", { id: args.params.id })
    );
  }
  return null;
};

const Approved = () => <Prompt verdict="approved" />;
export default Approved;
export { ErrorModal as ErrorBoundary } from "#/components/error";
