import { defineAgent } from "eve";
import { anthropic } from "eve/models/anthropic";

// Calls Anthropic directly with ANTHROPIC_API_KEY. No AI Gateway, so this spend
// lands on the Anthropic bill and never falls back to gateway credits.
export default defineAgent({
  description:
    "Take over a slice after two failed attempts to turn its tests green. Give it the brief, the done-check, the branch, the failing tests, and both attempts with their output.",
  model: anthropic("claude-opus-5-5"),
  compaction: { thresholdPercent: 0.7 },
});
