import { X } from "lucide-react";
import type { IChip } from "./constants";

interface IFilterChip {
  chip: IChip;
  on_remove: () => void;
}

/**
 * an active filter, removable. a rounded rectangle on purpose: the status
 * badges in the table are pills, and a chip must not read as one. the × is a
 * glyph smaller than the text inside a 24px hit area.
 */
export function FilterChip({ chip, on_remove }: IFilterChip) {
  return (
    <span className="inline-flex items-center gap-1 min-h-7 pl-3 pr-0.5 text-sm font-medium rounded bg-secondary text-accent-12">
      <span>
        {chip.prefix && <span className="font-normal">{chip.prefix} </span>}
        {chip.label}
      </span>
      <button
        type="button"
        data-chip-remove
        aria-label={`Remove filter: ${chip.name}`}
        onClick={on_remove}
        className="glyph-btn hover:bg-secondary-hover focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
      >
        <X className="icon-xs" aria-hidden />
      </button>
    </span>
  );
}
