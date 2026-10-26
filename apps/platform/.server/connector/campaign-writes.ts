import { BLOB_STORE_HOST } from "#/constants/urls";
import {
  campaign_end,
  campaign_get,
  campaign_publish,
  campaign_update,
} from "../pg/queries/campaign";
import type { DbOrTx } from "../pg/queries/helpers";
import { npo_program_get } from "../pg/queries/program";
import { json, open_key, valid_day } from "./http";
import { usd_amount } from "./money";
import { type FieldError, invalid, not_found, problem } from "./problem";
import { campaign_status, read_campaign_detail } from "./reads";
import { read_body, TITLE_MAX, unknown_keys } from "./writes";

const ended = () =>
  problem(409, "campaign_ended", {
    detail: "This campaign has ended, and an ended campaign stays ended.",
  });

const missing = (id: string) =>
  not_found(`Campaign ${id} does not exist for this nonprofit.`);

/** the key's nonprofit, or the response that ends the request */
async function open_action(
  db: DbOrTx,
  request: Request,
  method: "POST" | "PATCH"
): Promise<number | Response> {
  if (request.method !== method) return problem(404, "unknown_action");
  const live = await open_key(db, request);
  return live instanceof Response ? live : live.npo_id;
}

// past 12 whole digits a dollar amount stops holding its cents as a double
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const AMOUNT_MSG =
  'is a positive amount in US dollars, written like "2500" or "2500.50"';

/** a `Money` the detail would show, as dollars; null clears. undefined when
 * it is malformed, with the issues pushed */
function read_goal(
  value: unknown,
  path: string,
  issues: FieldError[]
): number | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push({
      path,
      message: 'is {amount, currency: "USD"}, or null for no goal',
    });
    return undefined;
  }
  const money = value as Record<string, unknown>;
  const before = issues.length;
  for (const key of Object.keys(money)) {
    if (key !== "amount" && key !== "currency") {
      issues.push({
        path: `${path}.${key}`,
        message: "is not a field of a goal",
      });
    }
  }
  const { amount, currency } = money;
  const dollars =
    typeof amount === "string" && AMOUNT.test(amount) ? Number(amount) : 0;
  if (!(dollars > 0))
    issues.push({ path: `${path}.amount`, message: AMOUNT_MSG });
  if (currency !== "USD") {
    issues.push({ path: `${path}.currency`, message: "is USD" });
  }
  return issues.length > before ? undefined : dollars;
}

/** `campaign_update`'s target for a goal, or undefined when the goal is
 * what the detail already shows. a smart target shows as no goal, so null
 * leaves it be. */
function goal_patch(
  dollars: number | null,
  current: { amount: string } | null
): string | undefined {
  if (dollars === null) return current ? "0" : undefined;
  if (current?.amount === usd_amount(dollars)) return undefined;
  return String(dollars);
}

const END_DATE_MSG = "is a day written YYYY-MM-DD, today or later, or null";

/** the inverse of `end_date_of`: the day's last instant, as the dashboard
 * editor writes it */
const ends_at_of = (day: string) => `${day}T23:59:59.999Z`;

async function detail(db: DbOrTx, npo_id: number, id: string) {
  const found = await read_campaign_detail(db, npo_id, id);
  return found ? json(found) : missing(id);
}

export async function end_campaign(
  db: DbOrTx,
  request: Request,
  id: string
): Promise<Response> {
  const npo_id = await open_action(db, request, "POST");
  if (npo_id instanceof Response) return npo_id;
  const parsed = await read_body(request, { allow_empty: true });
  if (!parsed.ok) return parsed.response;
  const issues: FieldError[] = [];
  unknown_keys(parsed.body, [], issues);
  if (issues.length > 0) return invalid(issues);
  if (!(await campaign_end(npo_id, id))) return missing(id);
  return detail(db, npo_id, id);
}

const GIFTS_GO_TO_REQUIRED =
  "is required on the first publish: a program id, or null for the general fund";
const GIFTS_GO_TO_SHAPE =
  "is a program id of this nonprofit, or null for the general fund";

export async function publish_campaign(
  db: DbOrTx,
  request: Request,
  id: string
): Promise<Response> {
  const npo_id = await open_action(db, request, "POST");
  if (npo_id instanceof Response) return npo_id;
  const row = await campaign_get(npo_id, id);
  if (!row) return missing(id);
  const parsed = await read_body(request, { allow_empty: true });
  if (!parsed.ok) return parsed.response;
  const issues: FieldError[] = [];
  unknown_keys(parsed.body, ["gifts_go_to"], issues);
  const sent = Object.hasOwn(parsed.body, "gifts_go_to");
  const to = parsed.body.gifts_go_to;
  if (sent && to !== null && typeof to !== "string") {
    issues.push({ path: "gifts_go_to", message: GIFTS_GO_TO_SHAPE });
  }
  if (issues.length > 0) return invalid(issues);
  if (campaign_status(row.status, row.ends_at) === "ended") return ended();

  // where a live campaign's gifts go is not re-routed from a chat
  if (row.published_at) {
    if (!sent || to === row.program_id) return detail(db, npo_id, id);
    return problem(409, "already_published", {
      detail:
        "This campaign is live. Where its gifts go is changed in the Better Giving dashboard.",
    });
  }

  if (!sent) {
    return invalid([{ path: "gifts_go_to", message: GIFTS_GO_TO_REQUIRED }]);
  }
  let program: { id: string; title: string } | null = null;
  if (typeof to === "string") {
    const found = await npo_program_get(to, npo_id);
    if (!found) {
      return invalid([{ path: "gifts_go_to", message: GIFTS_GO_TO_SHAPE }]);
    }
    program = found;
  }
  const wrote = await campaign_update(npo_id, id, {
    program_id: program?.id ?? null,
    program_name: program?.title ?? null,
  });
  if (wrote !== "ok") return missing(id);
  // false only when it ended since the read above
  if (!(await campaign_publish(npo_id, id))) return ended();
  return detail(db, npo_id, id);
}

const UNSUPPORTED = "is not supported on Better Giving";

export async function update_campaign_settings(
  db: DbOrTx,
  request: Request,
  id: string
): Promise<Response> {
  const npo_id = await open_action(db, request, "PATCH");
  if (npo_id instanceof Response) return npo_id;
  const current = await read_campaign_detail(db, npo_id, id);
  if (!current) return missing(id);
  const parsed = await read_body(request);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;
  const issues: FieldError[] = [];
  unknown_keys(body, ["goal", "end_date", "time_zone", "sharing"], issues);
  for (const key of ["time_zone", "sharing"]) {
    if (Object.hasOwn(body, key))
      issues.push({ path: key, message: UNSUPPORTED });
  }
  const patch: { target?: string; ends_at?: string | null } = {};
  if (Object.hasOwn(body, "goal")) {
    const dollars = read_goal(body.goal, "goal", issues);
    if (dollars !== undefined) {
      const target = goal_patch(dollars, current.goal);
      if (target !== undefined) patch.target = target;
    }
  }
  const end_date = body.end_date;
  if (end_date !== undefined && end_date !== current.end_date) {
    const today = new Date().toISOString().slice(0, 10);
    if (end_date === null) patch.ends_at = null;
    else if (
      typeof end_date === "string" &&
      valid_day(end_date) &&
      end_date >= today
    ) {
      patch.ends_at = ends_at_of(end_date);
    } else issues.push({ path: "end_date", message: END_DATE_MSG });
  }
  if (issues.length > 0) return invalid(issues);
  if (current.status === "ended") return ended();
  if (Object.keys(patch).length === 0) return json(current);
  if ((await campaign_update(npo_id, id, patch)) !== "ok") return missing(id);
  return detail(db, npo_id, id);
}

const STORY_MAX = 10_000;
const BLOCK_ORDER = ["title", "story", "hero", "goal-bar"] as const;
type BlockType = (typeof BLOCK_ORDER)[number];
const BLOCK_KEYS: Record<BlockType, string> = {
  title: "text",
  story: "text",
  hero: "image_url",
  "goal-bar": "goal",
};
const BLOCKS_MSG = `is the campaign's ${BLOCK_ORDER.length} blocks, ${BLOCK_ORDER.join(", ")}, in the order get_campaign returns them`;

const is_block_type = (t: unknown): t is BlockType =>
  BLOCK_ORDER.includes(t as BlockType);

const own_image = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.host === BLOB_STORE_HOST;
  } catch {
    return false;
  }
};

/** plain text as portable text: one unmarked block per paragraph, a
 * paragraph being the text between blank lines */
function story_pt(text: string): string {
  const key = () => crypto.randomUUID().slice(0, 12);
  const blocks = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({
      _type: "block",
      _key: key(),
      style: "normal",
      markDefs: [],
      children: [{ _type: "span", _key: key(), text: p, marks: [] }],
    }));
  return JSON.stringify(blocks);
}

type Current = NonNullable<Awaited<ReturnType<typeof read_campaign_detail>>>;
type BlocksPatch = {
  name?: string;
  description_pt?: string;
  banner?: string | null;
  target?: string;
};

/** the write the list asks for, leaving out every block that matches what
 * the detail shows, so a story or image read back unchanged keeps what is
 * stored behind it */
function read_blocks(
  value: unknown,
  current: Current,
  issues: FieldError[]
): BlocksPatch {
  const patch: BlocksPatch = {};
  if (!Array.isArray(value) || value.length !== BLOCK_ORDER.length) {
    issues.push({ path: "blocks", message: BLOCKS_MSG });
    return patch;
  }
  const shown = (type: BlockType) =>
    current.blocks.find((b) => b.type === type) as Record<string, unknown>;
  value.forEach((raw: unknown, i) => {
    const at = `blocks[${i}]`;
    const want = BLOCK_ORDER[i]!;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      issues.push({ path: at, message: `is the ${want} block` });
      return;
    }
    const block = raw as Record<string, unknown>;
    if (block.type !== want) {
      issues.push({
        path: `${at}.type`,
        message: is_block_type(block.type)
          ? `is "${want}": the blocks stay in the order get_campaign returns them`
          : `is "${want}", one of ${BLOCK_ORDER.join(", ")}`,
      });
      return;
    }
    const field = BLOCK_KEYS[want];
    for (const key of Object.keys(block)) {
      if (key !== "type" && key !== field) {
        issues.push({
          path: `${at}.${key}`,
          message: `is not a field of a ${want} block`,
        });
      }
    }
    const v = block[field];
    const path = `${at}.${field}`;
    if (v === shown(want)[field] && want !== "goal-bar") return;
    if (want === "title") {
      const name = typeof v === "string" ? v.trim() : "";
      if (name.length < 1 || name.length > TITLE_MAX) {
        issues.push({
          path,
          message: `is the campaign's name, 1 to ${TITLE_MAX} characters`,
        });
      } else if (name !== current.title) patch.name = name;
    } else if (want === "story") {
      if (typeof v !== "string" || v.length > STORY_MAX) {
        issues.push({
          path,
          message: `is plain text up to ${STORY_MAX} characters, with a blank line between paragraphs`,
        });
      } else patch.description_pt = story_pt(v);
    } else if (want === "hero") {
      if (v === null) patch.banner = null;
      else if (typeof v === "string" && own_image(v)) patch.banner = v;
      else {
        issues.push({
          path,
          message:
            "is null, or the link to a photo uploaded through create_photo_upload_link",
        });
      }
    } else {
      const dollars = read_goal(v, path, issues);
      if (dollars !== undefined) {
        const target = goal_patch(dollars, current.goal);
        if (target !== undefined) patch.target = target;
      }
    }
  });
  return patch;
}

export async function update_campaign_blocks(
  db: DbOrTx,
  request: Request,
  id: string
): Promise<Response> {
  const npo_id = await open_action(db, request, "PATCH");
  if (npo_id instanceof Response) return npo_id;
  const current = await read_campaign_detail(db, npo_id, id);
  if (!current) return missing(id);
  const parsed = await read_body(request);
  if (!parsed.ok) return parsed.response;
  const issues: FieldError[] = [];
  unknown_keys(parsed.body, ["blocks"], issues);
  const patch = read_blocks(parsed.body.blocks, current, issues);
  if (issues.length > 0) return invalid(issues);
  if (Object.keys(patch).length === 0) return json(current);
  if ((await campaign_update(npo_id, id, patch)) !== "ok") return missing(id);
  return detail(db, npo_id, id);
}
