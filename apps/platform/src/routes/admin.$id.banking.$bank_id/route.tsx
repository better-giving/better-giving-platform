import { ExtLink } from "@better-giving/ui";
import { CircleAlert, SquareArrowOutUpRight } from "lucide-react";
import type { PropsWithChildren } from "react";
import { NavLink, Outlet, useFetcher } from "react-router";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import type { Route } from "./+types/route";

export { ErrorBoundary } from "#/components/error";
export { default_action as action, loader } from "./api";

export const meta: Route.MetaFunction = ({ matches, loaderData }) =>
  admin_page_meta(loaderData?.ba.bank_summary || "Bank account", matches);

export default function Page({ loaderData: d }: Route.ComponentProps) {
  const fetcher = useFetcher();

  const is_rejected = d.ba.status === "rejected";
  const is_approved = d.ba.status === "approved";
  const prev_verdict = is_rejected || is_approved;
  const is_default = d.ba.status === "default";

  return (
    <div className="grid px-6 py-4 md:px-10 md:py-8">
      {/** render success and delete prompt */}
      <Outlet />
      <div className="flex items-center gap-2">
        {prev_verdict && (
          <div
            className={`${
              is_approved ? "bg-success" : "bg-destructive"
            } ${is_approved ? "text-success-fg" : "text-destructive-fg"} px-2 py-1 text-xs uppercase rounded inline-block`}
          >
            {is_approved ? "Approved" : "Rejected"}
          </div>
        )}
        {is_default && (
          <div className="bg-primary text-primary-fg px-2 py-1 text-xs uppercase rounded inline-block">
            Default
          </div>
        )}
      </div>

      {is_rejected && (
        <p className="text-sm text-destructive-subtle-fg my-2">
          <CircleAlert className="relative inline bottom-px mr-1" />
          <span>{d.ba.rejection_reason}</span>
        </p>
      )}

      <dl className="grid sm:grid-cols-[auto_auto_1fr] bg-card rounded-card shadow-card mt-2">
        {/* the wise half of the record; the row below it is our own and
            outlives an outage */}
        {!d.wacc_unavailable && (
          <>
            <Row label="Currency">{d.currency}</Row>
            <Row label="Country">{d.country}</Row>
            <Row label="Recipient name">{d.name?.fullName}</Row>
            <Row label="Account type">{d.type}</Row>
            <Row label="Legal entity type">{d.legalEntityType}</Row>
            {d.displayFields?.map(({ label, value, key }) => (
              <Row key={key} label={label}>
                {value}
              </Row>
            ))}
          </>
        )}
        <Row label="Bank statement">
          <ExtLink href={d.ba.bank_statement_url} className="link">
            <span className="break-all">{d.ba.bank_statement_url}</span>
            <SquareArrowOutUpRight className="inline relative bottom-px ml-2 icon-md" />
          </ExtLink>
        </Row>
      </dl>
      {d.wacc_unavailable && (
        <p className="text-sm text-gray-11 mt-2">
          Bank account details couldn't be loaded from Wise. This payout method
          is unchanged — try again shortly.
        </p>
      )}
      <fetcher.Form method="POST" className="actions mt-4">
        <NavLink to={"../banking"} className="min-w-24 btn btn-secondary">
          Back
        </NavLink>
        <NavLink
          replace
          preventScrollReset
          to="delete"
          className="min-w-24 btn btn-destructive"
        >
          Delete
        </NavLink>
        <button
          disabled={
            fetcher.state === "submitting" || is_default || !is_approved
          }
          type="submit"
          className="min-w-24 btn btn-primary"
        >
          {fetcher.state === "submitting" ? "Setting..." : "Set Default"}
        </button>
      </fetcher.Form>
    </div>
  );
}

type Props = PropsWithChildren<{
  label: string;
}>;
function Row(props: Props) {
  return (
    <>
      <dt className="px-3 max-sm:pt-3 sm:p-3 flex items-center text-xs font-semibold uppercase">
        {props.label}
      </dt>
      <div
        aria-hidden={true}
        className="max-sm:hidden w-px border-r border-hairline last:border-none"
      />
      <dd className="px-3 max-sm:pb-3 sm:p-3 flex items-center text-sm">
        {props.children}
      </dd>
      <div
        aria-hidden={true}
        className="h-px col-span-full border-b border-hairline last:border-none"
      />
    </>
  );
}
