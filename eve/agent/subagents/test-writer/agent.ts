import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Write the failing tests for a done-check before any code changes. Give it the brief, the done-check, and the branch. Returns the test files and the red run.",
  model: "zai/glm-5.3",
  reasoning: "high",
  compaction: { thresholdPercent: 0.7 },
});
