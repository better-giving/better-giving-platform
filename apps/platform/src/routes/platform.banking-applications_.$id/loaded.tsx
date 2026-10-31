import { Actions, ExtLink } from "@better-giving/ui";
import { SquareArrowOutUpRight } from "lucide-react";
import type { PropsWithChildren } from "react";
import { href, NavLink } from "react-router";
import type { LoaderData } from "#/pages/platform-admin/banking-applications/api";

export function Loaded(props: LoaderData) {
  // "default" is an approved account promoted to the npo's primary one
  const is_approved =
    props.ba.status === "approved" || props.ba.status === "default";
  const is_rejected = props.ba.status === "rejected";
  const prev_verdict = is_approved || is_rejected;

  return (
    <>
      {prev_verdict && (
        <div
          className={`${
            is_approved ? "bg-success" : "bg-destructive"
          } ${is_approved ? "text-success-fg" : "text-destructive-fg"} px-2 py-1 text-xs uppercase rounded justify-self-start -mt-3`}
        >
          {is_approved ? "Approved" : "Rejected"}
        </div>
      )}
      {is_rejected && (
        <p className="text-destructive-subtle-fg text-sm -mt-3">
          {props.ba.rejection_reason}
        </p>
      )}
      <div className="flex max-sm:flex-col gap-x-4">
        <span className="text-sm font-semibold uppercase">Account ID:</span>
        <span className="uppercase text-sm">{props.id}</span>
      </div>
      <div className="flex max-sm:flex-col gap-x-4 -mt-2 lg:-mt-4">
        <span className="text-sm font-semibold uppercase">Date submitted:</span>
        <span className="uppercase text-sm">
          {new Date(props.ba.date_created).toLocaleDateString()}
        </span>
      </div>
      <div className="flex max-sm:flex-col gap-x-4 -mt-2 lg:-mt-4">
        <span className="text-sm font-semibold uppercase">Last updated:</span>
        <span className="uppercase text-sm">
          {new Date(props.ba.updated_at).toLocaleDateString()}
        </span>
      </div>

      <dl className="grid sm:grid-cols-[auto_auto_1fr] bg-card rounded-card shadow-card">
        {/* the wise half of the record; the rows below it are our own and
            outlive an outage */}
        {!props.wacc_unavailable && (
          <>
            <Row label="Currency">{props.currency}</Row>
            <Row label="Country">{props.country}</Row>
            <Row label="Recipient name">{props.name?.fullName}</Row>
            <Row label="Account type">{props.type}</Row>
            <Row label="Legal entity type">{props.legalEntityType}</Row>
            {props.displayFields?.map(({ label, value, key }) => (
              <Row key={key} label={label}>
                {value}
              </Row>
            ))}
          </>
        )}
        <Row label="Bank statement">
          <ExtLink href={props.ba.bank_statement_url} className="link">
            <span className="break-all">{props.ba.bank_statement_url}</span>
            <SquareArrowOutUpRight className="inline relative bottom-px ml-2 icon-md" />
          </ExtLink>
        </Row>
      </dl>
      {props.wacc_unavailable && (
        <p className="text-sm text-gray-11 -mt-2">
          Bank account details couldn't be loaded from Wise, so this application
          can't be approved right now. Everything else on it is up to date.
        </p>
      )}
      <Actions>
        <NavLink
          replace
          preventScrollReset
          to={href("/platform/banking-applications")}
          className="min-w-24 btn btn-secondary"
        >
          Back
        </NavLink>
        <NavLink
          replace
          preventScrollReset
          aria-disabled={!!prev_verdict}
          to="reject"
          className="min-w-24 btn btn-destructive"
        >
          Reject
        </NavLink>
        <NavLink
          replace
          preventScrollReset
          aria-disabled={!!prev_verdict || props.wacc_unavailable}
          to="approve"
          className="min-w-24 btn btn-success"
        >
          Approve
        </NavLink>
      </Actions>
    </>
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
