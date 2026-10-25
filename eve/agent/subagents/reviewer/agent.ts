import { defineAgent } from "eve";
import { anthropic } from "eve/models/anthropic";

// Calls Anthropic directly with ANTHROPIC_API_KEY, not through AI Gateway.
// defaultTools: false drops write_file and the web tools; tools/ adds back
// read_file, glob, grep, and a shell limited to read commands.
export default defineAgent({
  description:
    "Review the branch's diff against the brief and done-check before a PR opens. Read-only. Give it the brief, the done-check, the branch, and the test evidence. Returns PASS or FIX with findings.",
  model: anthropic("claude-opus-5-5"),
  defaultTools: false,
  compaction: { thresholdPercent: 0.7 },
});
