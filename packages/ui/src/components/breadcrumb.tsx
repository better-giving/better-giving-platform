import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

export interface IBreadcrumb {
  /** ancestors first; the last item is the current page and its `to` is
   *  ignored. an ancestor without `to` (a level with no page of its own)
   *  renders as plain text. */
  items: { label: string; to?: string }[];
  classes?: string;
}

/** stands in for the page title on a nested dashboard page: the last item IS
 *  the page's `h1`, so a page rendering this draws no other. ancestors keep
 *  their full label — a truncated "Ban…" is a link nobody can read — and the
 *  current item alone shrinks, so a long trail truncates inside a 390px
 *  column instead of widening the page. */
export function Breadcrumb({ items, classes = "" }: IBreadcrumb) {
  const ancestors = items.slice(0, -1);
  const current = items.at(-1);
  return (
    <nav aria-label="Breadcrumb" className={`min-w-0 ${classes}`}>
      <ol className="flex items-center gap-1 text-base min-w-0">
        {ancestors.map((item, i) => (
          <li key={i} className="flex items-center gap-1 shrink-0">
            {item.to ? (
              <Link to={item.to} className="link">
                {item.label}
              </Link>
            ) : (
              <span className="text-gray-11">{item.label}</span>
            )}
            <ChevronRight aria-hidden className="icon-md text-gray-11" />
          </li>
        ))}
        {current && (
          <li className="min-w-0">
            <h1
              aria-current="page"
              className="truncate font-semibold text-gray-12"
            >
              {current.label}
            </h1>
          </li>
        )}
      </ol>
    </nav>
  );
}
