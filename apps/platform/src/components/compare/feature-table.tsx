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
const td_cls =
  "align-top px-4 py-3 max-md:mx-4 max-md:mb-3 max-md:block max-md:rounded max-md:px-3 max-md:py-2";
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
    <tr className="max-md:block max-md:border-t max-md:border-hairline max-md:first:border-t-0">
      <th
        scope="row"
        className="px-4 py-3 align-top font-bold text-gray-12 max-md:block max-md:pt-4 max-md:pb-2 max-md:text-base md:w-1/4"
      >
        {row.feature}
      </th>
      <td className={`${td_cls} bg-secondary`}>
        <span className={label_cls}>Better Giving</span>
        {row.better_giving}
        <SupRefs ids={row.better_giving_sources} numbers={numbers} />
      </td>
      <td className={`${td_cls} max-md:bg-panel max-md:last:mb-4`}>
        <span className={label_cls}>{competitor}</span>
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
    <table className="table max-md:block max-md:overflow-hidden">
      <thead className="max-md:sr-only">
        <tr>
          <th scope="col" className="px-4 py-3">
            Feature
          </th>
          <th
            scope="col"
            className="bg-secondary px-4 py-3 font-bold text-gray-12"
          >
            Better Giving
          </th>
          <th scope="col" className="px-4 py-3">
            {competitor}
          </th>
        </tr>
      </thead>
      <tbody className="max-md:block">
        {core.map((r) => (
          <Cells
            key={r.feature}
            row={r}
            competitor={competitor}
            numbers={numbers}
          />
        ))}
        {more.length > 0 && (
          <tr className="max-md:block">
            <td
              colSpan={3}
              className="bg-panel px-4 py-2 font-medium text-gray-11 max-md:block"
            >
              More on {competitor}
            </td>
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
