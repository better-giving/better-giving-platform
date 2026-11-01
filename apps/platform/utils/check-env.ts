import { resolve } from "node:path";
import { loadEnv } from "vite";
import {
  CLIENT_KEYS,
  type ClientKey,
  is_optional,
  OPTIONAL_KEYS,
  type OptionalKey,
  PRODUCTION_KEYS,
  SERVER_KEYS,
  type ServerKey,
} from "../lib/env";

const STAGES = ["staging", "production", "local"] as const;
type Stage = (typeof STAGES)[number];

// the `.env*` files live in this package and nowhere else in the monorepo, so
// resolution has to be anchored here rather than at the launch directory —
// `vitest --root apps/platform` started from the repo root would otherwise load
// nothing, and every `$/env` read would come back undefined with no warning
// (`validate` stands down under vitest).
const pkg_dir = resolve(import.meta.dirname, "..");

type RequiredKey = ServerKey | ClientKey;

// ProcessEnv declares every required key (lib/types/env.d.ts), so a key is not
// optional to `delete` without widening first.
const ambient = process.env as Partial<NodeJS.ProcessEnv>;

// loadEnv pulls all keys (no prefix filter) from .env, .env.[mode],
// .env.[mode].local, etc. — matches what vite/vitest see at runtime.
//
// an empty prefix matches every key, so loadEnv's own last pass copies the
// whole of process.env over the parsed files: an exported value would beat the
// committed one. for the keys this package declares that is backwards — the
// `.env*` files are the configuration, the shell is whatever the launching
// terminal happened to carry, and an exported APP_SESSION_SECRET silently
// replacing .env.test's filler runs a whole suite against a real secret.
//
// loadEnv gives no way to read the file layer back out on its own, so the
// declared keys are unset across the call and restored after. a declared key
// that no file supplies is simply absent from the result and falls back to the
// shell value, which is how a deploy — no `.env*` files at all, every value
// from the platform — resolves unchanged.
//
// the one thing that window costs: loadEnv runs dotenv-expand against a
// snapshot of process.env taken inside the call, so a `${DECLARED_KEY}`
// reference in a `.env*` file expands against the files only, never the shell.
// no file uses `${}` today; one that needs a shell value has to spell it out.
function load_env(mode: string) {
  const shell = { ...process.env };
  for (const k of [...SERVER_KEYS, ...CLIENT_KEYS]) delete ambient[k];
  try {
    const files = loadEnv(mode, pkg_dir, "");
    // a one-off `CHARIOT_API_KEY=<prod> pnpm dev` loses to the files,
    // so say which keys the files took over rather than leaving the export
    // looking applied. keys the shell alone supplies come back through
    // loadEnv's own copy of process.env, identical, and never land here.
    const shadowed = Object.keys(files).filter(
      (k) => shell[k] !== undefined && shell[k] !== files[k]
    );
    if (shadowed.length) {
      console.warn(
        `env: .env* overrode exported ${shadowed.join(", ")} (files win over the shell)`
      );
    }
    return { ...shell, ...files };
  } finally {
    Object.assign(process.env, shell);
  }
}

// an optional key's whole opt-out is a blank-ish value, so the three spellings
// — absent, "", "   " — collapse to absence here and `!!env.X` is the correct
// test at every consumer downstream. the ambient delete carries as much weight
// as the loaded one: an exported whitespace value would otherwise survive
// check_env's merge and reach react-router.config.ts's buildEnd gate, which
// reads process.env rather than this view.
function normalize_optional(env: Record<string, string | undefined>) {
  for (const k of OPTIONAL_KEYS) {
    const v = env[k];
    if (v === undefined || v.trim()) continue;
    delete env[k];
    delete ambient[k];
  }
}

// every key has to carry non-whitespace: a lone space is what an operator types
// at a field that refuses to be blank. the optional ones are exempt from
// presence only — normalize_optional has already turned their blank spellings
// into absence by the time this runs.
//
// the parameter stays wider than the registries on purpose: this is the test
// surface, and the suite hands it objects it built rather than a loaded env.
export function missing_keys(env: Record<string, string | undefined>) {
  const required = [...SERVER_KEYS, ...CLIENT_KEYS];
  const prod = env.STAGE === "production";
  return required.filter(
    (k) =>
      (!is_optional(k) ||
        (prod && (PRODUCTION_KEYS as readonly string[]).includes(k))) &&
      !env[k]?.trim()
  );
}

// the other half of validation, named so it is testable the same way.
export function invalid_stages(env: Record<string, string | undefined>) {
  return (["STAGE", "VITE_STAGE"] as const).filter(
    (k) => !(STAGES as readonly string[]).includes(env[k] ?? "")
  );
}

type Validated = Record<Exclude<RequiredKey, OptionalKey>, string> &
  Partial<Record<OptionalKey, string>> & {
    STAGE: Stage;
    VITE_STAGE: Stage;
    VERCEL_GIT_COMMIT_SHA?: string;
    VITEST?: string;
  };

// validates required env keys, merges loaded .env values into process.env (so
// runtime code via process.env still works), and returns a typed view for the
// vite config factory to read from instead of process.env.
//
// `validate` stands the throw down for commands that load the vite config
// without ever needing real values — the merge and the typed view still happen,
// only the assertions are skipped. defaults on so a new caller fails loud. the
// return type follows it: without the assertions nothing has established that a
// required key is there, so the view is Partial and a caller handles absence.
export function check_env(mode: string, validate?: true): Validated;
export function check_env(mode: string, validate: boolean): Partial<Validated>;
export function check_env(mode: string, validate = true) {
  const env = load_env(mode);
  normalize_optional(env);

  if (validate) {
    const missing = missing_keys(env);
    if (missing.length) {
      throw new Error(
        `missing env vars (${missing.length}):\n  - ${missing.join("\n  - ")}`
      );
    }

    const [bad_stage] = invalid_stages(env);
    if (bad_stage) {
      throw new Error(
        `${bad_stage}=${env[bad_stage]} must be one of ${STAGES.join(",")}`
      );
    }

    // one-directional: a project with no token is staging's live shape — upload
    // off, slug still set — and has to keep deploying. a token with no project
    // is the state the sdk only warns about: it uploads nothing and the build
    // still goes green, so it throws here instead.
    if (env.SENTRY_AUTH_TOKEN && !env.SENTRY_PROJECT) {
      throw new Error(
        "SENTRY_AUTH_TOKEN is set without SENTRY_PROJECT — sourcemap upload needs both"
      );
    }
  }

  // merged after the assertions so a build that is about to throw has not
  // already written its values into the ambient environment.
  Object.assign(process.env, env);

  // STAGE/VITE_STAGE narrowed to the validated union (checked above) so the
  // returned view satisfies test.env's Partial<ProcessEnv> in vite.config.ts.
  return env as unknown as Validated;
}
