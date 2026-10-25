import { defineAgent } from "eve";

// DeepSeek V4.1 Flash on Token Pass through AI Gateway. AI_GATEWAY_API_KEY must be a Token Pass
// key: it bills Token Pass credit and refuses every other model with a 403.
export default defineAgent({
  description: "Lead engineer for better-giving/better-giving-platform.",
  model: "deepseek/deepseek-v4.1-flash",
  reasoning: "high",
  compaction: { thresholdPercent: 0.7 },
});
