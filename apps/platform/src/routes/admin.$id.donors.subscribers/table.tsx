import { EmptyRow, LoadMoreTr } from "@better-giving/ui";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { InfoTip } from "../admin.$id.donors/info-tip";

export interface ISubRow {
  from_email: string;
  from_name: string | null;
  active_count: number;
  billed_month: number;
  pend_month: number;
  pend_year: number;
}

type TSort = "name" | "billed_month" | "pend_month" | "pend_year";
type TDir = "asc" | "desc";

interface IProps {
  items: ISubRow[];
  load_next?: () => void;
  loading?: boolean;
  disabled?: boolean;
}

const PEND_MONTH_INFO =
  "Scheduled charges this month from active subscriptions, not yet collected.";
const PEND_YEAR_INFO =
  "Scheduled charges through year-end from active subscriptions, not yet collected.";

const fmt$ = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function SubscribersTable({
  items,
  load_next,
  loading,
  disabled,
}: IProps) {
  const { id: npo_id } = useParams();
  // client sort only meaningful over the full dataset; disable while more pages can load
  const sort_disabled = !!load_next;
  const [sort, set_sort] = useState<TSort>("billed_month");
  const [dir, set_dir] = useState<TDir>("desc");

  const rows = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      if (sort === "name") {
        const an = a.from_name ?? a.from_email;
        const bn = b.from_name ?? b.from_email;
        return dir === "asc" ? an.localeCompare(bn) : bn.localeCompare(an);
      }
      const av = a[sort];
      const bv = b[sort];
      return dir === "asc" ? av - bv : bv - av;
    });
    return copy;
  }, [items, sort, dir]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          billed_month: acc.billed_month + r.billed_month,
          pend_month: acc.pend_month + r.pend_month,
          pend_year: acc.pend_year + r.pend_year,
        }),
        { billed_month: 0, pend_month: 0, pend_year: 0 }
      ),
    [rows]
  );

  function toggle(k: TSort) {
    if (sort_disabled) return;
    if (k === sort) set_dir(dir === "asc" ? "desc" : "asc");
    else {
      set_sort(k);
      set_dir("desc");
    }
  }

  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr className="whitespace-nowrap">
            <Th
              k="name"
              sort={sort}
              dir={dir}
              on_click={toggle}
              disabled={sort_disabled}
            >
              Name
            </Th>
            <Th
              k="billed_month"
              sort={sort}
              dir={dir}
              on_click={toggle}
              disabled={sort_disabled}
              align="right"
            >
              Billed this month
            </Th>
            <Th
              k="pend_month"
              sort={sort}
              dir={dir}
              on_click={toggle}
              disabled={sort_disabled}
              align="right"
              info={PEND_MONTH_INFO}
            >
              Pending this month
            </Th>
            <Th
              k="pend_year"
              sort={sort}
              dir={dir}
              on_click={toggle}
              disabled={sort_disabled}
              align="right"
              info={PEND_YEAR_INFO}
            >
              Pending this year
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow col_span={4}>No subscribers yet</EmptyRow>
          ) : (
            rows.map((r) => {
              const to = `/admin/${npo_id}/donors/${encodeURIComponent(r.from_email)}`;
              return (
                <tr
                  key={r.from_email}
                  className={`hover:bg-gray-4 ${r.active_count === 0 ? "text-gray-11" : ""}`}
                >
                  <td className="p-0">
                    <Link
                      to={to}
                      state={{ from: "subscribers" }}
                      className="block px-2 py-2"
                    >
                      <div className="font-medium leading-tight">
                        {r.from_name ?? r.from_email}
                      </div>
                      <div className="text-xs leading-snug text-gray-11">
                        {r.from_email}
                      </div>
                    </Link>
                  </td>
                  <Money n={r.billed_month} to={to} bold />
                  <Money n={r.pend_month} to={to} />
                  <Money n={r.pend_year} to={to} />
                </tr>
              );
            })
          )}
        </tbody>
        {(rows.length > 0 || load_next) && (
          <tfoot>
            {rows.length > 0 && (
              <tr>
                <td className="text-xs font-medium text-gray-11">Total</td>
                <FootMoney n={totals.billed_month} />
                <FootMoney n={totals.pend_month} />
                <FootMoney n={totals.pend_year} />
              </tr>
            )}
            {load_next && (
              <LoadMoreTr
                col_span={4}
                disabled={disabled}
                loading={loading}
                on_load_next={load_next}
              />
            )}
          </tfoot>
        )}
      </table>
    </div>
  );
}

interface IThProps {
  k: TSort;
  sort: TSort;
  dir: TDir;
  on_click: (k: TSort) => void;
  disabled?: boolean;
  align?: "left" | "right";
  info?: string;
  children: React.ReactNode;
}

function Th({
  k,
  sort,
  dir,
  on_click,
  disabled,
  align = "left",
  info,
  children,
}: IThProps) {
  const active = sort === k;
  const Glyph = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <th className={`p-0 ${align === "right" ? "text-right" : "text-left"}`}>
      {/* the tip's trigger is a button of its own, so it sits beside the sort
          button: a button inside a button is invalid html and fails hydration */}
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => on_click(k)}
          disabled={disabled}
          className={`inline-flex flex-1 select-none items-center gap-1 py-2 pl-2 ${info ? "pr-1" : "pr-2"} focus-visible:outline-2 focus-visible:-outline-offset-2 outline-ring ${
            disabled ? "cursor-default" : "cursor-pointer"
          } ${align === "right" ? "justify-end" : ""} ${active ? "text-gray-12" : ""}`}
        >
          {children}
          {!disabled && (
            <Glyph className={`size-3 ${active ? "" : "opacity-40"}`} />
          )}
        </button>
        {info && (
          <span className="inline-flex pr-2">
            <InfoTip label={info} />
          </span>
        )}
      </div>
    </th>
  );
}

interface IMoneyProps {
  n: number;
  to: string;
  bold?: boolean;
}

function Money({ n, to, bold }: IMoneyProps) {
  const zero = n === 0;
  return (
    <td className="p-0 text-right whitespace-nowrap">
      <Link
        to={to}
        state={{ from: "subscribers" }}
        className={`block px-2 py-2 ${bold ? "font-medium" : ""} ${zero ? "text-gray-11" : ""}`}
      >
        {zero ? "—" : fmt$(n)}
      </Link>
    </td>
  );
}

function FootMoney({ n }: { n: number }) {
  return (
    <td className="text-right font-semibold whitespace-nowrap">{fmt$(n)}</td>
  );
}
