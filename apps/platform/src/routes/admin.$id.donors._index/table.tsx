import { EmptyRow, LoadMoreRow } from "@better-giving/ui";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router";
import type { INpoDonor } from "$/pg/queries/donor";

type TSort = "name" | "count" | "total";
type TDir = "asc" | "desc";

const is_sort = (v: string | null): v is TSort =>
  v === "name" || v === "count" || v === "total";
const is_dir = (v: string | null): v is TDir => v === "asc" || v === "desc";

interface IProps {
  items: INpoDonor[];
  load_next?: () => void;
  loading?: boolean;
  disabled?: boolean;
}

const fmt$ = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function DonorsTable({ items, load_next, loading, disabled }: IProps) {
  const { id: npo_id } = useParams();
  const [search] = useSearchParams();
  const raw_sort = search.get("sort");
  const raw_dir = search.get("dir");
  const sort: TSort = is_sort(raw_sort) ? raw_sort : "total";
  const dir: TDir = is_dir(raw_dir) ? raw_dir : "desc";

  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <Th k="name" sort={sort} dir={dir}>
              Name
            </Th>
            <Th k="count" sort={sort} dir={dir} align="right">
              Donations
            </Th>
            <Th k="total" sort={sort} dir={dir} align="right">
              Lifetime total
            </Th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <EmptyRow col_span={3}>No donors yet</EmptyRow>
          ) : (
            items.map((d) => {
              const to = `/admin/${npo_id}/donors/${encodeURIComponent(d.email)}`;
              const state = { from: "donors" };
              return (
                <tr key={d.email} className="hover:bg-gray-4">
                  <td className="p-0">
                    <Link to={to} state={state} className="block px-2 py-2">
                      <div className="font-medium leading-tight">
                        {d.name ?? d.email}
                      </div>
                      <div className="text-xs leading-snug text-gray-11">
                        {d.email}
                      </div>
                    </Link>
                  </td>
                  <td className="p-0 text-right">
                    <Link to={to} state={state} className="block px-2 py-2">
                      {d.count}
                    </Link>
                  </td>
                  <td className="p-0 text-right">
                    <Link
                      to={to}
                      state={state}
                      className="block px-2 py-2 font-medium"
                    >
                      {fmt$(d.total)}
                    </Link>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
        {load_next && (
          <LoadMoreRow
            col_span={3}
            disabled={disabled}
            loading={loading}
            on_load_next={load_next}
          />
        )}
      </table>
    </div>
  );
}

interface IThProps {
  k: TSort;
  sort: TSort;
  dir: TDir;
  align?: "left" | "right";
  children: React.ReactNode;
}

function Th({ k, sort, dir, align = "left", children }: IThProps) {
  const active = sort === k;
  const [search, set_search] = useSearchParams();

  function on_click() {
    const next = new URLSearchParams(search);
    if (active) {
      next.set("dir", dir === "asc" ? "desc" : "asc");
    } else {
      next.set("sort", k);
      next.set("dir", "desc");
    }
    next.delete("next");
    set_search(next, { preventScrollReset: true });
  }

  const Glyph = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;

  // p-0 so the button fills the cell — .table default padding is applied inside the button instead
  return (
    <th className={`p-0 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={on_click}
        className={`inline-flex w-full cursor-pointer select-none items-center gap-1 px-2 py-2 focus-visible:outline-2 focus-visible:-outline-offset-2 outline-ring ${
          align === "right" ? "justify-end" : ""
        } ${active ? "text-gray-12" : ""}`}
      >
        {children}
        <Glyph className={`size-3 ${active ? "" : "opacity-40"}`} />
      </button>
    </th>
  );
}
