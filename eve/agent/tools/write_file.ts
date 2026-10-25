import { defineTool } from "eve/tools";
import { writeFile } from "eve/tools/write_file";

import { isProtectedPath } from "../lib/guard";
import { PROTECTED_DIR } from "../lib/repo";

type WriteFileOutput = Exclude<
  Awaited<ReturnType<typeof writeFile.execute>>,
  AsyncIterable<unknown>
>;

// The stock write_file, refusing anything under the checkout's eve/ folder,
// which holds this agent's own source.
export default defineTool({
  ...writeFile,
  async execute(input, ctx) {
    const sandbox = await ctx.getSandbox();
    if (isProtectedPath(sandbox.resolvePath(input.filePath))) {
      throw new Error(
        `${PROTECTED_DIR}/ holds this agent's own source. Never write under it.`
      );
    }
    // The stock executor returns a plain result, never a stream.
    return (await writeFile.execute(input, ctx)) as WriteFileOutput;
  },
});
