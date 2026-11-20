import { flat_colors } from "@better-giving/brand/flat";
import { grants_schedule } from "emails";
import { beforeEach, describe, expect, test, vi } from "vitest";

// the real send path, mocked only at the transport, so the text part asserted
// is the one the provider receives
const send_mail = vi.hoisted(() => vi.fn());
vi.mock("nodemailer", () => {
  const createTransport = () => ({ sendMail: send_mail });
  return { default: { createTransport }, createTransport };
});
vi.mock("$/env", () => ({ smtp: { password: "test-token" }, stage: "test" }));
vi.mock("#/errors/report", () => ({ report_error: vi.fn() }));

const { send_email } = await import("$/email");
const { WIRE_PROVIDERS } = await import("@/payouts");

const sent = async (data: grants_schedule.IData) => {
  await send_email({ ...grants_schedule.template(data), to: ["ops@test.com"] });
  const [mail] = send_mail.mock.calls[0]!;
  return { text: mail.text as string, html: mail.html as string };
};
const sent_text = async (data: grants_schedule.IData) =>
  (await sent(data)).text;

type Row = grants_schedule.IData["rows"][number];
const schedule = (rows: Row[]): grants_schedule.IData => ({
  rows,
  total_grant: 250,
  wise_usd_balance: 2000,
  report_period: "2605",
  low_balance: false,
});
const pass_row: Row = {
  id: 1,
  name: "Save The Rainforest",
  amount: 250,
  min: 50,
  effect: "pass",
  net: 250,
  deductions: [],
};
const wire_row = (id: number, name: string, net: number): Row => ({
  id,
  name,
  amount: 4812.4,
  min: 100,
  effect: "manual_wire",
  net,
  deductions: [{ donation_id: `don-${id}`, usd: 612.4 }],
});
/** the tint a manual-wire row takes, as the html carries it */
const tint = `background-color:${flat_colors.accent_2}`;
const LEGEND =
  "manual wire is not sent by this run: send the Net by wire, then mark it wired on the Manual wires page.";

/** the text line beginning with `first`, split on the column gutter */
const row_cells = (text: string, first: string) =>
  text
    .split("\n")
    .find((l) => l.trimStart().startsWith(`${first} `))
    ?.trim()
    .split(/\s{2,}/);

beforeEach(() => {
  send_mail.mockReset();
  send_mail.mockResolvedValue({ messageId: "<m@bg>", response: "250 ok" });
});

describe("grants schedule text part", () => {
  test("each grant is its own line with its cells apart", async () => {
    const text = await sent_text({
      rows: [
        {
          id: 12,
          name: "Save The Rainforest",
          amount: 1234.567,
          min: 50,
          effect: "pass",
        },
        { id: 7, name: "River Trust", amount: 20, min: 50, effect: "skipped" },
      ],
      total_grant: 1234.567,
      wise_usd_balance: 5000,
      report_period: "2610",
      low_balance: false,
    });

    expect(row_cells(text, "12")).toEqual([
      "12",
      "Save The Rainforest",
      "$1,234.57",
      "$50.00",
      "pass",
    ]);
    expect(row_cells(text, "7")).toEqual([
      "7",
      "River Trust",
      "$20.00",
      "$50.00",
      "skipped",
    ]);
  });

  test("a run netting what npos owe shows each one's gross, owed and net, and each deduction by gift", async () => {
    const text = await sent_text({
      rows: [
        {
          id: 12,
          name: "Save The Rainforest",
          amount: 500,
          min: 50,
          effect: "pass",
          net: 406.8,
          deductions: [{ donation_id: "don-owed", usd: 93.2 }],
        },
        {
          id: 7,
          name: "River Trust",
          amount: 300,
          min: 50,
          effect: "pass",
          net: 350,
          deductions: [{ donation_id: "don-credited", usd: -50 }],
        },
      ],
      total_grant: 756.8,
      wise_usd_balance: 5000,
      report_period: "2610",
      low_balance: false,
    });

    expect(row_cells(text, "12")).toEqual([
      "12",
      "Save The Rainforest",
      "$500.00",
      "−$93.20",
      "$406.80",
      "$50.00",
      "pass",
    ]);
    expect(row_cells(text, "don-owed")).toEqual(["don-owed", "12", "−$93.20"]);
    expect(row_cells(text, "don-credited")).toEqual([
      "don-credited",
      "7",
      "+$50.00",
    ]);
  });

  test("a manual-wire row reads manual wire, and the schedule carries the wires' total, the legend and the row's tint", async () => {
    const { text, html } = await sent(
      schedule([pass_row, wire_row(1293826, "SXM Paws", 4200)])
    );

    expect(text).toContain("Manual wires: $4,200.00 · 1 nonprofit");
    expect(text).toContain(LEGEND);
    expect(row_cells(text, "1293826")).toEqual([
      "1293826",
      "SXM Paws",
      "$4,812.40",
      "−$612.40",
      "$4,200.00",
      "$100.00",
      "manual wire",
    ]);
    expect(row_cells(text, "don-1293826")).toEqual([
      "don-1293826",
      "1293826",
      "−$612.40",
    ]);
    expect(html).toContain(tint);
    expect(text).toContain("Grant total: $250.00");
  });

  test("more than one manual wire counts its nonprofits in the plural and sums their nets", async () => {
    const { text } = await sent(
      schedule([
        wire_row(11, "SXM Paws", 4200),
        wire_row(12, "Reef Aid", 150.5),
      ])
    );

    expect(text).toContain("Manual wires: $4,350.50 · 2 nonprofits");
  });

  test("with no manual-wire row there is no wires line, no legend and no tint", async () => {
    const { text, html } = await sent(schedule([pass_row]));

    expect(text).not.toContain("Manual wires:");
    expect(text).not.toContain("manual wire");
    expect(html).not.toContain(tint);
  });

  test("no provider is named anywhere in a schedule with a manual wire", async () => {
    const { text, html } = await sent(
      schedule([pass_row, wire_row(1293826, "SXM Paws", 4200)])
    );

    for (const provider of WIRE_PROVIDERS) {
      expect(text).not.toContain(provider);
      expect(html).not.toContain(provider);
    }
  });
});
