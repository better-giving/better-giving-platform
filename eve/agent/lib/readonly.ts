// The reviewer's shell may only read. Anything outside this allow-list, or any
// command that chains, pipes into, or redirects to another program, is refused.
const READ_COMMANDS =
  /^(git (diff|log|show|status|branch|rev-parse|ls-files|blame|merge-base)|ls|cat|head|tail|wc|rg|grep)(\s|$)/;
const SHELL_SYNTAX = /[;&|<>`$()]|\n/;
// Flags that make a read command write a file or run another program.
const WRITING_FLAGS = /(^|\s)(--output|--pre|--ext-diff|--textconv|-o)(=|\s|$)/;

/** Returns why a reviewer command is refused, or null when it only reads. */
export function readOnlyRefusal(command: string): string | null {
  const trimmed = command.trim();
  if (SHELL_SYNTAX.test(trimmed)) {
    return "The reviewer shell runs one read command at a time: no pipes, chaining, redirects, or substitution.";
  }
  if (WRITING_FLAGS.test(trimmed)) {
    return "That flag can write a file or run a program, which the read-only reviewer may not do.";
  }
  if (!READ_COMMANDS.test(trimmed)) {
    return "The reviewer is read-only. Allowed: git diff/log/show/status/branch/rev-parse/ls-files/blame/merge-base, ls, cat, head, tail, wc, rg, grep.";
  }
  return null;
}
