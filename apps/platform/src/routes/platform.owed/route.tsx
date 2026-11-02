import { useState } from "react";
import { useFetcher, useSearchParams } from "react-router";
import { metas } from "#/helpers/seo";
import { use_table } from "#/hooks/use-table";
import { CreditDialog } from "#/pages/platform-admin/owed/credit-dialog";
import {
  type IReturnAt,
  OwedTable,
  owed_return_target,
} from "#/pages/platform-admin/owed/owed-table";
import type {
  IOwedRow,
  TOwedPartyFilter,
  TOwedSort,
  TSortDir,
} from "#/pages/platform-admin/owed/types";
import { WriteOffDialog } from "#/pages/platform-admin/owed/write-off-dialog";
import type { Route } from "./+types/route";
import type { TOwedAnswer } from "./api";

export { action, loader } from "./api";
export const meta: Route.MetaFunction = () => metas({ title: "Amounts owed" });

interface IDialog {
  /** the action and the row it opened on, with the row's place in the list */
  at: IReturnAt;
  /** stays set after closing, so the dialog keeps its body while it animates out */
  row: IOwedRow;
  open: boolean;
  /** one per opening: each opening's request gets a fetcher with no earlier answer */
  n: number;
}

const as_json = { method: "POST", encType: "application/json" } as const;

export default function Page({ loaderData }: Route.ComponentProps) {
  const { party, sort, dir } = loaderData;
  const [search, set_search] = useSearchParams();
  const [dialog, set_dialog] = useState<IDialog | null>(null);
  const n = dialog?.n ?? 0;
  const write_off = useFetcher<TOwedAnswer>({ key: `owed-write-off-${n}` });
  const credit = useFetcher<TOwedAnswer>({ key: `owed-credit-${n}` });

  const set_params = (x: Record<string, string | undefined>) =>
    set_search(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [k, val] of Object.entries(x)) {
          if (val === undefined) p.delete(k);
          else p.set(k, val);
        }
        p.delete("next");
        return p;
      },
      { preventScrollReset: true }
    );

  // every fresh read of page 1 drops the pages loaded under it: a write-off
  // revalidates those pages' fetcher too, and its answer would append again
  const [read, set_read] = useState({ data: loaderData, n: 0 });
  if (read.data !== loaderData) set_read({ data: loaderData, n: read.n + 1 });

  const open = (action: IReturnAt["action"], rows: IOwedRow[], id: string) => {
    const index = rows.findIndex((r) => r.id === id);
    const row = rows[index];
    if (!row) return;
    set_dialog({
      at: { row_id: id, action, index },
      row,
      open: true,
      n: n + 1,
    });
  };
  const close = () => set_dialog((d) => d && { ...d, open: false });

  const { node } = use_table({
    page1: loaderData,
    filter_key: String(read.n),
    gen_loader: (load, next) => () => {
      const p = new URLSearchParams(search);
      p.set("next", next);
      load(`?${p.toString()}`);
    },
    table: (x) => (
      <OwedTable
        rows={x.items}
        party={party}
        sort={sort}
        dir={dir}
        on_party_change={(p: TOwedPartyFilter) =>
          set_params({ party: p === "all" ? undefined : p })
        }
        on_sort_change={(s: TOwedSort, d: TSortDir) =>
          set_params({ sort: s, dir: d })
        }
        has_more={!!x.load_next}
        loading_more={!!x.loading}
        on_load_more={() => x.load_next?.()}
        on_write_off={(id) => open("write_off", x.items, id)}
        on_credit={(id) => open("credit", x.items, id)}
      />
    ),
  });

  const wo = answer(write_off);
  const cr = answer(credit);
  const return_focus_fallback = () => dialog && owed_return_target(dialog.at);

  return (
    <div className="px-4 py-4 md:px-10 md:py-8 w-full grid content-start">
      <h1 className="sr-only">Amounts owed</h1>
      {node}
      <WriteOffDialog
        open={dialog?.at.action === "write_off" && dialog.open && !wo.done}
        row={dialog?.at.action === "write_off" ? dialog.row : null}
        submitting={write_off.state !== "idle"}
        error={wo.error}
        on_submit={({ reason }) =>
          dialog &&
          write_off.submit(
            { intent: "write_off", owed_id: dialog.row.id, reason },
            as_json
          )
        }
        on_close={close}
        return_focus_fallback={return_focus_fallback}
      />
      <CreditDialog
        open={dialog?.at.action === "credit" && dialog.open && !cr.done}
        row={dialog?.at.action === "credit" ? dialog.row : null}
        submitting={credit.state !== "idle"}
        error={cr.error}
        on_submit={(x) =>
          dialog &&
          credit.submit(
            { intent: "credit", owed_id: dialog.row.id, ...x },
            as_json
          )
        }
        on_close={close}
        return_focus_fallback={return_focus_fallback}
      />
    </div>
  );
}

interface IAnswer {
  /** landed: the dialog closes */
  done: boolean;
  error?: string;
}

/** the request's answer once it has settled, list revalidated and all */
function answer(f: ReturnType<typeof useFetcher<TOwedAnswer>>): IAnswer {
  if (f.state !== "idle" || !f.data) return { done: false };
  if ("message" in f.data) return { done: false, error: f.data.message };
  return { done: true };
}
