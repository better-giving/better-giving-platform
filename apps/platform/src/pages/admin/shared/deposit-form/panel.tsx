import { EMAILS } from "@better-giving/brand";
import { Copier, RadioGroup } from "@better-giving/ui";
import { X } from "lucide-react";
import { useState } from "react";

type AccountType = "savings" | "investments";

interface PanelProps {
  /** If not provided, user can select via radio buttons */
  account_type?: AccountType;
  /** NPO name used in reference memo */
  npo_name: string;
  /** NPO ID used in reference memo */
  npo_id: string;
  onClose: () => void;
}

interface AccountSelectorProps {
  value: AccountType;
  onChange: (v: AccountType) => void;
  classes?: string;
}

interface InfoSectionProps {
  title: string;
  children: React.ReactNode;
  classes?: string;
}

interface MemoSectionProps {
  memo: string;
  account_type: AccountType;
  classes?: string;
}

interface InfoRowProps {
  label: string;
  value: string;
  copyable?: boolean;
}

interface InfoRowWithDetailsProps {
  label: string;
  value: string;
  details: string;
}

const BANK_DETAILS = {
  account_name: "Better Giving",
  account_number: "822000812545",
  routing_number: "026073150",
  swift_code: "CMFGUS33",
  account_type: "Checking",
  bank_name: "Community Federal Savings Bank",
  bank_address: "89-16 Jamaica Ave, Woodhaven, NY, 11421, United States",
} as const;

export function Panel({
  account_type: initial_account_type,
  npo_name,
  npo_id,
  onClose,
}: PanelProps) {
  const [account_type, set_account_type] = useState<AccountType>(
    initial_account_type ?? "savings"
  );
  const show_selector = !initial_account_type;

  const account_code = account_type === "savings" ? "S" : "I";
  const memo = `${npo_name}+${npo_id}+${account_code}`;

  return (
    <>
      <div className="p-6 md:p-8 border-b border-hairline relative">
        <h2 className="text-2xl font-bold mb-2">Deposit Funds</h2>
        <p className="text-sm text-gray-11">
          Transfer funds to your Better Giving account
        </p>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute top-6 md:top-8 right-6 md:right-8 p-2 rounded border hover:bg-gray-3 transition-colors"
        >
          <X className="text-gray-11 icon-2xl" />
        </button>
      </div>

      <div className="p-6 md:p-8">
        {show_selector && (
          <AccountSelector
            value={account_type}
            onChange={set_account_type}
            classes="mb-6"
          />
        )}

        <InfoSection title="Bank Account Details" classes="mb-6">
          <InfoRow label="Account name" value={BANK_DETAILS.account_name} />
          <InfoRow label="Account number" value={BANK_DETAILS.account_number} />
          <InfoRow
            label="Account type"
            value={BANK_DETAILS.account_type}
            copyable={false}
          />
          <InfoRow label="Bank name" value={BANK_DETAILS.bank_name} />
          <InfoRow label="Bank address" value={BANK_DETAILS.bank_address} />
        </InfoSection>

        <InfoSection title="Routing Codes" classes="mb-6">
          <InfoRowWithDetails
            label="ACH Routing"
            value={BANK_DETAILS.routing_number}
            details="US domestic transfers · Free · 1-3 business days"
          />
          <InfoRowWithDetails
            label="SWIFT/BIC"
            value={BANK_DETAILS.swift_code}
            details="International transfers · $6.11 fee · 1-5 business days"
          />
        </InfoSection>

        <MemoSection memo={memo} account_type={account_type} classes="mb-6" />

        <p className="text-sm text-gray-11">
          For non-USD transfers, contact{" "}
          <a href={`mailto:${EMAILS.hi}`} className="link underline">
            {EMAILS.hi}
          </a>{" "}
          for specific instructions.
        </p>
      </div>
    </>
  );
}

function AccountSelector({
  value,
  onChange,
  classes = "",
}: AccountSelectorProps) {
  return (
    <RadioGroup
      variant="tile"
      columns={2}
      label="Deposit to"
      value={value}
      onValueChange={onChange}
      className={classes}
      items={[
        { value: "savings", label: "Savings account" },
        { value: "investments", label: "Investments account" },
      ]}
    />
  );
}

function InfoSection({ title, children, classes = "" }: InfoSectionProps) {
  return (
    <div className={`bg-gray-3 rounded p-5 ${classes}`}>
      <h3 className="font-bold mb-4">{title}</h3>
      <div className="grid gap-4">{children}</div>
    </div>
  );
}

function MemoSection({ memo, account_type, classes = "" }: MemoSectionProps) {
  const account_label = account_type === "savings" ? "Savings" : "Investments";
  return (
    <div
      className={`bg-warning-subtle border border-warning rounded p-5 ${classes}`}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-warning-subtle-fg">
          Your Reference Memo
        </h3>
        <span className="text-xs font-medium text-warning-subtle-fg bg-panel px-2 py-1 rounded">
          {account_label}
        </span>
      </div>
      <p className="text-sm text-warning-subtle-fg mb-4">
        You must include this code when making your transfer, or we won't be
        able to identify your deposit.
      </p>
      <div className="bg-panel rounded p-4 border border-warning">
        <div className="flex items-center justify-between gap-4">
          <code className="text-lg font-bold font-mono tracking-wide break-all">
            {memo}
          </code>
          <Copier
            text={memo}
            classes={{
              container:
                "shrink-0 px-4 py-2 text-sm font-semibold text-warning-fg bg-warning hover:bg-warning rounded transition-colors flex items-center gap-2",
            }}
          >
            Copy
          </Copier>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, copyable = true }: InfoRowProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
      <span className="text-sm text-gray-11 min-w-35">{label}</span>
      <div className="flex-1 flex items-center gap-2">
        <span className="text-sm font-semibold text-pretty flex-1">
          {value}
        </span>
        {copyable && (
          <Copier
            text={value}
            classes={{
              container:
                "shrink-0 px-2.5 py-1.5 text-xs text-gray-11 bg-surface border rounded hover:bg-gray-3 transition-colors",
            }}
          />
        )}
      </div>
    </div>
  );
}

function InfoRowWithDetails({
  label,
  value,
  details,
}: InfoRowWithDetailsProps) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 items-start">
      <span className="text-sm text-gray-11">{label}</span>
      <div className="flex items-center gap-2 row-span-2">
        <span className="text-sm font-semibold">{value}</span>
        <Copier
          text={value}
          classes={{
            container:
              "shrink-0 px-2.5 py-1.5 text-xs text-gray-11 bg-surface border rounded hover:bg-gray-3 transition-colors",
          }}
        />
      </div>
      <p className="text-xs text-gray-11 text-pretty">{details}</p>
    </div>
  );
}
