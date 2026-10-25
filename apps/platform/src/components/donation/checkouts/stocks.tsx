import { EIN, LEGAL_NAME } from "@better-giving/brand";
import { Copier, LoadText } from "@better-giving/ui";
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { href } from "react-router";
import { BROKERAGE, emails } from "@/constants/common";
import { ru_vdec } from "@/helpers/decimal";
import { BackBtn } from "../common/back-btn";
import { use_donation } from "../context";
import {
  is_fund,
  type StocksDonationDetails,
  tip_val,
  to_step,
} from "../types";
import { DonationTerms } from "./donation-terms";

export function Stocks(props: StocksDonationDetails) {
  const { don, don_set } = use_donation();
  const id = don.recipient.id;
  const path = is_fund(id)
    ? href("/campaigns/:fund_id", { fund_id: id })
    : href("/org/:org", { org: id });

  const tipv = tip_val(props.tip_format, props.tip, +props.ticker.amount);
  const shares = ru_vdec(tipv + +props.ticker.amount, props.ticker.usdpu);
  const url = `${don.base_url}${path}`;
  const project = don.config?.campaign_url ?? url;
  const grantee = don.recipient.name;
  const reference = don.config?.campaign_name ?? grantee;

  const instructions_text = [
    `Shares: ${shares}`,
    `Ticker: ${props.ticker.symbol}`,
    `Deliver to: ${BROKERAGE.deliver_to}`,
    `DTC number: ${BROKERAGE.dtc}`,
    `Account number: ${BROKERAGE.account_no}`,
    `Account name: ${LEGAL_NAME}`,
    `Reference: ${reference}`,
    `Project URL: ${project}`,
  ].join("\n");

  const [status, set_status] = useState<"idle" | "loading" | "ok" | "error">(
    "idle"
  );

  return (
    <div className="grid content-start p-4 @xl/steps:p-8">
      <BackBtn
        type="button"
        onClick={() => to_step("stocks", props, "form", don_set)}
      />
      <p className="mt-4 text-center text-gray-11 uppercase">
        Stock Donation Pending
      </p>
      <p className="mt-4 text-center">
        To complete this donation, please provide your broker with the following
        transfer instructions.
      </p>
      <div className="grid gap-y-1 rounded bg-gray-3 p-3 text-sm leading-relaxed mt-6">
        <Row label="Shares" value={shares} />
        <Row label="Ticker" value={props.ticker.symbol} />
        <Row label="Deliver to" value={BROKERAGE.deliver_to} />
        <Row label="DTC number" value={BROKERAGE.dtc} />
        <Row label="Account number" value={BROKERAGE.account_no} />
        <Row label="Account name" value={LEGAL_NAME} />
        <Row label="Reference" value={reference} />
        <Row label="Project URL" value={project} />
      </div>

      <h4 className="text-sm font-medium mt-6 mb-1">
        You may also need the following information
      </h4>
      <span className="rounded bg-gray-3 p-3 text-sm leading-relaxed">
        Better Giving is a nonprofit with 501(c)(3) tax-exempt status. EIN:{" "}
        {EIN}.
      </span>

      <div className="flex justify-center gap-4 mt-6">
        <a
          href={email_link(reference, project, shares, props.ticker.symbol)}
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
        To ensure quick processing, please let us know when you've contacted
        your broker by clicking the button below. Alternatively, please copy or
        forward the email you send to {emails.hi}.
      </p>

      {status === "ok" ? (
        <p className="mt-6 text-sm inline-flex items-center gap-1.5 text-success-subtle-fg">
          <CircleCheck className="icon-md" />
          Thanks! We'll look out for it.
        </p>
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
                  type: "stocks",
                  recipient_id: id,
                  ...(don.config?.campaign_id
                    ? { campaign_id: don.config.campaign_id }
                    : {}),
                  details: {
                    ticker: props.ticker.symbol,
                    shares,
                    amount: String(props.ticker.amount),
                  },
                }),
              });
              set_status(res.ok ? "ok" : "error");
            } catch {
              set_status("error");
            }
          }}
          className="btn btn-primary w-full mt-6"
        >
          <LoadText is_loading={status === "loading"}>
            I've Contacted My Broker
          </LoadText>
        </button>
      )}

      <DonationTerms endowName={grantee} classes="mt-5 border-t pt-4" />
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
  number_of_shares: string,
  stock_symbol: string
) => {
  const to = encodeURIComponent("[Your broker's email]");
  const subject = `Stock donation to Better Giving supporting ${charity_name}`;
  const body = [
    "Hi,",
    "",
    `I would like to make a charitable stock donation to Better Giving in support of ${charity_name} (${profile_url}).`,
    "",
    "Please process the transfer using the following instructions:",
    `Deliver to: ${BROKERAGE.deliver_to}`,
    `DTC number: ${BROKERAGE.dtc}`,
    `Account number: ${BROKERAGE.account_no}`,
    `Account name: ${LEGAL_NAME}`,
    `Reference: ${charity_name} (${profile_url})`,
    `Ticker: ${stock_symbol}`,
    `Shares: ${number_of_shares}`,
    "",
    `Better Giving EIN: ${EIN}`,
    "",
    `I have copied ${emails.hi} so the donation can be properly recognized and designated. Please let me know if you need any additional information.`,
    "",
    "Thank you.",
  ].join("\r\n");
  return `mailto:${to}?cc=${encodeURIComponent(emails.hi)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};
