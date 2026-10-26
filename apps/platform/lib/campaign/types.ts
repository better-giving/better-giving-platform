export const CAMPAIGN_TYPES = [
  "year_end",
  "emergency",
  "building",
  "event",
  "tribute",
  "monthly",
  "program",
  "other",
] as const;

export type TCampaignType = (typeof CAMPAIGN_TYPES)[number];

export const CAMPAIGN_STATUSES = ["draft", "live", "ended"] as const;

export type TCampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
