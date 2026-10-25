import { installCodeTooling } from "eve/extensions/code/sandbox";
import { defineSandbox } from "eve/sandbox";
import { VercelSandbox } from "eve/sandbox/vercel";

import { requireEnv } from "./lib/env";
import { DEFAULT_BRANCH, PROTECTED_DIR, REPO_SLUG } from "./lib/repo";

export const environment = VercelSandbox.environment({
  prepare: async (sandbox) => {
    await installCodeTooling(sandbox);
    // pnpm for the repo's packageManager pin. Fall back to npm if the image has no corepack.
    const result = await sandbox.run({
      command:
        "command -v corepack >/dev/null && corepack enable || npm install -g pnpm",
    });
    if (result.exitCode !== 0) throw new Error(result.stderr);
  },
});

// The sandbox sees a placeholder. The firewall swaps in the real token, and
// only on requests for this one repository.
const PLACEHOLDER = "brokered-by-firewall";

// Escaped for the firewall's regex matcher. Anchored so a lookalike repo such as
// `better-giving-platform-fork` does not match.
const REPO_PATH = REPO_SLUG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function githubRules(token: string) {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  const bearer = {
    transform: [{ headers: { authorization: `Bearer ${token}` } }],
  };
  return {
    "github.com": [
      {
        match: { path: { regex: `^/${REPO_PATH}(\\.git)?(/|$)` } },
        transform: [{ headers: { authorization: `Basic ${basic}` } }],
      },
    ],
    "api.github.com": [
      { match: { path: { regex: `^/repos/${REPO_PATH}(/|$)` } }, ...bearer },
      { match: { path: { exact: "/graphql" } }, ...bearer },
    ],
  };
}

// Git hooks that back up the shell guard. pre-commit refuses staged changes
// under eve/ (this agent's own source). pre-push refuses pushing from the
// default branch, to the default branch, or any commit that touches eve/.
// Each hook then runs the repo's own hook (lefthook) if one is installed.
const HOOKS_DIR = "$HOME/.bgp-lead-hooks";
const chain = (name: string) =>
  `h="$(git rev-parse --git-dir)/hooks/${name}"; if [ -x "$h" ]; then exec "$h" "$@"; fi`;
const PRE_COMMIT = [
  "#!/bin/sh",
  `if git diff --cached --name-only | grep -q '^${PROTECTED_DIR}/'; then echo "refused: never commit changes under ${PROTECTED_DIR}/" >&2; exit 1; fi`,
  chain("pre-commit"),
].join("\n");
const PRE_PUSH = [
  "#!/bin/sh",
  `if [ "$(git rev-parse --abbrev-ref HEAD)" = "${DEFAULT_BRANCH}" ]; then echo "refused: never push while on ${DEFAULT_BRANCH}" >&2; exit 1; fi`,
  "z=0000000000000000000000000000000000000000",
  "while read -r lref lsha rref rsha; do",
  `  if [ "$rref" = "refs/heads/${DEFAULT_BRANCH}" ]; then echo "refused: never push to ${DEFAULT_BRANCH}" >&2; exit 1; fi`,
  `  [ "$lsha" = "$z" ] && continue`,
  `  if [ "$rsha" = "$z" ]; then range="origin/${DEFAULT_BRANCH}..$lsha"; else range="$rsha..$lsha"; fi`,
  `  if git diff --name-only "$range" -- | grep -q '^${PROTECTED_DIR}/'; then echo "refused: the push changes ${PROTECTED_DIR}/" >&2; exit 1; fi`,
  "done",
  chain("pre-push"),
].join("\n");

export default defineSandbox(async () => {
  const token = requireEnv("GITHUB_TOKEN");

  const sandbox = await environment.open({
    env: { GH_TOKEN: PLACEHOLDER, GH_PROMPT_DISABLED: "1" },
    resources: { vcpus: 4 },
  });

  // Egress allow-list: GitHub for git and gh, the npm registry for pnpm.
  // Everything else is blocked.
  await sandbox.setNetworkPolicy({
    allow: {
      ...githubRules(token),
      "codeload.github.com": [],
      "objects.githubusercontent.com": [],
      "release-assets.githubusercontent.com": [],
      "registry.npmjs.org": [],
    },
  });

  const setup = await sandbox.run({
    command: [
      `git config --global credential.helper '!f() { echo username=x-access-token; echo password=${PLACEHOLDER}; }; f'`,
      `git config --global user.name "bgp-lead[bot]"`,
      `git config --global user.email "bgp-lead@users.noreply.github.com"`,
      `mkdir -p ${HOOKS_DIR}`,
      `printf '%s\\n' '${PRE_COMMIT.replaceAll("'", "'\\''")}' > ${HOOKS_DIR}/pre-commit`,
      `printf '%s\\n' '${PRE_PUSH.replaceAll("'", "'\\''")}' > ${HOOKS_DIR}/pre-push`,
      `chmod +x ${HOOKS_DIR}/pre-commit ${HOOKS_DIR}/pre-push`,
      `git config --global core.hooksPath ${HOOKS_DIR}`,
    ].join(" && "),
  });
  if (setup.exitCode !== 0) throw new Error(setup.stderr);
  return sandbox;
});
