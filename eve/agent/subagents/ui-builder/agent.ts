import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Write the code for a slice that touches UI: React components, rendered markup, styles, copy, or client-side interaction. Turns the test-writer's failing tests green or applies a reviewer's fix list. Give it the brief, the done-check, the branch, and the failing tests or findings.",
  model: "moonshotai/kimi-k3",
  reasoning: "high",
  compaction: { thresholdPercent: 0.7 },
});
