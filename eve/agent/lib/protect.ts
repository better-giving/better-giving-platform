// The paths and commands every kru-eve subagent refuses, on top of kru-eve's
// built-in refusals. eve/ is the agent's own source and .github/ holds
// CODEOWNERS and CI. The commands mirror the lead's guard (./guard.ts) where
// kru-eve has no built-in rule.
export const KRU_PROTECT = {
  paths: ["eve/**", ".github/**"],
  commands: [
    // Bulk staging can pick up protected changes; stage files by name.
    /\bgit\s+add\s+([^\n]*\s)?(-A|--all|-u|--update|\.|:\/)(\s|$)/,
    /\bgit\s+commit\s+([^\n]*\s)?-[a-zA-Z]*a/,
    /\bgit\s+commit\s+([^\n]*\s)?--all\b/,
    // Pushing to main by any spelling, including refs/heads/main.
    /\bgit\s+push\b[^\n]*[\s:+](refs\/heads\/)?main(\s|$)/,
  ],
};
