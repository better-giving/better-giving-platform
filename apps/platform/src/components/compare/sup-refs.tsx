import { Fragment } from "react";

interface ISupRefs {
  /** source ids behind a claim, in the order the data lists them */
  ids: string[];
  /** id -> number, from `source_numbers` or `index_sources` */
  numbers: Map<string, number>;
}

/** the small numbers after a claim; each links to its entry in the page's
 * sources list (`#s<n>`) */
export function SupRefs({ ids, numbers }: ISupRefs) {
  const nums = ids.flatMap((id) => numbers.get(id) ?? []);
  if (nums.length === 0) return null;
  return (
    <sup className="ml-0.5 text-xs font-bold whitespace-nowrap">
      {nums.map((n, i) => (
        <Fragment key={n}>
          {i > 0 && ", "}
          <a href={`#s${n}`} className="link" aria-label={`Source ${n}`}>
            {n}
          </a>
        </Fragment>
      ))}
    </sup>
  );
}
