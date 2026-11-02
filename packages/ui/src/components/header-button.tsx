import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";

export function HeaderButton<T>(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    _sortDirection: "asc" | "desc";
    _sortKey: keyof T;
    _activeSortKey: keyof T;
  }
) {
  const {
    _activeSortKey,
    _sortKey,
    _sortDirection,
    children,
    className,
    ...restProps
  } = props;
  return (
    <button
      {...restProps}
      className={`${className} group/sort flex items-center justify-between gap-1`}
    >
      <span>{children}</span>

      {_activeSortKey === _sortKey ? (
        _sortDirection === "asc" ? (
          <ChevronUp className="icon-md shrink-0" />
        ) : (
          <ChevronDown className="icon-md shrink-0" />
        )
      ) : (
        // only the sorted column shows its glyph at rest; the others reveal the
        // sortable affordance on hover or keyboard focus — and always on a
        // touch screen, which has no hover to reveal it
        <ChevronsUpDown className="icon-md shrink-0 text-gray-11 opacity-0 pointer-coarse:opacity-100 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100" />
      )}
    </button>
  );
}
