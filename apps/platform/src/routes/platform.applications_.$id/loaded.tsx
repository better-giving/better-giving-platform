import { Actions, ExtLink } from "@better-giving/ui";
import { SquareArrowOutUpRight } from "lucide-react";
import type { PropsWithChildren } from "react";
import { href, NavLink, Outlet } from "react-router";
import type { V2RecipientAccount } from "#/types/bank-details";
import type { IReg } from "@/reg";
import { Container } from "./container";

export default function Loaded(
  props: IReg & {
    bank: V2RecipientAccount | null;
    /** wise was unreachable; the account may still exist */
    bank_unavailable: boolean;
  }
) {
  const prev_verdict =
    props.status === "03"
      ? "approved"
      : props.status === "04"
        ? "rejected"
        : null;

  return (
    <>
      <h3 className="text-lg">{props.o_name}</h3>
      {prev_verdict && (
        <div
          className={`${
            prev_verdict === "approved" ? "bg-success" : "bg-destructive"
          } ${prev_verdict === "approved" ? "text-success-fg" : "text-destructive-fg"} px-2 py-1 text-xs uppercase rounded justify-self-start -mt-3`}
        >
          {prev_verdict === "approved" ? "Approved" : "Rejected"}
        </div>
      )}
      {props.status_approved_npo_id && (
        <NavLink
          className="link [.pending]:text-gray-11 block -mt-4 text-sm"
          to={href("/org/:org", {
            org: props.status_approved_npo_id.toString(),
          })}
        >
          Endowment ID: {props.status_approved_npo_id}
        </NavLink>
      )}
      {props.status_rejected_reason && (
        <div className="flex max-sm:flex-col gap-x-4">
          <span className="text-sm font-semibold uppercase">
            Rejection reason:
          </span>
          <span className="uppercase text-sm">
            {props.status_rejected_reason}
          </span>
        </div>
      )}
      <div className="flex max-sm:flex-col gap-x-4">
        <span className="text-sm font-semibold uppercase">Application ID:</span>
        <span className="text-sm">{props.id}</span>
      </div>
      <div className="flex max-sm:flex-col gap-x-4 -mt-2 lg:-mt-4">
        <span className="text-sm font-semibold uppercase">Date submitted:</span>
        <span className="uppercase text-sm">
          {new Date(props.updated_at).toLocaleDateString()}
        </span>
      </div>

      <Container title="nonprofit application">
        <div className="grid sm:grid-cols-[auto_auto_1fr]">
          {props.o_type === "501c3" ? (
            <Row label="EIN">{props.o_ein}</Row>
          ) : (
            <Row label="Registration No.">{props.o_registration_number}</Row>
          )}
          <Row label="HQ Country">{props.o_hq_country}</Row>
          <Row label="Countries active in">
            {props.o_active_in_countries?.join(", ") ?? "N/A"}
          </Row>
          <Row label="Contact name">
            {`${props.r_first_name} ${props.r_last_name}`}
          </Row>
          <Row label="Contact email">{props.r_id}</Row>
          {props.r_proof_of_identity && (
            <Row label="Contact national ID">
              <DocLink url={props.r_proof_of_identity} />
            </Row>
          )}
          {props.o_proof_of_reg && (
            <Row label="Nonprofit registration doc">
              <DocLink url={props.o_proof_of_reg} />
            </Row>
          )}
          {props.o_fsa_signed_doc_url && (
            <Row label="Fiscal sponsorship agreement">
              <DocLink url={props.o_fsa_signed_doc_url} />
            </Row>
          )}
        </div>
      </Container>
      {props.bank && (
        <Container title="Banking details">
          <dl className="grid sm:grid-cols-[auto_auto_1fr]">
            {props.bank.displayFields.map((f) => (
              <Row key={f.label} label={f.label}>
                {f.value}
              </Row>
            ))}
            <Row label="Bank statement document">
              <DocLink url={props.o_bank_statement ?? "N/A"} />
            </Row>
          </dl>
        </Container>
      )}
      {props.bank_unavailable && (
        <Container title="Banking details">
          <dl className="grid sm:grid-cols-[auto_auto_1fr]">
            {/* our own registration data — it outlives a wise outage */}
            <Row label="Bank statement document">
              <DocLink url={props.o_bank_statement ?? "N/A"} />
            </Row>
          </dl>
          <p className="p-3 text-sm text-gray-11">
            Bank account details couldn't be loaded from Wise.
          </p>
        </Container>
      )}
      <Actions>
        <NavLink
          to={href("/platform/applications")}
          className="min-w-24 btn btn-secondary"
        >
          Back
        </NavLink>
        <NavLink
          aria-disabled={!!prev_verdict}
          to={`rejected?org_name=${props.o_name}`}
          className="min-w-24 btn btn-destructive"
          preventScrollReset
        >
          Reject
        </NavLink>
        <NavLink
          aria-disabled={!!prev_verdict || props.bank_unavailable}
          to={`approved?org_name=${props.o_name}`}
          className="min-w-24 btn btn-success"
          preventScrollReset
        >
          Approve
        </NavLink>
        {/** review route renders here */}
        <Outlet />
      </Actions>
    </>
  );
}

function DocLink({ url }: { url: string }) {
  return (
    <ExtLink href={url} className="link">
      <span className="break-all">{url}</span>
      <SquareArrowOutUpRight className="inline relative bottom-px ml-2 icon-md" />
    </ExtLink>
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
