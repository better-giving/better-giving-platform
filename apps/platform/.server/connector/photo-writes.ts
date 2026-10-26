import { campaign_get } from "../pg/queries/campaign";
import type { DbOrTx } from "../pg/queries/helpers";
import { json, open_key } from "./http";
import { absolute } from "./money";
import { issue_photo_link } from "./photo-links";
import {
  campaign_ended,
  type FieldError,
  invalid,
  not_found,
  problem,
} from "./problem";
import { campaign_status } from "./reads";
import { read_body, unknown_keys } from "./writes";

const TARGET_MSG = 'is {kind: "campaign", id}';

/** the campaign id the target names, or undefined with the issues pushed */
function read_target(value: unknown, issues: FieldError[]): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push({ path: "target", message: TARGET_MSG });
    return undefined;
  }
  const target = value as Record<string, unknown>;
  if (target.kind === "donation_page") {
    issues.push({
      path: "target.kind",
      message:
        "is not supported on Better Giving; only a campaign's photo can be uploaded",
    });
    return undefined;
  }
  if (target.kind !== "campaign") {
    issues.push({ path: "target.kind", message: 'is "campaign"' });
    return undefined;
  }
  const before = issues.length;
  for (const key of Object.keys(target)) {
    if (key !== "kind" && key !== "id") {
      issues.push({
        path: `target.${key}`,
        message: "is not a field of a target",
      });
    }
  }
  const { id } = target;
  if (typeof id !== "string" || id === "") {
    issues.push({ path: "target.id", message: "is a campaign id" });
  }
  return issues.length > before ? undefined : (id as string);
}

export async function create_photo_upload_link(
  db: DbOrTx,
  request: Request
): Promise<Response> {
  if (request.method !== "POST") return problem(404, "unknown_action");
  const live = await open_key(db, request);
  if (live instanceof Response) return live;
  const parsed = await read_body(request);
  if (!parsed.ok) return parsed.response;
  const issues: FieldError[] = [];
  unknown_keys(parsed.body, ["target", "slot"], issues);
  const campaign_id = read_target(parsed.body.target, issues);
  // a campaign has one photo, its banner
  if (Object.hasOwn(parsed.body, "slot") && parsed.body.slot !== "hero") {
    issues.push({ path: "slot", message: 'is "hero", or left out' });
  }
  if (issues.length > 0 || campaign_id === undefined) return invalid(issues);

  const now = new Date();
  const issued = await issue_photo_link(db, live.npo_id, campaign_id, now);
  if (!issued) {
    const row = await campaign_get(live.npo_id, campaign_id);
    if (
      row &&
      campaign_status(row.status, row.ends_at, now.getTime()) === "ended"
    ) {
      return campaign_ended();
    }
    return not_found(
      `Campaign ${campaign_id} does not exist for this nonprofit.`
    );
  }
  return json(
    {
      url: absolute(`/photo-upload/${issued.token}`),
      expires_at: issued.expires_at,
    },
    201
  );
}
