import { afterEach, describe, expect, test, vi } from "vitest";
import { Slack } from "./slack";

const TOKEN = "xoxb-test-token";
const CHANNEL = "C0CBGUJ20KC";
// https://docs.slack.dev/reference/block-kit/blocks/section-block
const section_text_max = 3000;

type AlertBlock =
  | { type: "section"; text: { type: "mrkdwn"; text: string } }
  | { type: "section"; fields: { type: "mrkdwn"; text: string }[] }
  | { type: "context"; elements: { type: "mrkdwn"; text: string }[] };

function posted() {
  const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
  const headers = new Headers(init?.headers);
  return {
    url: String(url),
    method: init?.method,
    authorization: headers.get("authorization"),
    content_type: headers.get("content-type"),
    body: JSON.parse(String(init?.body)) as {
      channel: string;
      text: string;
      attachments: { color: string; blocks: unknown[] }[];
    },
  };
}

function alert_blocks() {
  return posted().body.attachments[0]!.blocks as AlertBlock[];
}

/** mrkdwn section texts after the title block */
function body_sections(blocks: AlertBlock[]) {
  return blocks
    .flatMap((block) => ("text" in block ? [block.text.text] : []))
    .slice(1);
}

function mock_fetch(response: () => Response) {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(response())
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Slack.send_alert", () => {
  test("posts a notice to chat.postMessage", async () => {
    mock_fetch(() => Response.json({ ok: true }));
    await new Slack(CHANNEL, TOKEN).send_alert({
      from: "grants-processor:staging",
      title: "No grants to process",
      body: "No grants to process for staging",
      fields: [
        { name: "amount", value: "12.5", inline: true },
        { name: "ref_id", value: "ref-1" },
      ],
    });

    const req = posted();
    expect(req.url).toBe("https://slack.com/api/chat.postMessage");
    expect(req.method).toBe("POST");
    expect(req.authorization).toBe(`Bearer ${TOKEN}`);
    expect(req.content_type).toBe("application/json");
    expect(req.body).toEqual({
      channel: CHANNEL,
      text: "No grants to process",
      attachments: [
        {
          // hex of BLUE 2856675
          color: "#2b96e3",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                verbatim: true,
                text: "*No grants to process*",
              },
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                verbatim: true,
                text: "No grants to process for staging",
              },
            },
            {
              type: "section",
              fields: [
                { type: "mrkdwn", verbatim: true, text: "*amount*\n12.5" },
                { type: "mrkdwn", verbatim: true, text: "*ref_id*\nref-1" },
              ],
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  verbatim: true,
                  text: "grants-processor:staging",
                },
              ],
            },
          ],
        },
      ],
    });
  });

  test("escapes a channel mention in the title", async () => {
    mock_fetch(() => Response.json({ ok: true }));
    await new Slack(CHANNEL, TOKEN).send_alert({
      from: "grants-processor",
      title: "grant for <!channel> stalled",
    });

    const req = posted();
    expect(req.body.text).toBe("grant for &lt;!channel&gt; stalled");
    expect(alert_blocks()[0]).toEqual({
      type: "section",
      text: {
        type: "mrkdwn",
        verbatim: true,
        text: "*grant for &lt;!channel&gt; stalled*",
      },
    });
  });

  test("posts an error in red with the title prefixed ERROR:", async () => {
    mock_fetch(() => Response.json({ ok: true }));
    await new Slack(CHANNEL, TOKEN).send_alert({
      type: "ERROR",
      from: "chariot-webhook:staging",
      title: "Chariot Grant Without A Donation",
      body: "grant arrived with no donation row",
    });

    const req = posted();
    expect(req.body.text).toBe("ERROR:Chariot Grant Without A Donation");
    const attachment = req.body.attachments[0]!;
    expect(attachment.color).toBe("#c70039");
    expect(attachment.blocks[0]).toEqual({
      type: "section",
      text: {
        type: "mrkdwn",
        verbatim: true,
        text: "*ERROR:Chariot Grant Without A Donation*",
      },
    });
  });

  test("escapes an ampersand in a field value", async () => {
    mock_fetch(() => Response.json({ ok: true }));
    await new Slack(CHANNEL, TOKEN).send_alert({
      from: "grants-processor",
      title: "payout recorded",
      fields: [{ name: "nonprofit", value: "A & B" }],
    });

    const blocks = alert_blocks();
    const fields_block = blocks.find((block) => "fields" in block);
    expect(fields_block).toEqual({
      type: "section",
      fields: [
        { type: "mrkdwn", verbatim: true, text: "*nonprofit*\nA &amp; B" },
      ],
    });
  });

  test("omits body and field sections when they are absent", async () => {
    mock_fetch(() => Response.json({ ok: true }));
    await new Slack(CHANNEL, TOKEN).send_alert({
      from: "owed notices",
      title: "No grants to process",
    });

    const blocks = posted().body.attachments[0]!.blocks;
    expect(blocks).toEqual([
      {
        type: "section",
        text: {
          type: "mrkdwn",
          verbatim: true,
          text: "*No grants to process*",
        },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", verbatim: true, text: "owed notices" }],
      },
    ]);

    await new Slack(CHANNEL, TOKEN).send_alert({
      from: "owed notices",
      title: "No grants to process",
      fields: [],
    });
    const with_empty_fields = vi.mocked(globalThis.fetch).mock.calls[1]!;
    const empty_body = JSON.parse(String(with_empty_fields[1]?.body)) as {
      attachments: { blocks: { type: string; fields?: unknown }[] }[];
    };
    expect(empty_body.attachments[0]!.blocks.map((b) => b.type)).toEqual([
      "section",
      "context",
    ]);
  });

  test("throws the http status when slack does not answer ok", async () => {
    mock_fetch(() =>
      Response.json({ ok: false, error: "internal_error" }, { status: 503 })
    );
    await expect(
      new Slack(CHANNEL, TOKEN).send_alert({
        from: "owed notices",
        title: "No grants to process",
      })
    ).rejects.toThrow("503");
  });

  test("throws slack's error when the body is ok false", async () => {
    mock_fetch(() => Response.json({ ok: false, error: "invalid_auth" }));
    await expect(
      new Slack(CHANNEL, TOKEN).send_alert({
        from: "owed notices",
        title: "No grants to process",
      })
    ).rejects.toThrow("invalid_auth");
  });

  test("resolves when slack answers ok", async () => {
    mock_fetch(() => Response.json({ ok: true }));
    await expect(
      new Slack(CHANNEL, TOKEN).send_alert({
        from: "owed notices",
        title: "No grants to process",
      })
    ).resolves.toBeInstanceOf(Response);
  });

  test("escapes a less-than in the body before the section limit", async () => {
    mock_fetch(() => Response.json({ ok: true }));
    const body = `<${"c".repeat(section_text_max - 1)}`;
    await new Slack(CHANNEL, TOKEN).send_alert({
      from: "grants-processor",
      title: "payouts claimed but not settled",
      body,
    });

    const escaped = `&lt;${"c".repeat(section_text_max - 1)}`;
    const texts = body_sections(alert_blocks());
    expect(texts.every((text) => text.length <= section_text_max)).toBe(true);
    expect(texts.join("")).toBe(escaped);
  });

  test("posts a body of the section maximum as one section", async () => {
    mock_fetch(() => Response.json({ ok: true }));
    const body = "a".repeat(section_text_max);
    await new Slack(CHANNEL, TOKEN).send_alert({
      from: "grants-processor",
      title: "payouts claimed but not settled",
      body,
    });

    const blocks = alert_blocks();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    expect(blocks[0]).toEqual({
      type: "section",
      text: {
        type: "mrkdwn",
        verbatim: true,
        text: "*payouts claimed but not settled*",
      },
    });
    expect(body_sections(blocks)).toEqual([body]);
    expect(blocks.at(-1)).toEqual({
      type: "context",
      elements: [{ type: "mrkdwn", verbatim: true, text: "grants-processor" }],
    });
  });

  test("splits a body one character over the section maximum into two sections", async () => {
    mock_fetch(() => Response.json({ ok: true }));
    const body = "b".repeat(section_text_max + 1);
    await new Slack(CHANNEL, TOKEN).send_alert({
      from: "grants-processor",
      title: "payouts claimed but not settled",
      body,
      fields: [{ name: "count", value: "2" }],
    });

    const blocks = alert_blocks();
    const texts = body_sections(blocks);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    expect(texts).toHaveLength(2);
    expect(texts.every((text) => text.length <= section_text_max)).toBe(true);
    expect(texts.join("")).toBe(body);
    expect(blocks[0]).toEqual({
      type: "section",
      text: {
        type: "mrkdwn",
        verbatim: true,
        text: "*payouts claimed but not settled*",
      },
    });
    expect(blocks.at(-2)).toEqual({
      type: "section",
      fields: [{ type: "mrkdwn", verbatim: true, text: "*count*\n2" }],
    });
    expect(blocks.at(-1)).toEqual({
      type: "context",
      elements: [{ type: "mrkdwn", verbatim: true, text: "grants-processor" }],
    });
  });

  test("splits one line longer than the section maximum at the maximum", async () => {
    mock_fetch(() => Response.json({ ok: true }));
    const body = "z".repeat(section_text_max * 2 + 1);
    await new Slack(CHANNEL, TOKEN).send_alert({
      from: "grants-processor",
      title: "payouts claimed but not settled",
      body,
    });

    const texts = body_sections(alert_blocks());
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    expect(texts).toEqual([
      body.slice(0, section_text_max),
      body.slice(section_text_max, section_text_max * 2),
      body.slice(section_text_max * 2),
    ]);
  });

  test("splits a multiline body on the last newline that fits", async () => {
    mock_fetch(() => Response.json({ ok: true }));
    const line_a = "npo:1 ref r1: 101";
    // both newlines sit in the first window, and line_b puts the body over it
    const filler = "m".repeat(2970);
    const line_b = "npo:2 ref r2: 202";
    const body = `${line_a}\n${filler}\n${line_b}`;

    await new Slack(CHANNEL, TOKEN).send_alert({
      from: "grants-processor",
      title: "payouts claimed but not settled",
      body,
    });

    const texts = body_sections(alert_blocks());
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    expect(texts).toEqual([`${line_a}\n${filler}\n`, line_b]);
  });
});

describe("Slack.send_alert with skip_bad_credential", () => {
  const alert = { from: "test", title: "Payout split" };

  test.each([
    ["invalid_auth", () => Response.json({ ok: false, error: "invalid_auth" })],
    [
      "token_revoked",
      () => Response.json({ ok: false, error: "token_revoked" }),
    ],
    ["a 401", () => new Response("{}", { status: 401 })],
  ])("resolves on %s", async (_, response) => {
    mock_fetch(response);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await new Slack(CHANNEL, TOKEN, true).send_alert(alert);

    expect(res.ok).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });

  test("resolves without posting when there is no token", async () => {
    mock_fetch(() => Response.json({ ok: true }));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await new Slack(CHANNEL, undefined, true).send_alert(alert);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("still throws a refusal that is not the credential", async () => {
    mock_fetch(() => Response.json({ ok: false, error: "channel_not_found" }));

    await expect(
      new Slack(CHANNEL, TOKEN, true).send_alert(alert)
    ).rejects.toThrow("slack channel_not_found");
  });

  test("off by default: a refused token throws", async () => {
    mock_fetch(() => Response.json({ ok: false, error: "invalid_auth" }));

    await expect(new Slack(CHANNEL, TOKEN).send_alert(alert)).rejects.toThrow(
      "slack invalid_auth"
    );
  });
});

describe("Slack.send_alert structured content", () => {
  type TableBlock = {
    type: "table";
    column_settings: { align: string; is_wrapped: boolean }[];
    rows: { type: "raw_text"; text: string }[][];
  };

  const send = async (alert: Partial<Parameters<Slack["send_alert"]>[0]>) => {
    mock_fetch(() => Response.json({ ok: true }));
    await new Slack(CHANNEL, TOKEN).send_alert({
      from: "test",
      title: "t",
      ...alert,
    });
    const blocks = posted().body.attachments[0]!.blocks as {
      type: string;
    }[];
    return {
      blocks,
      table: blocks.find((b) => b.type === "table") as TableBlock | undefined,
    };
  };
  const cols = [{ name: "Party" }, { name: "Owed", align: "right" as const }];

  test("puts the table in the attachment's blocks, before the sender", async () => {
    const { blocks, table } = await send({
      table: { columns: cols, rows: [["Save the Kids (#4)", "4.91"]] },
    });
    expect(blocks.map((b) => b.type)).toEqual(["section", "table", "context"]);
    expect(table).toEqual({
      type: "table",
      column_settings: [
        { align: "left", is_wrapped: true },
        { align: "right", is_wrapped: false },
      ],
      rows: [
        [
          { type: "raw_text", text: "Party" },
          { type: "raw_text", text: "Owed" },
        ],
        [
          { type: "raw_text", text: "Save the Kids (#4)" },
          { type: "raw_text", text: "4.91" },
        ],
      ],
    });
  });

  test("sends an empty cell as a dash and pads a short row", async () => {
    const { table } = await send({
      table: { columns: cols, rows: [["", "  "], ["Total"]] },
    });
    const texts = table!.rows.map((r) => r.map((c) => c.text));
    expect(texts).toEqual([
      ["Party", "Owed"],
      ["—", "—"],
      ["Total", "—"],
    ]);
  });

  test("keeps table cells raw, not escaped", async () => {
    const { table } = await send({
      table: { columns: cols, rows: [["A & <B>", "1"]] },
    });
    expect(table!.rows[1]![0]!.text).toBe("A & <B>");
  });

  test("cuts rows past the row limit with a +N more row", async () => {
    const rows = Array.from({ length: 150 }, (_, i) => [`p${i}`, "1"]);
    const { table } = await send({ table: { columns: cols, rows } });
    expect(table!.rows).toHaveLength(100);
    expect(table!.rows[98]![0]!.text).toBe("p97");
    expect(table!.rows[99]!.map((c) => c.text)).toEqual(["+52 more", "—"]);
  });

  test("cuts rows past the character limit", async () => {
    const rows = Array.from({ length: 20 }, () => ["x".repeat(900), "1"]);
    const { table } = await send({ table: { columns: cols, rows } });
    const chars = table!.rows.flat().reduce((n, c) => n + c.text.length, 0);
    expect(chars).toBeLessThanOrEqual(10_000);
    const last = table!.rows.at(-1)![0]!.text;
    expect(last).toMatch(/^\+\d+ more$/);
  });

  test("limits a row to 20 cells", async () => {
    const columns = Array.from({ length: 25 }, (_, i) => ({ name: `c${i}` }));
    const { table } = await send({ table: { columns, rows: [["a"]] } });
    expect(table!.rows.every((r) => r.length === 20)).toBe(true);
  });

  test("escapes the note, action and context lines, and links the action", async () => {
    const { blocks } = await send({
      note: "a <!here> note",
      action: { text: "Respond & win", url: "https://x.test/a?b=1" },
      context: ["donation <!channel>"],
    });
    expect(blocks.slice(1, 4)).toEqual([
      {
        type: "section",
        text: { type: "mrkdwn", verbatim: true, text: "a &lt;!here&gt; note" },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          verbatim: true,
          text: "<https://x.test/a?b=1|Respond &amp; win>",
        },
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", verbatim: true, text: "donation &lt;!channel&gt;" },
        ],
      },
    ]);
  });

  test("splits a note past the section limit into sections", async () => {
    const note = `${"a".repeat(2000)}\n${"b".repeat(2000)}`;
    const { blocks } = await send({ note });
    const sections = blocks.slice(1, -1) as unknown as {
      text: { text: string };
    }[];
    expect(sections).toHaveLength(2);
    expect(sections.every((s) => s.text.text.length <= 3000)).toBe(true);
    expect(sections.map((s) => s.text.text).join("")).toBe(note);
  });

  test("sends every mrkdwn text verbatim so a plain @channel is no mention", async () => {
    const { blocks } = await send({
      title: "@channel",
      fields: [{ name: "Donor", value: "@here" }],
      note: "@everyone",
      context: ["@channel"],
    });
    const texts = JSON.stringify(blocks).match(/"type":"mrkdwn"[^}]*/g) ?? [];
    expect(texts.length).toBeGreaterThanOrEqual(5);
    expect(texts.every((t) => t.includes('"verbatim":true'))).toBe(true);
  });

  test("cuts a long title and field value inside slack's limits", async () => {
    const long = "n".repeat(5000);
    const { blocks } = await send({
      title: long,
      fields: [{ name: "Donor", value: long }],
    });
    const [title, fields] = blocks as unknown as {
      text?: { text: string };
      fields?: { text: string }[];
    }[];
    expect(title!.text!.text.length).toBeLessThan(3000);
    expect(fields!.fields![0]!.text.length).toBeLessThan(2000);
    expect(fields!.fields![0]!.text.endsWith("…")).toBe(true);
  });

  test("uses the summary as the notification text", async () => {
    mock_fetch(() => Response.json({ ok: true }));
    await new Slack(CHANNEL, TOKEN).send_alert({
      from: "test",
      title: "Title",
      summary: "$6.00 to <!here> Kids",
    });
    expect(posted().body.text).toBe("$6.00 to &lt;!here&gt; Kids");
  });
});
