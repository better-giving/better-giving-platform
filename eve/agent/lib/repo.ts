/** The only repository this agent builds in or pushes to. */
export const REPO_OWNER = "better-giving";
export const REPO_NAME = "better-giving-platform";
export const REPO_SLUG = `${REPO_OWNER}/${REPO_NAME}`;
export const REPO_URL = `https://github.com/${REPO_SLUG}.git`;
export const DEFAULT_BRANCH = "main";
/** Where the agent clones the repo inside the sandbox. */
export const CHECKOUT = `/workspace/${REPO_NAME}`;
/** This agent's own source folder in the repo. The agent never changes it. */
export const PROTECTED_DIR = "eve";
