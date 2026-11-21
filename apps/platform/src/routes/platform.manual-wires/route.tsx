import { useState } from "react";
import { type ShouldRevalidateFunction, useFetcher } from "react-router";
import { metas } from "#/helpers/seo";
import { MarkWiredDialog } from "#/pages/platform-admin/manual-wires/mark-wired-dialog";
import type { IManualWireRow } from "#/pages/platform-admin/manual-wires/types";
import {
  type IWireReturnAt,
  WiresTable,
  wire_return_target,
} from "#/pages/platform-admin/manual-wires/wires-table";
import type { Route } from "./+types/route";
import type { TWireAnswer } from "./api";

export { action, loader } from "./api";
export const meta: Route.MetaFunction = () => metas({ title: "Manual wires" });

// a refusal (a duplicate, a row already settled, an amount that moved) answers
// a 409, which React Router doesn't revalidate after: the rows would stay as
// they were when the dialog opened
export const shouldRevalidate: ShouldRevalidateFunction = ({
  formMethod,
  defaultShouldRevalidate,
}) => formMethod === "POST" || defaultShouldRevalidate;

interface IDialog {
  /** the row it opened on, with the row's place in the list */
  at: IWireReturnAt;
  /** stays set after closing, so the dialog keeps its body while it animates out */
  row: IManualWireRow;
  open: boolean;
  /** one per opening: each opening's request gets a fetcher with no earlier answer */
  n: number;
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const [dialog, set_dialog] = useState<IDialog | null>(null);
  const n = dialog?.n ?? 0;
  const mark = useFetcher<TWireAnswer>({ key: `manual-wire-${n}` });
  const settled = answer(mark);

  return (
    <div className="px-4 py-4 md:px-10 md:py-8 w-full grid content-start">
      <h1 className="sr-only">Manual wires</h1>
      <WiresTable
        rows={loaderData.rows}
        on_mark={(row, at) => set_dialog({ at, row, open: true, n: n + 1 })}
      />
      <MarkWiredDialog
        open={!!dialog?.open && !settled.done}
        row={dialog?.row ?? null}
        submitting={mark.state !== "idle"}
        error={settled.error}
        on_submit={(x) =>
          dialog &&
          mark.submit(
            { npo_id: dialog.row.npo_id, ...x },
            { method: "POST", encType: "application/json" }
          )
        }
        on_close={() => set_dialog((d) => d && { ...d, open: false })}
        return_focus_fallback={() => dialog && wire_return_target(dialog.at)}
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
function answer(f: ReturnType<typeof useFetcher<TWireAnswer>>): IAnswer {
  if (f.state !== "idle" || !f.data) return { done: false };
  if ("message" in f.data) return { done: false, error: f.data.message };
  return { done: true };
}
