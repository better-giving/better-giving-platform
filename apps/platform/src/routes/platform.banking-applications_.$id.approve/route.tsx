import { href, redirect } from "react-router";
import { loader as detail_loader } from "#/pages/platform-admin/banking-applications/api";
import { Prompt } from "#/pages/platform-admin/banking-applications/prompt";
import { is_approvable } from "#/routes/platform.banking-applications_.$id/approvable";
import type { Route } from "./+types/route";

export { action } from "#/pages/platform-admin/banking-applications/api";

/** the detail page disables Approve; this keeps the URL from going around it */
export const loader = async (args: Route.LoaderArgs) => {
  const d = await detail_loader(args);
  if (!is_approvable(d)) {
    throw redirect(
      href("/platform/banking-applications/:id", { id: args.params.id })
    );
  }
  return {
    account_holder: d.account_holder,
    legal_name: d.legal_name,
    holder_match: d.holder_match,
  };
};

export default function Approved({ loaderData: d }: Route.ComponentProps) {
  return (
    <Prompt
      verdict="approved"
      confirm_holder={
        d.holder_match === "mismatch" || d.holder_match === "no_legal_name"
          ? { holder: d.account_holder ?? "", legal_name: d.legal_name ?? "" }
          : undefined
      }
    />
  );
}
export { ErrorModal as ErrorBoundary } from "#/components/error";
