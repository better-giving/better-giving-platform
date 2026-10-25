import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Write the code for a slice with no UI: server code, loaders and actions, data access, packages, scripts, and types. Turns the test-writer's failing tests green or applies a reviewer's fix list. Give it the brief, the done-check, the branch, and the failing tests or findings.",
  model: "zai/glm-5.3",
  reasoning: "high",
  compaction: { thresholdPercent: 0.7 },
});
