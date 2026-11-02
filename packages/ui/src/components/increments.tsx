import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Info } from "./status";

type Increment = {
  value: string;
  label: string;
};

type F = Increment & { id: string };

interface Props {
  classes?: string;
  countError?: string;
  fields: F[];
  field: (idx: number) => ReactNode;
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
}
export function Increments({
  classes = "",
  countError,
  onRemove,
  fields,
  field,
  onAdd,
}: Props) {
  return (
    <div
      className={`${classes} grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2 gap-y-2`}
    >
      <div className="flex items-center gap-2 col-span-3">
        <p className="font-semibold text-sm">Donation increments</p>
        <button
          type="button"
          aria-label="Add donation increment"
          className="glyph-btn font-bold"
          onClick={() => onAdd("")}
        >
          <Plus strokeWidth={3} className="icon-md" />
        </button>
      </div>
      <p className="text-xs text-destructive-subtle-fg empty:hidden col-span-3">
        {countError}
      </p>
      {fields.length > 0 && (
        <div className="grid grid-cols-subgrid col-span-3">
          <div className="text-xs font-bold">Amount</div>
          <div className="text-xs font-bold">Description</div>
        </div>
      )}
      <div className="mt-2 grid grid-cols-subgrid gap-y-6 col-span-3">
        {fields.length === 0 ? (
          <Info classes="col-span-3">
            Click the plus symbol to add preset donation increments for donors
            to choose
          </Info>
        ) : (
          fields.map((f, idx) => {
            return (
              <div
                key={f.id}
                className="grid grid-cols-subgrid col-span-3 items-center grid-rows-[auto_auto]"
              >
                {field(idx)}
                {/* in the tab order on purpose — a row that can be added
                    by keyboard has to be removable by one too. */}
                <button
                  aria-label="Remove donation increment"
                  className="glyph-btn justify-self-start"
                  type="button"
                  onClick={() => onRemove(idx)}
                >
                  <Minus className="icon-lg" strokeWidth={3} />
                </button>
                <div />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
