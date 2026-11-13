import { Actions, Badge, ExtLink } from "@better-giving/ui";
import { SquareArrowOutUpRight } from "lucide-react";
import type { PropsWithChildren } from "react";
import { href, NavLink } from "react-router";
import { WarningCallout } from "#/components/warning-callout";
import type { LoaderData } from "#/pages/platform-admin/banking-applications/api";
import { is_approvable } from "./approvable";

export function Loaded(props: LoaderData) {
  // "default" is an approved account promoted to the npo's primary one
  const is_approved =
    props.ba.status === "approved" || props.ba.status === "default";
  const is_rejected = props.ba.status === "rejected";
  const prev_verdict = is_approved || is_rejected;
  // the holder callouts ask for a decision; the row badges stay true after
  // one. the own-account callout stays after one too: whatever the verdict,
  // it says why this account must never carry the nonprofit's payouts
  const awaits_verdict = props.ba.status === "under-review";
  // our own account can't be approved, so there's no approval to confirm
  const asks_holder_check = awaits_verdict && !props.own_account;

  return (
    <>
      {prev_verdict && (
        <Badge
          tone={is_approved ? "success" : "destructive"}
          className="justify-self-start -mt-3"
        >
          {is_approved ? "Approved" : "Rejected"}
        </Badge>
      )}
      {is_rejected && (
        <p className="text-destructive-subtle-fg text-sm -mt-3">
          {props.ba.rejection_reason}
        </p>
      )}
      <div className="flex max-sm:flex-col gap-x-4">
        <span className="text-sm font-semibold">Account ID:</span>
        <span className="text-sm">{props.id}</span>
      </div>
      <div className="flex max-sm:flex-col gap-x-4 -mt-2 lg:-mt-4">
        <span className="text-sm font-semibold">Date submitted:</span>
        <span className="text-sm">
          {new Date(props.ba.date_created).toLocaleDateString()}
        </span>
      </div>
      <div className="flex max-sm:flex-col gap-x-4 -mt-2 lg:-mt-4">
        <span className="text-sm font-semibold">Last updated:</span>
        <span className="text-sm">
          {new Date(props.ba.updated_at).toLocaleDateString()}
        </span>
      </div>

      {props.own_account && (
        <WarningCallout title="This is Better Giving's own bank account">
          {prev_verdict
            ? "Payouts to it never reach the nonprofit."
            : "Payouts to it never reach the nonprofit, so it can't be approved."}
        </WarningCallout>
      )}
      {asks_holder_check && props.holder_match === "mismatch" && (
        <WarningCallout title="The account holder doesn't match the legal name">
          This account is held by {closed(props.account_holder ?? "")} The
          nonprofit's legal name is {closed(props.legal_name ?? "")} Approving
          sends its payouts to an account held by someone else, so confirm with
          the nonprofit first.
        </WarningCallout>
      )}
      {asks_holder_check && props.holder_match === "no_legal_name" && (
        <WarningCallout title="No legal name on file">
          We can't check this account's holder against the nonprofit's name.
          Confirm the account holder with the nonprofit first.
        </WarningCallout>
      )}

      <dl className="grid sm:grid-cols-[auto_auto_1fr] bg-card rounded-card border border-hairline">
        {/* the wise half of the record; the rows below it are our own and
            outlive an outage */}
        {!props.wacc_unavailable && (
          <>
            <Row label="Account holder">
              {props.account_holder}
              {props.holder_match === "match" && (
                <Badge tone="success">Matches legal name</Badge>
              )}
              {props.holder_match === "mismatch" && (
                <Badge tone="warning">Doesn't match</Badge>
              )}
              {props.holder_match === "no_legal_name" && (
                <Badge tone="warning">No legal name on file</Badge>
              )}
            </Row>
            <Row label="Nonprofit legal name">
              {props.holder_match === "no_legal_name" ? (
                <span className="text-gray-11">No legal name on file</span>
              ) : (
                props.legal_name
              )}
            </Row>
            <Row label="Currency">{props.currency}</Row>
            <Row label="Country">{props.country}</Row>
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
          Bank account details couldn't be loaded from the payout provider, so
          this application can't be approved right now. Everything else on it is
          up to date.
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
          aria-disabled={!is_approvable(props)}
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
      <dt className="px-3 max-sm:pt-3 sm:p-3 flex items-center text-sm font-semibold text-gray-11">
        {props.label}
      </dt>
      <div
        aria-hidden={true}
        className="max-sm:hidden w-px border-r border-hairline last:border-none"
      />
      <dd className="px-3 max-sm:pb-3 sm:p-3 flex items-center gap-2 flex-wrap text-sm">
        {props.children}
      </dd>
      <div
        aria-hidden={true}
        className="h-px col-span-full border-b border-hairline last:border-none"
      />
    </>
  );
}

/** a name ending a sentence: "Acme Inc." takes no second period */
const closed = (name: string) => (name.endsWith(".") ? name : `${name}.`);
