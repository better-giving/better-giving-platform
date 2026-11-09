import { EmptyRow, LoadMoreRow, Select } from "@better-giving/ui";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Money } from "#/components/money";
import { toPP } from "@/helpers/date";
import { party_kind, party_name } from "./party";
import type { IOwedRow, TOwedPartyFilter, TOwedSort, TSortDir } from "./types";

export interface IOwedTable {
  rows: IOwedRow[];
  party: TOwedPartyFilter;
  sort: TOwedSort;
  dir: TSortDir;
  on_party_change: (party: TOwedPartyFilter) => void;
  on_sort_change: (sort: TOwedSort, dir: TSortDir) => void;
  has_more: boolean;
  loading_more: boolean;
  on_load_more: () => void;
  on_write_off: (row_id: string) => void;
  on_credit: (row_id: string) => void;
  /** placement only — margin, width */
  classes?: string;
}

const PARTIES: TOwedPartyFilter[] = ["all", "npo", "referrer"];
const party_option: Record<TOwedPartyFilter, string> = {
  all: "All parties",
  npo: "Nonprofits",
  referrer: "Referrers",
};

const source_label: Record<IOwedRow["source"], string> = {
  refund: "Refund",
  dispute: "Dispute",
};

const COLS = 11;

export function OwedTable({
  rows,
  party,
  sort,
  dir,
  on_party_change,
  on_sort_change,
  has_more,
  loading_more,
  on_load_more,
  on_write_off,
  on_credit,
  classes = "",
}: IOwedTable) {
  const sorting = { sort, dir, on_sort_change };
  return (
    <div className={classes}>
      <Select
        label="Party"
        value={party}
        onChange={on_party_change}
        options={PARTIES}
        option_disp={(p) => party_option[p]}
        classes={{ container: "mb-4 sm:w-56", option: "text-sm" }}
      />
      <div className="table-scroll">
        <table className="table whitespace-nowrap" data-owed-table>
          <thead>
            <tr>
              <th scope="col">Gift</th>
              <th scope="col">Party</th>
              <th scope="col" className="text-right">
                Received
              </th>
              <th scope="col" className="text-right">
                Card fee
              </th>
              <th scope="col" className="text-right">
                Dispute fee
              </th>
              <th scope="col" className="text-right">
                Credited back
              </th>
              <th scope="col" className="text-right">
                Recovered
              </th>
              <SortHeader
                col="outstanding"
                label="Outstanding"
                align="text-right"
                {...sorting}
              />
              <th scope="col">Source</th>
              <SortHeader col="date" label="Recorded" {...sorting} />
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-row-id={r.id}>
                <td className="font-mono text-xs">{r.donation_id}</td>
                <td>
                  {party_name(r)}
                  <span className="block text-xs text-gray-11">
                    {party_kind[r.party]}
                  </span>
                </td>
                <Usd amount={r.received_usd} />
                <Usd amount={r.fee_processing_usd} />
                <Usd amount={r.fee_dispute_usd} />
                <Usd amount={r.credited_back_usd} />
                <Usd amount={r.recovered_usd} />
                <Usd amount={r.outstanding_usd} classes="font-semibold" />
                <td>
                  {source_label[r.source]}
                  <span className="block font-mono text-xs text-gray-11">
                    {r.source_ref}
                  </span>
                </td>
                <td className="whitespace-nowrap">{toPP(r.recorded_at)}</td>
                <td>
                  <div className="flex gap-2 whitespace-nowrap">
                    <button
                      type="button"
                      data-action="write_off"
                      aria-label={`Write off ${party_name(r)}, gift ${r.donation_id}`}
                      onClick={() => on_write_off(r.id)}
                      className="btn btn-sm btn-secondary"
                    >
                      Write off
                    </button>
                    <button
                      type="button"
                      data-action="credit"
                      aria-label={`Credit ${party_name(r)}, gift ${r.donation_id}`}
                      onClick={() => on_credit(r.id)}
                      className="btn btn-sm btn-secondary"
                    >
                      Credit
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <EmptyRow col_span={COLS}>No amounts owed found</EmptyRow>
            )}
          </tbody>
          {has_more && (
            <LoadMoreRow
              col_span={COLS}
              loading={loading_more}
              on_load_next={on_load_more}
            />
          )}
        </table>
      </div>
    </div>
  );
}

export interface IReturnAt {
  row_id: string;
  action: "write_off" | "credit";
  /** the row's position in the list when its dialog opened */
  index: number;
}

/**
 * where a row action's dialog sends focus once that action's button is gone:
 * the same row's action (it remounted), else the action of the row now in its
 * place, else of the nearest row above, else the empty state's cell. read
 * against the table as it stands when called.
 */
export function owed_return_target(
  { row_id, action, index }: IReturnAt,
  root: ParentNode = document
): HTMLElement | null {
  const table = root.querySelector("[data-owed-table]");
  if (!table) return null;
  const rows = [...table.querySelectorAll("tbody > tr[data-row-id]")];
  if (rows.length === 0) return table.querySelector<HTMLElement>("tbody td");
  const action_of = (tr?: Element) =>
    tr?.querySelector<HTMLElement>(`[data-action="${action}"]`) ?? null;
  return (
    action_of(rows.find((tr) => tr.getAttribute("data-row-id") === row_id)) ??
    action_of(rows[index]) ??
    // a reload that dropped later pages leaves no row at `index` or just above
    action_of(rows[Math.min(index, rows.length) - 1])
  );
}

interface IUsd {
  amount: number;
  classes?: string;
}

function Usd({ amount, classes = "" }: IUsd) {
  return (
    <td className="text-right whitespace-nowrap">
      <Money amount={amount} currency="USD" classes={classes} />
    </td>
  );
}

interface ISortHeader {
  col: TOwedSort;
  label: string;
  align?: string;
  sort: TOwedSort;
  dir: TSortDir;
  on_sort_change: IOwedTable["on_sort_change"];
}

/** a column's first press sorts it descending; a press on the sorted column flips it */
function SortHeader({
  col,
  label,
  align = "",
  sort,
  dir,
  on_sort_change,
}: ISortHeader) {
  const active = sort === col;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      className={align}
      aria-sort={!active ? "none" : dir === "asc" ? "ascending" : "descending"}
    >
      <button
        type="button"
        onClick={() =>
          on_sort_change(col, active && dir === "desc" ? "asc" : "desc")
        }
        // 24px target on a 20px line: the overhang sits in the cell's padding,
        // so the header row keeps its height
        className="inline-flex items-center gap-1 min-h-6 -my-0.5 rounded focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
      >
        {label}
        <Icon aria-hidden className="icon-sm" />
      </button>
    </th>
  );
}
