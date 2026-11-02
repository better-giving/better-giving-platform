import { ArrowDownToLine } from "lucide-react";
import { Outlet, useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { CsvExporter } from "#/components/csv-exporter";
import { use_table } from "#/hooks/use-table";
import type { TStatus } from "@/donations";
import type { Route } from "./+types/route";
import type { IRow } from "./helpers";
import { StatusFilter } from "./status-filter";
import { Table } from "./table";

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

export { ErrorBoundary } from "#/components/error";

const csv_headers: { key: keyof IRow; label: string }[] = [
  { key: "id", label: "id" },
  { key: "date", label: "date" },
  { key: "status", label: "status" },
  { key: "recipient_name", label: "recipient" },
  { key: "recipient_id", label: "recipient id" },
  { key: "program_name", label: "program" },
  { key: "program_id", label: "program id" },
  { key: "currency", label: "currency" },
  { key: "amount", label: "amount" },
  { key: "usd_value", label: "usd value" },
  { key: "payment_method", label: "payment method" },
  { key: "frequency", label: "frequency" },
];

export default CacheRoute(Donations);
function Donations({ loaderData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const { user, ...page1 } = loaderData;
  // set by the status filter; the table needs it to tell an account with no
  // donations from a filter that matched none.
  const status = params.get("status") as TStatus | null;
  const { node, items } = use_table({
    table: (props) => <Table {...props} status={status ?? undefined} />,
    classes: "mt-2",
    page1,
    gen_loader: (load, next) => () => {
      const copy = new URLSearchParams(params);
      if (next) copy.set("next", next.toString());
      load(`?index&${copy.toString()}`);
    },
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <StatusFilter />
        <CsvExporter
          label="Export CSV"
          classes="btn btn-secondary"
          headers={csv_headers}
          data={items}
          filename="my_donations.csv"
        >
          <ArrowDownToLine className="icon-md" />
          Export CSV
        </CsvExporter>
      </div>
      <div className="table-scroll">
        <Outlet />
        {node}
      </div>
    </>
  );
}
