import { eq } from "drizzle-orm";
import { to_text } from "#/components/rich-text/helpers";
import type { DbOrTx } from "../pg/queries/helpers";
import { campaign_members, campaigns } from "../pg/schema/campaign";
import { npos } from "../pg/schema/npo";
import { json, open_key } from "./http";
import { with_idempotency } from "./idempotency";
import { type FieldError, invalid, problem } from "./problem";
import { read_campaign_detail } from "./reads";

export const TITLE_MAX = 200;

type Issue = FieldError;

function campaign_slug(title: string, id: string): string {
  const stem = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `${stem || "campaign"}-${id.slice(0, 8)}`;
}

function as_record(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

export function unknown_keys(
  body: Record<string, unknown>,
  allowed: readonly string[],
  issues: Issue[]
) {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      issues.push({ path: key, message: "is not a field on this action" });
    }
  }
}

/** `allow_empty`: no body at all reads as `{}` */
export async function read_body(
  request: Request,
  { allow_empty = false } = {}
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  const issues: Issue[] = [];
  let parsed: unknown;
  try {
    const text = await request.text();
    parsed = allow_empty && text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    issues.push({ path: "", message: "is a JSON object" });
    return { ok: false, response: invalid(issues) };
  }
  const body = as_record(parsed);
  if (!body) {
    return {
      ok: false,
      response: invalid([{ path: "", message: "is a JSON object" }]),
    };
  }
  return { ok: true, body };
}

export async function create_campaign(
  db: DbOrTx,
  request: Request
): Promise<Response> {
  if (request.method !== "POST") return problem(404, "unknown_action");
  const live = await open_key(db, request);
  if (live instanceof Response) return live;
  return with_idempotency(db, live.id, request, () =>
    insert_campaign(db, live.npo_id, live.allowed_by, request)
  );
}

async function insert_campaign(
  db: DbOrTx,
  npo_id: number,
  allowed_by: string,
  request: Request
): Promise<Response> {
  const parsed = await read_body(request);
  if (!parsed.ok) return parsed.response;
  const issues: Issue[] = [];
  unknown_keys(parsed.body, ["title"], issues);
  const title = parsed.body.title;
  const trimmed = typeof title === "string" ? title.trim() : "";
  if (
    typeof title !== "string" ||
    trimmed.length < 1 ||
    trimmed.length > TITLE_MAX
  ) {
    issues.push({
      path: "title",
      message: `is the campaign's name, 1 to ${TITLE_MAX} characters`,
    });
  }
  if (issues.length > 0) return invalid(issues);

  try {
    const id = crypto.randomUUID();
    const detail = await db.transaction(async (tx) => {
      const [npo] = await tx
        .select({
          logo: npos.logo,
          image: npos.image,
          card_img: npos.card_img,
        })
        .from(npos)
        .where(eq(npos.id, npo_id));
      if (!npo) throw new Error("npo missing");
      const image = npo.logo || npo.image || npo.card_img || null;
      const description_pt = "[]";
      await tx.insert(campaigns).values({
        id,
        owner_npo_id: npo_id,
        creator_id: allowed_by,
        name: trimmed,
        slug: campaign_slug(trimmed, id),
        description_pt,
        description_v2: to_text(description_pt),
        banner: image,
        logo: image,
        status: "draft",
      });
      await tx.insert(campaign_members).values({
        campaign_id: id,
        npo_id,
        position: 0,
      });
      return read_campaign_detail(tx, npo_id, id);
    });
    if (!detail) {
      return problem(500, "write_failed", {
        detail: "The campaign could not be saved.",
      });
    }
    return json(detail, 201);
  } catch {
    return problem(500, "write_failed", {
      detail: "The campaign could not be saved.",
    });
  }
}
