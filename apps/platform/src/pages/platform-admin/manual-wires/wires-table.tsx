import { EmptyRow } from "@better-giving/ui";
import { humanize } from "@/helpers/decimal";
import type { IManualWireRow } from "./types";

/** "$4,200.00", "−$5.00": two decimals, the sign before the symbol */
export const usd = (n: number) =>
  `${n < 0 ? "\u2212" : ""}$${humanize(Math.abs(n))}`;

export interface IWiresTable {
  rows: IManualWireRow[];
  on_mark: (row: IManualWireRow, at: IWireReturnAt) => void;
}

const COLS = 5;

// below md each row is a card: the cells stack and the header row gives way to
// a label inside each cell
const row_cls =
  "max-md:block max-md:p-4 max-md:border-t max-md:border-hairline max-md:first:border-t-0";
const cell_cls = "max-md:block max-md:p-0 max-md:border-0";
const card_label_cls = "md:hidden block text-xs font-medium text-gray-11";

export function WiresTable({ rows, on_mark }: IWiresTable) {
  return (
    <div className="table-scroll">
      <table className="table max-md:block" data-wires-table>
        <thead className="max-md:hidden">
          <tr>
            <th scope="col" className="w-1/4">
              Nonprofit
            </th>
            <th scope="col" className="num w-1/6">
              Amount due
            </th>
            <th scope="col" className="w-1/6">
              Payouts
            </th>
            <th scope="col" className="w-1/4">
              Bank account
            </th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="max-md:block">
          {rows.map((r, index) => {
            const under_min = r.net < r.minimum;
            const reason_id = `wire-min-${r.npo_id}`;
            return (
              <tr key={r.npo_id} data-row-id={r.npo_id} className={row_cls}>
                <td className={cell_cls}>
                  <span className="block font-semibold">{r.name}</span>
                  <span className="block text-xs text-gray-11">
                    ID {r.npo_id}
                  </span>
                </td>
                <td
                  className={`num whitespace-nowrap max-md:text-start max-md:mt-3 ${cell_cls}`}
                >
                  <span className={card_label_cls}>Amount due</span>
                  <span className="block font-bold figures max-md:text-base max-md:mt-0.5">
                    {usd(r.net)}
                  </span>
                  {r.owed > 0 && (
                    <span className="block text-xs text-gray-11">
                      after {usd(r.owed)} owed
                    </span>
                  )}
                </td>
                <td className={`max-md:mt-3 ${cell_cls}`}>
                  <span className={card_label_cls}>Payouts</span>
                  {r.payouts.length} payout{r.payouts.length === 1 ? "" : "s"}
                </td>
                <td className={`max-md:mt-3 ${cell_cls}`}>
                  <span className={card_label_cls}>Bank account</span>
                  {r.bank}
                </td>
                <td className={`max-md:mt-4 ${cell_cls}`}>
                  <button
                    type="button"
                    data-action="mark"
                    aria-label={`Mark wired, ${r.name}`}
                    aria-disabled={under_min || undefined}
                    aria-describedby={under_min ? reason_id : undefined}
                    onClick={
                      under_min
                        ? undefined
                        : () => on_mark(r, { row_id: r.npo_id, index })
                    }
                    className="btn btn-sm btn-secondary"
                  >
                    Mark wired
                  </button>
                  {under_min && (
                    <p id={reason_id} className="mt-1.5 text-xs text-gray-11">
                      Under the {usd(r.minimum)} payout minimum
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <EmptyRow col_span={COLS}>No manual wires due</EmptyRow>
          )}
        </tbody>
      </table>
    </div>
  );
}

export interface IWireReturnAt {
  /** the row's `npo_id` */
  row_id: number;
  /** the row's position in the list when its dialog opened */
  index: number;
}

/**
 * where the Mark wired dialog sends focus once its row's button is gone: the
 * same row's button (it remounted), else the button of the row now in its
 * place, else of the nearest row above, else the empty state's cell. read
 * against the table as it stands when called.
 */
export function wire_return_target(
  { row_id, index }: IWireReturnAt,
  root: ParentNode = document
): HTMLElement | null {
  const table = root.querySelector("[data-wires-table]");
  if (!table) return null;
  const rows = [...table.querySelectorAll("tbody > tr[data-row-id]")];
  if (rows.length === 0) return table.querySelector<HTMLElement>("tbody td");
  const action_of = (tr?: Element) =>
    tr?.querySelector<HTMLElement>('[data-action="mark"]') ?? null;
  return (
    action_of(
      rows.find((tr) => tr.getAttribute("data-row-id") === String(row_id))
    ) ??
    action_of(rows[index]) ??
    action_of(rows[Math.min(index, rows.length) - 1])
  );
}
