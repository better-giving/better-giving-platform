/**
 * Actions `GET /connector/v1/hello` reports as served. The connector filters
 * its tools from this list.
 */
export const CONNECTOR_ACTIONS = [
  "hello",
  "exchange",
  "disconnect",
  "list_campaigns",
  "get_campaign",
  "create_campaign",
  "update_campaign_settings",
  "update_campaign_blocks",
  "publish_campaign",
  "end_campaign",
  "get_donation_page",
  "get_block_catalog",
  "list_forms",
  "get_form",
  "create_form",
  "update_form",
  "get_results",
  "list_donations",
  "list_donors",
  "get_donor",
  "list_recurring_gifts",
  "create_photo_upload_link",
] as const;
