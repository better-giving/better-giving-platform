import { flat_colors } from "@better-giving/brand/flat";
import { Text } from "react-email";
import { PlatformLayout } from "../components/platform-layout";

/** taken from the npo's grant for a gift it owes on; negative when the gift
 * is due back to it instead */
interface IDeduction {
  donation_id: string;
  usd: number;
}

interface IRow {
  id: number;
  name: string;
  /** the pending total, before anything owed */
  amount: number;
  min: number;
  /** recovered: owed at least its pending total, so settled with no transfer.
   * manual_wire: left to a wire sent by hand, outside the run's totals */
  effect: "pass" | "skipped" | "recovered" | "manual_wire";
  /** set when the run nets what npos owe: what the transfer sends */
  net?: number;
  deductions?: IDeduction[];
}

export interface IData {
  rows: IRow[];
  total_grant: number;
  wise_usd_balance: number;
  report_period: string;
  low_balance: boolean;
}

const th: React.CSSProperties = {
  border: `1px solid ${flat_colors.border}`,
  padding: "8px",
  whiteSpace: "nowrap",
  textAlign: "left",
  backgroundColor: flat_colors.gray_3,
  // tinted surface carries its own ink; inheritance loses in clients that
  // force their own text color onto an explicit background
  color: flat_colors.gray_12,
  fontWeight: 600,
  fontSize: 13,
};

const td: React.CSSProperties = {
  border: `1px solid ${flat_colors.border}`,
  padding: "8px",
  fontSize: 13,
  lineHeight: "20px",
};

const td_right: React.CSSProperties = {
  ...td,
  textAlign: "right",
  whiteSpace: "nowrap",
};
const th_right: React.CSSProperties = { ...th, textAlign: "right" };

const row_style: Partial<Record<IRow["effect"], React.CSSProperties>> = {
  skipped: { color: flat_colors.gray_11 },
  manual_wire: { backgroundColor: flat_colors.accent_2 },
};

const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** a deduction reads as money taken, a due-back as money added */
const signed = (deducted: number) =>
  deducted > 0
    ? `\u2212${usd(deducted)}`
    : deducted < 0
      ? `+${usd(-deducted)}`
      : usd(0);

function Jsx({
  rows,
  total_grant,
  wise_usd_balance,
  report_period,
  low_balance,
}: IData) {
  const nets = rows.some((r) => r.net !== undefined);
  const deductions = rows.flatMap((r) =>
    (r.deductions ?? []).map((d) => ({ ...d, npo_id: r.id }))
  );
  const wires = rows.filter((r) => r.effect === "manual_wire");
  const wires_total = wires.reduce((a, r) => a + (r.net ?? r.amount), 0);
  return (
    <PlatformLayout>
      <Text style={{ fontWeight: 600, fontSize: 16 }}>
        {low_balance
          ? "⚠️ WARNING: Low Wise balance for grants"
          : "Grants Schedule"}
      </Text>

      <Text style={{ margin: "4px 0" }}>Period: {report_period}</Text>
      <Text style={{ margin: "4px 0" }}>
        Grant total: <strong>{usd(total_grant)}</strong>
      </Text>
      <Text
        style={{
          margin: "4px 0",
          color: low_balance ? flat_colors.destructive : undefined,
        }}
      >
        Wise USD balance: <strong>{usd(wise_usd_balance)}</strong>
      </Text>
      {wires.length > 0 && (
        <Text style={{ margin: "4px 0" }}>
          Manual wires: <strong>{usd(wires_total)}</strong> · {wires.length}{" "}
          {wires.length === 1 ? "nonprofit" : "nonprofits"}
        </Text>
      )}

      {/* react-email's text conversion lays this out as rows and columns;
      unmarked, every cell runs into the next */}
      <table
        data-text-format="dataTable"
        style={{
          borderCollapse: "collapse",
          width: "100%",
          marginTop: 16,
        }}
      >
        <thead>
          <tr>
            <th style={th}>ID</th>
            <th style={th}>Name</th>
            <th style={th_right}>Grant</th>
            {nets && <th style={th_right}>Owed</th>}
            {nets && <th style={th_right}>Net</th>}
            <th style={th_right}>Min</th>
            <th style={th}>Effect</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={row_style[r.effect]}>
              <td style={td}>{r.id}</td>
              <td style={td}>{r.name}</td>
              <td
                style={
                  !nets && r.effect === "manual_wire"
                    ? { ...td_right, fontWeight: 600 }
                    : td_right
                }
              >
                {usd(r.amount)}
              </td>
              {nets && (
                <td style={td_right}>
                  {signed((r.deductions ?? []).reduce((a, d) => a + d.usd, 0))}
                </td>
              )}
              {nets && (
                <td
                  style={
                    r.effect === "manual_wire"
                      ? { ...td_right, fontWeight: 600 }
                      : td_right
                  }
                >
                  {r.net === undefined ? "—" : usd(r.net)}
                </td>
              )}
              <td style={td_right}>{usd(r.min)}</td>
              {r.effect === "manual_wire" ? (
                <td
                  style={{
                    ...td,
                    whiteSpace: "nowrap",
                    color: flat_colors.accent_11,
                    fontWeight: 600,
                  }}
                >
                  manual wire
                </td>
              ) : (
                <td style={td}>{r.effect}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {wires.length > 0 && (
        <Text
          style={{
            marginTop: 12,
            fontSize: 12,
            lineHeight: "18px",
            color: flat_colors.gray_11,
          }}
        >
          <b style={{ color: flat_colors.gray_12 }}>manual wire</b> is not sent
          by this run: send the {nets ? "Net" : "Grant"} less any wire fee, then
          mark it wired on the Manual wires page.
        </Text>
      )}

      {deductions.length > 0 && (
        <>
          <Text style={{ fontWeight: 600, marginTop: 24 }}>
            Deductions by gift
          </Text>
          <table
            data-text-format="dataTable"
            style={{ borderCollapse: "collapse", width: "100%" }}
          >
            <thead>
              <tr>
                <th style={th}>Gift</th>
                <th style={th}>NPO ID</th>
                <th style={th_right}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {deductions.map((d) => (
                <tr key={`${d.npo_id}:${d.donation_id}`}>
                  <td style={td}>{d.donation_id}</td>
                  <td style={td}>{d.npo_id}</td>
                  <td style={td_right}>{signed(d.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </PlatformLayout>
  );
}

export const template = (data: IData) => ({
  node: <Jsx {...data} />,
  subject: data.low_balance
    ? "WARNING: Low wise balance for grants"
    : "Grants schedule",
});
