import { defineTool } from "eve/tools";
import { bash } from "eve/tools/bash";

import { refusalFor } from "../lib/guard";

// The stock sandbox shell, with merge, deploy, and push-to-main commands denied
// before they run. The denial reason goes back to the model.
export default defineTool({
  ...bash,
  approval: ({ toolInput }) => {
    const command =
      typeof toolInput?.command === "string" ? toolInput.command : "";
    const reason = refusalFor(command);
    return reason ? { type: "denied", reason } : "not-applicable";
  },
});
