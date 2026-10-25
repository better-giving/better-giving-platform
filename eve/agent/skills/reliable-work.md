---
description: Load when taking on, handing off, or running a non-trivial build. How to prove the work is done.
---

# Reliable work

Adapted from pstack (https://github.com/cursor/plugins/tree/main/pstack), by way of Kru's `kru-reliable-work`.

1. **Define done before starting.** State the goal, the check that decides done, and the proof you'll show (command output, a stored value, a before/after number). The finish line stays the one you stated.
2. **Prove it works.** Verify against the real artifact or the running app. An independent check stands beside the builder's report.
3. **Experiment before asking.** When the answer is observable by running something, run it. Ask the human for a preference, a product call, or a risk call.
4. **Hand off completely.** Every delegation carries the goal, the constraints, the done-check and the required proof, and tells the delegate to read the project's standing instructions first.
5. **Log decisions on long or unattended runs.** One change, one check, one log line: time, decision, reason, evidence, result. Revert what didn't help. When stuck, stop and write why.
6. **Pause safely.** Before stopping mid-work, finish or back out the current step, checkpoint it, and leave a resume note (a file or a memory) a fresh session can continue from.
7. **Fix root causes.** For a repeated mistake, make it impossible, then catch it in lint or CI, then pin it with a test. A written rule is the last resort.
8. **Own it.** Report the result and the decision needed.

Done when the proof named in step 1 is in hand, from the artifact or the running app, and an independent check agrees.
