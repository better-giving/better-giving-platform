import * as v from "valibot";
import type { CONNECTOR_ACTIONS } from "./actions";

type Action = (typeof CONNECTOR_ACTIONS)[number];

/** the query parameters each read accepts; any other is refused as invalid.
 * `/openapi.json` documents these sets. */
export const QUERY_PARAMS = {
  list_campaigns: ["status", "cursor", "limit"],
  get_campaign: [],
  get_donation_page: [],
  get_block_catalog: [],
  list_forms: ["cursor", "limit"],
  get_form: [],
  list_donations: ["campaign_id", "from", "to", "cursor", "limit"],
  list_donors: ["q", "cursor", "limit"],
  get_donor: ["cursor", "limit"],
  list_recurring_gifts: ["cursor", "limit"],
  get_results: ["campaign_id", "from", "to"],
} as const satisfies Partial<Record<Action, readonly string[]>>;

export type QueryParam =
  (typeof QUERY_PARAMS)[keyof typeof QUERY_PARAMS][number];

/** fields a form write sets */
export const FORM_WRITABLE = [
  "name",
  "status",
  "suggested_amounts",
  "frequencies",
  "donate_methods",
  "gifts_go_to",
] as const;

/** what get_form shows but a form write can't move: sent back as read, they pass */
export const FORM_ECHOES = [
  "id",
  "campaign_id",
  "updated_at",
  "minimum",
  "maximum",
  "allowed_origins",
] as const;

/** the JSON body keys each write accepts; any other is refused as invalid.
 * `/openapi.json` documents these sets. */
export const BODY_KEYS = {
  create_campaign: ["title"],
  update_campaign_settings: [
    "goal",
    "end_date",
    "time_zone",
    "sharing",
    "expected_version",
  ],
  update_campaign_blocks: ["blocks", "expected_version"],
  publish_campaign: ["gifts_go_to"],
  end_campaign: [],
  create_form: [...FORM_WRITABLE, ...FORM_ECHOES],
  update_form: [...FORM_WRITABLE, ...FORM_ECHOES, "confirm"],
  create_photo_upload_link: ["target", "slot"],
} as const satisfies Partial<Record<Action, readonly string[]>>;

/** a campaign `version` as `expected_version` sends it back */
export const EXPECTED_VERSION = /^\d{1,19}$/;

export type BodyKey = (typeof BODY_KEYS)[keyof typeof BODY_KEYS][number];

export const exchange_body = v.object({ code: v.string() });
