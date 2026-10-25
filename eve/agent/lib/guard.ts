import { CHECKOUT, DEFAULT_BRANCH, PROTECTED_DIR } from "./repo";

// Commands the agent may never run. Its job ends at an open pull request:
// merging, deploying, and pushing to the default branch are never this agent's job.
const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bgh\s+pr\s+merge\b/, "This agent never merges. Leave the draft PR open."],
  [/\bgh\s+api\b[^\n]*\/merges?\b/, "Merging through the API is not allowed."],
  [
    /\bgh\s+api\b[^\n]*(-X|--method)\s*(PUT|PATCH|DELETE)\b/i,
    "Write calls through gh api are not allowed; use gh pr create or gh pr comment.",
  ],
  [
    /\bgh\s+(repo\s+(delete|edit|rename|archive)|release|secret|variable|workflow\s+run|ruleset)\b/,
    "Repository settings, releases, secrets, and workflow runs are out of scope.",
  ],
  [
    /\b(vercel|vc)\b[^\n]*\b(deploy|promote|rollback|alias|env|remove|rm)\b/,
    "Deploys and Vercel project changes need Justin's approval.",
  ],
  [
    /\bnpm\s+publish\b|\bpnpm\s+publish\b/,
    "Publishing packages is not allowed.",
  ],
  [
    /\bgit\s+push\b[^\n]*(--force\b|\s-f\b|--mirror\b|--delete\b|\s:\S)/,
    "Force, mirror, and delete pushes are not allowed. Push a new commit instead.",
  ],
  [
    new RegExp(
      String.raw`\bgit\s+push\b[^\n]*[\s:+](refs/heads/)?${DEFAULT_BRANCH}(\s|$)`
    ),
    `Never push to ${DEFAULT_BRANCH}. Push a feature branch and open a PR.`,
  ],
  [
    /\bgit\s+push\b(?![^\n]*\S+\s+\S+)/,
    "Name the remote and branch explicitly: git push origin <branch>.",
  ],
  // `git push -u origin HEAD` from main slips past the branch-name rule, so a
  // bare HEAD refspec is refused; the pre-push hook in sandbox.ts is the backstop.
  [
    /\bgit\s+push\b[^\n]*\sHEAD(\s|$)/,
    "Push the branch by name, not HEAD: git push -u origin bgp-lead/<slug>.",
  ],
  [
    /--no-verify\b|\bcore\.hooksPath\b|\.git\/hooks\b|\bgit\s+-c\s/,
    "Git hooks guard the protected paths and main. Do not skip or change them.",
  ],
  // Bulk staging can pick up changes under eve/; stage files by name instead.
  [
    /\bgit\s+(add\s+([^\n]*\s)?(-A|--all|-u|--update|\.|:\/)(\s|$)|commit\s+([^\n]*\s)?-[a-zA-Z]*a)/,
    "Stage files by name (git add <path>...), not with -A, -u, . or commit -a.",
  ],
  [
    new RegExp(
      String.raw`(^|[\s'"=:(])(\./|${CHECKOUT}/)?${PROTECTED_DIR}(/|\s|$|['"])`
    ),
    `${PROTECTED_DIR}/ holds this agent's own source. Never change, stage, or commit anything under it.`,
  ],
];

/** True when a sandbox path points inside the protected eve/ folder of the checkout. */
export function isProtectedPath(resolved: string): boolean {
  const root = `${CHECKOUT}/${PROTECTED_DIR}`;
  const normalized = resolved.replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized === root || normalized.startsWith(`${root}/`);
}

/** Returns why a shell command is refused, or null when it may run. */
export function refusalFor(command: string): string | null {
  for (const [pattern, reason] of FORBIDDEN) {
    if (pattern.test(command)) return reason;
  }
  return null;
}
