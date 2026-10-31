import { Button, EmptyRow, ExtLink, LoadMoreRow } from "@better-giving/ui";
import { ArrowDownToLine } from "lucide-react";
import { href, Link } from "react-router";
import { CsvExporter } from "#/components/csv-exporter";
import { Money } from "#/components/money";
import { PaymentResumer } from "#/pages/user-dashboard/donations/payment-resumer";
import type { IPaginator } from "#/types/components";
import { is_reversed, type TStatus } from "@/donations";
import { toPP } from "@/helpers/date";
import { type IRow, status_label, status_text_color } from "./helpers";

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

interface Props extends IPaginator<IRow> {
  /** the active status filter, when one is on. a filtered table that came
   *  back empty says nothing about whether the account has donations. */
  status?: TStatus;
}

export function Table({
  items,
  classes = "",
  disabled,
  loading,
  load_next,
  status,
}: Props) {
  return (
    <div className={classes}>
      <div className="flex items-center justify-end mb-2">
        <CsvExporter
          label="Export my donations as CSV"
          classes="hover:text-primary"
          headers={csv_headers}
          data={items}
          filename="my_donations.csv"
        >
          <ArrowDownToLine className="icon-md" />
        </CsvExporter>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Recipient</th>
            <th>Amount</th>
            <th>Method</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            status ? (
              <EmptyRow col_span={6}>
                No {status_label(status).toLowerCase()} donations found
              </EmptyRow>
            ) : (
              <EmptyRow
                col_span={6}
                heading="No donations yet"
                action={
                  <Button variant="primary" to={href("/marketplace")}>
                    Browse nonprofits
                  </Button>
                }
              >
                Pick a nonprofit and your first donation shows up here.
              </EmptyRow>
            )
          ) : (
            items.map((row) => {
              return (
                <tr key={row.id}>
                  <td>{row.date ? toPP(row.date) : "--"}</td>
                  <td>
                    {row.recipient_type === "npo" ? (
                      <Link
                        to={href("/org/:org", {
                          org: row.recipient_id,
                        })}
                        className="flex items-center justify-between gap-1 link"
                      >
                        <span className="truncate max-w-48">
                          {row.recipient_name}
                        </span>
                      </Link>
                    ) : (
                      <Link
                        to={href("/campaigns/:fund_id", {
                          fund_id: row.recipient_id,
                        })}
                        className="flex items-center justify-between gap-1 link"
                      >
                        <span className="truncate max-w-48">
                          {row.recipient_name}
                        </span>
                      </Link>
                    )}
                    {row.program_id && row.recipient_type === "npo" && (
                      <Link
                        className="link"
                        to={href("/org/:org/program/:program_id", {
                          org: row.recipient_id,
                          program_id: row.program_id,
                        })}
                      >
                        {row.program_name}
                      </Link>
                    )}
                  </td>
                  <td>
                    <Money
                      classes={
                        row.status === "refunded"
                          ? "line-through text-destructive-subtle-fg"
                          : ""
                      }
                      amount={row.amount}
                      currency={row.currency}
                      amount_usd={row.usd_value}
                    />
                    <p className="text-xs uppercase">{row.frequency}</p>
                  </td>
                  <td className="capitalize">{row.payment_method}</td>
                  <td>
                    <span
                      className={`text-sm font-medium ${status_text_color(row.status)}`}
                    >
                      {status_label(row.status)}
                    </span>
                  </td>
                  <td>
                    <RowAction row={row} />
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
        {load_next && (
          <LoadMoreRow
            col_span={6}
            disabled={disabled}
            loading={loading}
            on_load_next={load_next}
          />
        )}
      </table>
    </div>
  );
}

/** contextual action: receipt for settled, payment resumer for intent/pending */
function RowAction({ row }: { row: IRow }) {
  // a refunded gift has no tax receipt, and its stripe via_extra is a stale
  // bank-verification link, so it gets no action at all
  if (is_reversed(row.status)) return null;

  // settled: tax receipt, emailed from the detail route's form
  if (row.status === "settled") {
    return (
      <Link
        to={row.id}
        aria-label="View receipt"
        className="w-full flex justify-center"
      >
        <ArrowDownToLine className="icon-xl" />
      </Link>
    );
  }

  // crypto intent: finish paying
  if (
    row.status === "intent" &&
    row.via_id.startsWith("crypto") &&
    row.via_extra
  ) {
    return <PaymentResumer payment_id={row.via_extra} />;
  }

  // stripe bank verification: the requires-action webhook writes the link with
  // status intent and never clears it, so a later status leaves it stale
  if (
    row.status === "intent" &&
    row.via_id.startsWith("stripe") &&
    row.via_extra
  ) {
    return (
      <ExtLink href={row.via_extra} className="text-xs link font-semibold">
        Verify Bank
      </ExtLink>
    );
  }

  return null;
}
