// https://docs.slack.dev/reference/methods/chat.postMessage
// header plain_text is 150 characters. grant titles include npos.name
// (text, no length cap in .server/pg/schema/npo.ts), so a header can be rejected.

export interface Field {
  name: string;
  value: string;
  inline?: true;
}

export interface Alert {
  /** context block: the sender identity every caller sets */
  from: string;
  /** mrkdwn section */
  title: string;
  /** mrkdwn section */
  body?: string;

  /** additional structured content */
  fields?: Field[];
  /*
   * ERROR: accent is red; title is prepended i.e ERROR:{title}
   * @default "NOTICE"
   */
  type?: "ERROR" | "NOTICE";
}

const RED = 13041721;
const BLUE = 2856675;

const POST_MESSAGE = "https://slack.com/api/chat.postMessage";
// https://docs.slack.dev/reference/methods/chat.postMessage#errors
const CREDENTIAL_ERRORS = new Set([
  "not_authed",
  "invalid_auth",
  "account_inactive",
  "token_revoked",
  "token_expired",
]);
// https://docs.slack.dev/reference/block-kit/blocks/section-block
const SECTION_TEXT_MAX = 3000;

export class Slack {
  private channel_id: string;
  private bot_token: string | undefined;
  private skip_bad_credential: boolean;

  /** `skip_bad_credential`: a missing or refused token resolves with a
   * warning instead of throwing. the server turns it on off production only */
  constructor(
    channel_id: string,
    bot_token: string | undefined,
    skip_bad_credential = false
  ) {
    this.channel_id = channel_id;
    this.bot_token = bot_token;
    this.skip_bad_credential = skip_bad_credential;
  }

  private skipped(reason: string, title: string): Response {
    console.warn(`slack post not sent (${reason}): ${title}`);
    return Response.json({ ok: true, skipped: reason });
  }

  async send_alert({ type = "NOTICE", ...alert }: Alert) {
    const visible = escape_mrkdwn(
      type === "NOTICE" ? alert.title : `ERROR:${alert.title}`
    );
    if (!this.bot_token && this.skip_bad_credential) {
      return this.skipped("no bot token", visible);
    }
    const color = type === "NOTICE" ? BLUE : RED;
    const blocks: Block[] = [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${visible}*` },
      },
    ];
    if (alert.body) {
      // one post. a second message that fails is retried, duplicating the first chunk
      for (const text of chunk_section_text(escape_mrkdwn(alert.body))) {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text },
        });
      }
    }
    if (alert.fields?.length) {
      blocks.push({
        type: "section",
        fields: alert.fields.map((f) => ({
          type: "mrkdwn",
          text: `*${escape_mrkdwn(f.name)}*\n${escape_mrkdwn(f.value)}`,
        })),
      });
    }
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: escape_mrkdwn(alert.from) }],
    });

    const res = await global.fetch(POST_MESSAGE, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${this.bot_token}`,
      },
      body: JSON.stringify({
        channel: this.channel_id,
        // notification fallback. attachment blocks are not the message text
        text: visible,
        attachments: [
          { color: `#${color.toString(16).padStart(6, "0")}`, blocks },
        ],
      }),
    });
    const failure = await refusal(res);
    if (!failure) return res;
    if (
      this.skip_bad_credential &&
      (res.status === 401 || CREDENTIAL_ERRORS.has(failure.code ?? ""))
    ) {
      return this.skipped(failure.message, visible);
    }
    throw failure;
  }
}

// slack parses <!channel>, <!here>, and <!everyone> in mrkdwn
function escape_mrkdwn(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function chunk_section_text(text: string): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > SECTION_TEXT_MAX) {
    const head = rest.slice(0, SECTION_TEXT_MAX);
    const newline = head.lastIndexOf("\n");
    // keep the newline in this chunk so the next section starts on the next line
    const cut = newline === -1 ? SECTION_TEXT_MAX : newline + 1;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

type Text = { type: "mrkdwn"; text: string };
type Block =
  | { type: "section"; text: Text }
  | { type: "section"; fields: Text[] }
  | { type: "context"; elements: Text[] };

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

class SlackRefusal extends Error {
  /** slack's `error` string, when it sent one */
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/** `chat.postMessage` answers HTTP 200 with `{ ok: false }` for a refused post. */
async function refusal(res: Response): Promise<SlackRefusal | undefined> {
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return new SlackRefusal(
      res.ok
        ? "slack: response was not json"
        : `slack ${res.status}: response was not json`
    );
  }
  if (res.ok && is_record(json) && json.ok === true) return;
  const error =
    is_record(json) && typeof json.error === "string" ? json.error : undefined;
  const detail = [!res.ok ? String(res.status) : undefined, error]
    .filter((part): part is string => part !== undefined)
    .join(": ");
  return new SlackRefusal(detail ? `slack ${detail}` : "slack: not ok", error);
}
