import { ADDRESS, ADDRESS_LINES, EIN, LEGAL_NAME } from "@better-giving/brand";
import { Copier, LoadText } from "@better-giving/ui";
import { CircleCheck } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { href } from "react-router";
import { emails } from "@/constants/common";
import { BackBtn } from "../common/back-btn";
import { use_donation } from "../context";
import {
  type IraQcdDonationDetails,
  is_fund,
  tip_val,
  to_step,
} from "../types";
import { DonationTerms } from "./donation-terms";

export function IraQcdCheckout(props: IraQcdDonationDetails) {
  const { don, don_set } = use_donation();
  const id = don.recipient.id;
  const path = is_fund(id)
    ? href("/campaigns/:fund_id", { fund_id: id })
    : href("/org/:org", { org: id });

  const tipv = tip_val(props.tip_format, props.tip, +props.amount);
  const total = +props.amount + tipv;
  const url = `${don.base_url}${path}`;
  const project = don.config?.campaign_url ?? url;
  const grantee = don.recipient.name;
  const reference = don.config?.campaign_name ?? grantee;

  const instructions_text = [
    `Payee name: ${LEGAL_NAME}`,
    `EIN: ${EIN}`,
    `Mailing address: ${ADDRESS}`,
    `Reference: ${reference}`,
    `Project URL: ${project}`,
    `Amount: $${total.toFixed(2)}`,
    ...(props.custodian ? [`Custodian: ${props.custodian}`] : []),
  ].join("\n");

  const [status, set_status] = useState<"idle" | "loading" | "ok" | "error">(
    "idle"
  );
  /** the server's reason for refusing the custodian, from its 400 */
  const [custodian_err, set_custodian_err] = useState<string>();
  const custodian_err_id = useId();
  const edit_ref = useRef<HTMLButtonElement>(null);
  // the pressed button unmounts with the refusal; land on the way to fix it
  useEffect(() => {
    if (custodian_err) edit_ref.current?.focus();
  }, [custodian_err]);

  return (
    <div className="grid content-start p-4 @xl/steps:p-8">
      <BackBtn
        type="button"
        onClick={() => to_step("ira_qcd", props, "form", don_set)}
      />
      <p className="mt-4 text-center text-gray-11 uppercase">
        IRA Donation Pending
      </p>
      <p className="mt-4 text-center">
        To complete this donation, please provide your IRA custodian with the
        following information.
      </p>

      <div className="grid gap-y-1 rounded bg-gray-3 p-3 text-sm leading-relaxed mt-6">
        <Row label="Payee name" value={LEGAL_NAME} />
        <Row label="EIN" value={EIN} />
        <div>
          <span>Mailing address:</span>
          <span className="block pl-2">
            {LEGAL_NAME}
            {ADDRESS_LINES.map((line) => (
              <Fragment key={line}>
                <br />
                {line}
              </Fragment>
            ))}
          </span>
        </div>
        <Row label="Reference" value={reference} />
        <Row label="Project URL" value={project} />
        <Row label="Amount" value={`$${total.toFixed(2)}`} />
        {props.custodian && <Row label="Custodian" value={props.custodian} />}
      </div>

      <div className="flex justify-center gap-4 mt-6">
        <a
          href={email_link(reference, project, total)}
          className="btn btn-sm btn-secondary font-normal"
        >
          Generate Email
        </a>
        <Copier
          text={instructions_text}
          size={14}
          classes="btn btn-sm btn-secondary font-normal inline-flex items-center gap-1"
        >
          Copy Instructions
        </Copier>
      </div>

      <p className="mt-6 text-sm">
        To ensure quick processing, please let us know when you've submitted
        your IRA request by clicking the button below. Alternatively, please
        copy or forward the email you send to {emails.hi}.
      </p>

      {status === "ok" ? (
        <p className="mt-6 text-sm inline-flex items-center gap-1.5 text-success-subtle-fg">
          <CircleCheck className="icon-md" />
          Thanks! We'll look out for it.
        </p>
      ) : custodian_err ? (
        <div className="mt-6 grid justify-items-start gap-y-3">
          <p
            id={custodian_err_id}
            className="text-sm text-destructive-subtle-fg"
          >
            IRA provider / custodian: {custodian_err}
          </p>
          <button
            ref={edit_ref}
            type="button"
            aria-describedby={custodian_err_id}
            onClick={() => to_step("ira_qcd", props, "form", don_set)}
            className="btn btn-sm btn-secondary font-normal"
          >
            Edit custodian
          </button>
        </div>
      ) : status === "error" ? (
        <p className="mt-6 text-sm text-destructive-subtle-fg">
          Something went wrong. Please email {emails.hi} instead.
        </p>
      ) : (
        <button
          type="button"
          disabled={status === "loading"}
          onClick={async () => {
            set_status("loading");
            try {
              const res = await fetch(href("/api/donation-notifications"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  type: "ira_qcd",
                  recipient_id: id,
                  ...(don.config?.campaign_id
                    ? { campaign_id: don.config.campaign_id }
                    : {}),
                  details: {
                    amount: String(total),
                    ...(props.custodian ? { custodian: props.custodian } : {}),
                  },
                }),
              });
              if (res.status === 400) {
                const body = await res.json().catch(() => null);
                const reason = body?.errors?.custodian;
                if (typeof reason === "string") set_custodian_err(reason);
              }
              set_status(res.ok ? "ok" : "error");
            } catch {
              set_status("error");
            }
          }}
          className="btn btn-primary w-full mt-6"
        >
          <LoadText is_loading={status === "loading"}>
            I've Submitted My IRA Request
          </LoadText>
        </button>
      )}

      <DonationTerms
        endowName={grantee}
        classes="mt-5 border-t border-hairline pt-4"
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-x-2">
      <span className="shrink-0">{label}:</span>
      <span className="break-all">{value}</span>
    </div>
  );
}

const email_link = (
  charity_name: string,
  profile_url: string,
  amount: number
) => {
  const to = encodeURIComponent("[Your IRA custodian's email]");
  const subject = `IRA charitable donation to Better Giving supporting ${charity_name}`;
  const body = [
    "Hi,",
    "",
    `I would like to request a Qualified Charitable Distribution (QCD) from my IRA to support ${charity_name} (${profile_url}).`,
    "",
    "Please use the following information:",
    `Payee name: ${LEGAL_NAME}`,
    `EIN: ${EIN}`,
    `Mailing address: ${ADDRESS}`,
    `Reference: ${charity_name} (${profile_url})`,
    `Amount: $${amount.toFixed(2)}`,
    "",
    `I have copied ${emails.hi} so the donation can be properly recognized and designated. Please let me know if you need any additional information.`,
    "",
    "Thank you.",
  ].join("\r\n");
  return `mailto:${to}?cc=${encodeURIComponent(emails.hi)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};
