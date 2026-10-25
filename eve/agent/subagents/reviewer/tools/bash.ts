import { defineTool } from "eve/tools";
import { bash } from "eve/tools/bash";

import { readOnlyRefusal } from "../../../lib/readonly";

export default defineTool({
  ...bash,
  description:
    "Run one read-only command in the shared checkout, such as `git diff origin/main...HEAD`.",
  approval: ({ toolInput }) => {
    const command =
      typeof toolInput?.command === "string" ? toolInput.command : "";
    const reason = readOnlyRefusal(command);
    return reason ? { type: "denied", reason } : "not-applicable";
  },
});
