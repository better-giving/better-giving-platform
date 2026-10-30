import { Slack } from "@/slack";
import { slack_channels } from "@/slack-channels";
import { slack, stage } from "../env";

// off production a preview's missing or stale token must not fail the job
// posting: the post is skipped with a warning. production keeps the throw.
const bot = (channel_id: string) =>
  new Slack(channel_id, slack.bot_token, stage !== "production");

export const aws_monitor = bot(slack_channels.aws_monitor);
export const fiat_monitor = bot(slack_channels.fiat_monitor);
export const bg_sales = bot(slack_channels.bg_sales);
