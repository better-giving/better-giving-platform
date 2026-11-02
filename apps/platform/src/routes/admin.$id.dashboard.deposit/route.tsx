import type { MetaFunction } from "react-router";
import { DepositForm } from "#/pages/admin/shared/deposit-form";
import { use_admin_data } from "#/pages/admin/use-admin-data";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";

export const meta: MetaFunction = ({ matches }) =>
  admin_page_meta("Deposit funds", matches);

export default function Page() {
  const data = use_admin_data();
  // format NPO name for memo: replace spaces with underscores, uppercase
  const npo_name = (data?.endow.name ?? "")
    .toUpperCase()
    .replace(/\s+/g, "_")
    .slice(0, 30);
  const npo_id = String(data?.id ?? "");

  // no account_type passed - shows selector radio buttons
  return <DepositForm npo_name={npo_name} npo_id={npo_id} />;
}
