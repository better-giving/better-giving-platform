import { fund_is_open } from "@/campaign/is-open";

export const STATUS_WORD = {
  draft: "Draft",
  live: "Live",
  ended: "Ended",
  closed: "Closed",
} as const;

interface IFundRowState {
  active: boolean;
  published: boolean;
  /** unix seconds; the list query sends the year-9999 sentinel for no end date */
  expiration: number;
}

/** one status for a fund row on either tab: closed by its members, past its end date, unpublished, or live */
export function fund_row_status(row: IFundRowState, now = new Date()) {
  if (!row.active) return STATUS_WORD.closed;
  const expiration = new Date(row.expiration * 1000).toISOString();
  if (!fund_is_open({ active: true, expiration }, now))
    return STATUS_WORD.ended;
  if (!row.published) return STATUS_WORD.draft;
  return STATUS_WORD.live;
}

export const SLUG_HELP = "Letters, numbers, and - . _ ~";

export const SLUG_LOCK_NOTE =
  "This link is fixed because the campaign is published.";

export const SLUG_PUBLISH_LOCK = "The link can't change after you publish.";

export function publish_lock_body(link: string) {
  return `Donors will find this campaign at ${link}. The link can't change after you publish.`;
}

export const ORG_SLUG_PROMPT =
  "Set your profile link on Organization before creating a campaign.";

const SLUG_TAKEN = "That link is already used by another campaign.";

export function slug_taken_message() {
  return SLUG_TAKEN;
}
