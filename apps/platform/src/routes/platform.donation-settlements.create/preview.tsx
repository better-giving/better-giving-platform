import { Actions, TabPanel, Tabs } from "@better-giving/ui";
import { CodeIcon, TableIcon } from "lucide-react";
import { humanize } from "@/helpers/decimal";
import type { IFormValues, ISettlementPreview } from "./types";

const LABELS: Record<string, string> = {
  tip: "Tip",
  "base-fee": "Base Fee",
  "fsa-fee": "FSA Fee",
  lock: "Investment",
  liq: "Savings",
};

interface IPreviewProps {
  form: IFormValues;
  /** one per destination — a gift to a fund settles across its nonprofits */
  previews: ISettlementPreview[];
  submitting: boolean;
  error: string | null;
  on_back: () => void;
  on_confirm: () => void;
}

export function Preview({
  form,
  previews,
  submitting,
  error,
  on_back,
  on_confirm,
}: IPreviewProps) {
  const single = previews.length === 1 ? previews[0] : undefined;
  return (
    <div>
      <div className="p-6 sm:p-8">
        <h3 className="text-lg font-bold mb-1">Confirm settlement</h3>
        <p className="text-sm text-gray-11 mb-4">
          Review the records that will be created
        </p>

        {error && (
          <p className="text-xs text-destructive-subtle-fg mb-4">{error}</p>
        )}

        {/* donation */}
        <RecordSection title="Donation">
          <KV label="NPO" value={previews.map((p) => p.npo_name).join(", ")} />
          <KV label="Donor" value={form.donor_name || "Anonymous"} />
          <KV label="Email" value={form.donor_email} />
          <KV label="Reference" value={form.reference} />
        </RecordSection>

        {/* records — one set per destination, headed by name once there is
            more than one to tell apart */}
        {single ? (
          <RecordsTabs preview={single} />
        ) : (
          previews.map((p, idx) => (
            <div key={idx}>
              <h4 className="text-xs font-semibold text-gray-11 uppercase tracking-wide mb-2">
                {p.npo_name}
              </h4>
              <RecordsTabs preview={p} />
            </div>
          ))
        )}
      </div>

      <Actions band>
        <button
          type="button"
          disabled={submitting}
          onClick={on_back}
          className="btn-secondary btn"
        >
          Back
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={on_confirm}
          className="btn btn-primary"
        >
          {submitting ? "Settling..." : "Confirm"}
        </button>
      </Actions>
    </div>
  );
}

const record_tabs = [
  {
    value: "table",
    label: (
      <>
        <TableIcon className="icon-sm" />
        Records
      </>
    ),
  },
  {
    value: "json",
    label: (
      <>
        <CodeIcon className="icon-sm" />
        JSON
      </>
    ),
  },
];

function RecordsTabs({ preview }: { preview: ISettlementPreview }) {
  return (
    <section className="mb-4">
      <Tabs size="sm" items={record_tabs} defaultValue="table">
        <TabPanel value="table" className="mt-3">
          <table className="table w-full">
            <thead>
              <tr>
                <th className="text-left">Name</th>
                <th className="text-right">Details</th>
              </tr>
            </thead>
            <tbody>
              {preview.txs.map((tx, idx) => (
                <TxRow
                  key={idx}
                  tx={tx as Record<string, unknown>}
                  nav_price={preview.nav_price}
                />
              ))}
            </tbody>
          </table>
        </TabPanel>

        <TabPanel value="json" className="mt-3">
          <pre className="text-xs bg-panel rounded p-3 overflow-x-auto max-h-60 overflow-y-auto scrollbars">
            {JSON.stringify(preview.txs, null, 2)}
          </pre>
        </TabPanel>
      </Tabs>
    </section>
  );
}

function TxRow({
  tx,
  nav_price,
}: {
  tx: Record<string, unknown>;
  nav_price: number;
}) {
  const r = tx._record;
  if (r === "distribution") {
    return (
      <tr>
        <td>Distribution</td>
        <td className="text-right figures">${humanize(tx.net as number)}</td>
      </tr>
    );
  }
  if (r === "revenue_log") {
    const type = tx.type as string;
    return (
      <tr>
        <td>Revenue: {LABELS[type] ?? type}</td>
        <td className="text-right figures">
          ${humanize(tx.revenue as number)}
        </td>
      </tr>
    );
  }
  if (r === "commission") {
    return (
      <tr>
        <td>Commission: {(tx.referrer_user ?? tx.referrer_npo) as string}</td>
        <td className="text-right figures">${humanize(tx.amount as number)}</td>
      </tr>
    );
  }
  if (r === "balance_tx") {
    const account = tx.account as string;
    return (
      <tr>
        <td>
          {LABELS[account] ?? account}
          <span className="text-gray-11 ml-1">
            {humanize(tx.bal_begin as number)} →{" "}
            {humanize(tx.bal_end as number)}
          </span>
        </td>
        <td className="text-right figures">
          +${humanize(tx.amount as number)}
          {account === "lock" && (
            <span className="text-gray-11 ml-1">
              ({humanize(tx.amount_units as number, 6)} units @ $
              {humanize(nav_price)}/unit)
            </span>
          )}
        </td>
      </tr>
    );
  }
  if (r === "payout") {
    return (
      <tr>
        <td>Grant</td>
        <td className="text-right figures">${humanize(tx.amount as number)}</td>
      </tr>
    );
  }
  return null;
}

function RecordSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4">
      <h4 className="text-xs font-semibold text-gray-11 uppercase tracking-wide mb-2">
        {title}
      </h4>
      <div className="grid gap-1">{children}</div>
    </section>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 text-sm">
      <span className="text-gray-11 w-20 shrink-0">{label}</span>
      <span>{value}</span>
    </div>
  );
}
