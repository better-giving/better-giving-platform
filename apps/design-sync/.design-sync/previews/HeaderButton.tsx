import { HeaderButton } from "@better-giving/ui";

// a sortable column head. only the column the table is actually ordered by
// shows its caret at rest, with a direction. the others show the muted double
// chevron on hover or keyboard focus, and always on a touch screen — so in a
// static card the unsorted heads show no glyph at all (see NOTES.md).
//
// it goes inside the `<th>`, not in place of it: `.table` styles the cell and
// this styles the control in it.

type Row = { date: string; npo: string; amount: string };

const rows: Row[] = [
  { date: "Mar 14, 2026", npo: "Rainforest Trust", amount: "$250.00" },
  { date: "Mar 12, 2026", npo: "Ocean Conservancy", amount: "$40.00" },
  { date: "Mar 09, 2026", npo: "Doctors Without Borders", amount: "$1,200.00" },
];

const Table = ({ active, dir }: { active: keyof Row; dir: "asc" | "desc" }) => (
  <table className="table w-96">
    <thead>
      <tr>
        {(
          [
            ["date", "Date"],
            ["npo", "Nonprofit"],
            ["amount", "Amount"],
          ] as const
        ).map(([key, label]) => (
          <th key={key}>
            <HeaderButton<Row>
              className="w-full"
              _sortKey={key}
              _activeSortKey={active}
              _sortDirection={dir}
            >
              {label}
            </HeaderButton>
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((r) => (
        <tr key={r.date}>
          <td>{r.date}</td>
          <td>{r.npo}</td>
          <td>{r.amount}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

// the resting shape of a sortable table: newest first on the date column,
// the other two heads offering the sort they are not currently doing.
export const Default = () => <Table active="date" dir="desc" />;

// ascending on the same column — the caret flips, nothing else moves.
export const Ascending = () => <Table active="date" dir="asc" />;

// sorted by a different column. only one head is ever active, so the reader
// can find the ordering key by scanning for the single solid caret.
export const SortedByAnotherColumn = () => <Table active="amount" dir="desc" />;
