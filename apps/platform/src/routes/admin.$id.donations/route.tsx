import { ArrowDownToLine } from "lucide-react";
import { Outlet, useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { CsvExporter } from "#/components/csv-exporter";
import { use_table } from "#/hooks/use-table";
import { use_admin_data } from "#/pages/admin/use-admin-data";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import { default_allocation } from "@/constants/common";
import type { Route } from "./+types/route";
import { Allocation } from "./allocation";
import { DonationsTable } from "./donations-table";
import { type IRow, to_csv_row } from "./helpers";

const csv_headers: {
  key: keyof IRow;
  label: string;
}[] = [
  { key: "id", label: "id" },
  { key: "date", label: "date" },
  { key: "currency", label: "currency" },
  { key: "amount", label: "amount" },
  { key: "amount_usd", label: "usd_value" },
  { key: "net_usd", label: "net_usd" },
  { key: "program_name", label: "program" },
  { key: "payment_method", label: "payment method" },
  { key: "frequency", label: "frequency" },
  { key: "donation_origin", label: "donation origin" },
  { key: "donation_origin_id", label: "form id" },
  { key: "donation_origin_tag", label: "form tag" },
  { key: "donor_name", label: "donor name" },
  { key: "donor_company", label: "donor company" },
  { key: "donor_email", label: "donor email" },
  { key: "street", label: "street" },
  { key: "city", label: "city" },
  { key: "state", label: "state" },
  { key: "zip_code", label: "zip code" },
  { key: "country", label: "country" },
];

export { ErrorBoundary } from "#/components/error";
export { action, loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

export const meta: Route.MetaFunction = ({ matches }) =>
  admin_page_meta("Donations", matches);

export default CacheRoute(Page);
function Page({ loaderData: page1 }: Route.ComponentProps) {
  const [search] = useSearchParams();
  const { node, items } = use_table({
    table: (props) => <DonationsTable {...props} />,
    page1,
    gen_loader: (load, next) => () => {
      const p = new URLSearchParams(search);
      if (next) p.set("next", next);
      load(`?${p.toString()}`);
    },
  });
  const data = use_admin_data();
  return (
    <div className="px-4 py-4 md:px-10 md:py-8 max-w-[1400px]">
      <h1 className="sr-only">Donations</h1>
      <Allocation
        classes="mb-4"
        allocation={data?.endow.allocation ?? default_allocation}
        exporter={
          <CsvExporter
            label="Export CSV"
            classes="btn btn-secondary"
            headers={csv_headers}
            data={items.map<IRow>(to_csv_row)}
            filename="received_donations.csv"
          >
            <ArrowDownToLine className="icon-md" />
            Export CSV
          </CsvExporter>
        }
      />
      {node}
      {/** edit allocation */}
      <Outlet />
    </div>
  );
}
