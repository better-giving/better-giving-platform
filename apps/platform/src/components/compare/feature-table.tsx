// biome-ignore-all lint/a11y/noRedundantRoles: below md every table part is display:block, which drops the implied roles in some engines (WebKit); the explicit ones hold them
// biome-ignore-all lint/a11y/useSemanticElements: same — these are already the semantic elements, the role restates it
import type { ICompareRow } from "#/content/compare/types";
import { SupRefs } from "./sup-refs";

interface IFeatureTable {
  competitor: string;
  rows: ICompareRow[];
  numbers: Map<string, number>;
}

// one markup for both widths. from md it is the `.table` shell; below md the
// header row is screen-reader only and each feature becomes a block, its two
// values in labelled wells. only Better Giving's column is tinted, with the
// ledger's tinted-component step; the other platform's is neutral, not muted.
// below md the row's own rule replaces `.table`'s cell rules.
const td_cls =
  "align-top px-4 py-3 max-md:mx-4 max-md:mb-3 max-md:block max-md:rounded max-md:border-t-0 max-md:px-3 max-md:py-2";
// repeats the column header, which the cell already carries for assistive tech
const label_cls = "mb-0.5 block text-xs font-bold text-gray-11 md:hidden";

function Cells({
  row,
  competitor,
  numbers,
}: {
  row: ICompareRow;
  competitor: string;
  numbers: Map<string, number>;
}) {
  return (
    <tr
      role="row"
      className="max-md:block max-md:border-t max-md:border-hairline max-md:first:border-t-0"
    >
      <th
        scope="row"
        role="rowheader"
        className="px-4 py-3 align-top font-bold text-gray-12 max-md:block max-md:border-t-0 max-md:pt-4 max-md:pb-2 max-md:text-base md:w-1/4"
      >
        {row.feature}
      </th>
      <td role="cell" className={`${td_cls} bg-secondary`}>
        <span aria-hidden className={label_cls}>
          Better Giving
        </span>
        {row.better_giving}
        <SupRefs ids={row.better_giving_sources} numbers={numbers} />
      </td>
      <td role="cell" className={`${td_cls} max-md:bg-panel max-md:last:mb-4`}>
        <span aria-hidden className={label_cls}>
          {competitor}
        </span>
        {row.competitor}
        <SupRefs ids={row.competitor_sources} numbers={numbers} />
      </td>
    </tr>
  );
}

export function FeatureTable({ competitor, rows, numbers }: IFeatureTable) {
  const core = rows.filter((r) => r.core);
  const more = rows.filter((r) => !r.core);
  return (
    <table role="table" className="table max-md:block max-md:overflow-hidden">
      <thead role="rowgroup" className="max-md:sr-only">
        <tr role="row">
          <th scope="col" role="columnheader" className="px-4 py-3">
            Feature
          </th>
          <th
            scope="col"
            role="columnheader"
            className="bg-secondary px-4 py-3 font-bold text-gray-12"
          >
            Better Giving
          </th>
          <th scope="col" role="columnheader" className="px-4 py-3">
            {competitor}
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup" className="max-md:block">
        {core.map((r) => (
          <Cells
            key={r.feature}
            row={r}
            competitor={competitor}
            numbers={numbers}
          />
        ))}
        {more.length > 0 && (
          <tr role="row" className="max-md:block">
            <th
              scope="colgroup"
              role="columnheader"
              colSpan={3}
              className="bg-panel px-4 py-2 font-medium text-gray-11 max-md:block"
            >
              More on {competitor}
            </th>
          </tr>
        )}
        {more.map((r) => (
          <Cells
            key={r.feature}
            row={r}
            competitor={competitor}
            numbers={numbers}
          />
        ))}
      </tbody>
    </table>
  );
}
