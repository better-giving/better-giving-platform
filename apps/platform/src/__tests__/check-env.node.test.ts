import { resolve } from "node:path";
import { chdir, cwd } from "node:process";
import { describe, expect, test, vi } from "vitest";
import {
  CLIENT_KEYS,
  is_optional,
  OPTIONAL_KEYS,
  SERVER_KEYS,
  uploads_sourcemaps,
} from "../../lib/env";
import { check_env, invalid_stages, missing_keys } from "../../utils/check-env";

// node project, not browser: check_env reads `.env*` off disk, and this drives
// `chdir` (main-thread only — see the node project's `pool` in vite.config.ts).
//
// the `.env*` files live only in apps/platform, with nothing at the monorepo
// root to fall back on, so a launch-directory resolution finds none of them.
const repo_root = resolve(import.meta.dirname, "../../../..");

// ProcessEnv declares every server key but the optional ones as `string`
// (lib/types/env.d.ts), so a key is not optional to `delete` without widening
// first.
const env = process.env as Partial<NodeJS.ProcessEnv>;

// `.env.test` carries a line for every declared key and the files beat the
// shell for those, so an export can never reach the merge for one — which puts
// the blank-value and sentry-pair paths out of reach of a test. this stands in
// for the `.env.test.local` layer vite loads last, the one seam that can hand
// check_env another value for an already-declared key, and writes no file a
// crashed run would leave behind overriding the whole suite.
const local_layer = vi.hoisted(() => ({
  value: null as Record<string, string> | null,
}));

vi.mock("vite", async (original) => {
  const vite = await original<typeof import("vite")>();
  return {
    ...vite,
    loadEnv: (...args: Parameters<typeof vite.loadEnv>) => ({
      ...vite.loadEnv(...args),
      ...local_layer.value,
    }),
  };
});

// check_env merges everything it loaded into process.env, so a case that put
// back only the key it named would still leave the whole of `.env.test` behind
// for the files after it. the object goes back entire, and the layer with it.
function snapshot_env() {
  const prev = { ...process.env };
  return () => {
    local_layer.value = null;
    for (const k of Object.keys(process.env)) if (!(k in prev)) delete env[k];
    Object.assign(process.env, prev);
  };
}

describe("check_env", () => {
  test("resolves .env.test from the platform package, not the launch directory", () => {
    const restore = snapshot_env();
    const prev_cwd = cwd();
    // loadEnv's last pass copies process.env over the parsed files, so an
    // exported value satisfies the assertion without a file ever being read.
    delete env.APP_SESSION_SECRET;
    try {
      chdir(repo_root);
      const loaded = check_env("test", false);

      expect(loaded.APP_SESSION_SECRET).toEqual(expect.any(String));
      expect(loaded.APP_SESSION_SECRET).not.toBe("");
      // consumers read `process.env` at module scope, not this return value
      expect(env.APP_SESSION_SECRET).toBe(loaded.APP_SESSION_SECRET);
    } finally {
      chdir(prev_cwd);
      restore();
    }
  });

  test("a value from .env.test beats the same key exported in the shell", () => {
    const restore = snapshot_env();
    // loadEnv applies process.env last, so unless check_env puts the `.env*`
    // files back on top, this exported value is what the whole suite runs on.
    env.APP_SESSION_SECRET = "exported-never-read-from-a-file";
    try {
      const loaded = check_env("test", false);

      expect(loaded.APP_SESSION_SECRET).not.toBe(
        "exported-never-read-from-a-file"
      );
      expect(loaded.APP_SESSION_SECRET).toEqual(expect.any(String));
      expect(env.APP_SESSION_SECRET).toBe(loaded.APP_SESSION_SECRET);
    } finally {
      restore();
    }
  });

  // the files win for the declared keys only, and by unsetting them across the
  // load — everything else in the environment has to come back untouched,
  // which is also what lets a deploy with no `.env*` files resolve at all.
  test("keeps ambient values the files never declare", () => {
    const restore = snapshot_env();
    const ambient_key = "CHECK_ENV_AMBIENT_ONLY" as const;
    process.env[ambient_key] = "from-the-shell";
    try {
      const loaded = check_env("test", false) as unknown as Record<
        string,
        string
      >;

      expect(loaded[ambient_key]).toBe("from-the-shell");
      expect(process.env[ambient_key]).toBe("from-the-shell");
    } finally {
      restore();
    }
  });

  // the throw is what failed a staging deploy, and no test in this file had
  // ever run the validating path. `.env.test` is committed with a value for
  // every declared key, so this needs no secret.
  test("validation passes against the committed .env.test", () => {
    const restore = snapshot_env();
    try {
      expect(() => check_env("test", true)).not.toThrow();
    } finally {
      restore();
    }
  });

  // absent, "" and "   " have to be one state on BOTH objects. the returned
  // view is what vite.config.ts gates on; react-router.config.ts's buildEnd
  // reads process.env instead, so a view-only delete leaves whitespace truthy
  // at the gate that decides whether a .map is uploaded, deleted — or served.
  test.each([
    ["empty", ""],
    ["whitespace-only", "   "],
  ])(
    "a %s optional value is deleted from the view and process.env",
    (_s, v) => {
      const restore = snapshot_env();
      // every key the loop below asserts on, since `.env.test` sets some
      local_layer.value = Object.fromEntries(OPTIONAL_KEYS.map((k) => [k, v]));
      // seeded so the assertion proves the ambient delete rather than a merge
      // that simply never wrote the key.
      env.SENTRY_AUTH_TOKEN = "stale-token";
      env.SENTRY_PROJECT = "stale-project";
      // the third term of the buildEnd gate, so the two optional keys are the
      // only thing deciding it below.
      env.VERCEL_GIT_COMMIT_SHA = "c0ffee";
      try {
        const loaded = check_env("test", false);

        for (const k of OPTIONAL_KEYS) {
          expect(loaded).not.toHaveProperty(k);
          expect(process.env[k]).toBeUndefined();
        }
        expect(uploads_sourcemaps(process.env)).toBe(false);
      } finally {
        restore();
      }
    }
  );

  test("a set optional pair reaches process.env, where buildEnd reads it", () => {
    const restore = snapshot_env();
    local_layer.value = {
      SENTRY_AUTH_TOKEN: "sntrys_real_token",
      SENTRY_PROJECT: "better-giving",
    };
    env.VERCEL_GIT_COMMIT_SHA = "c0ffee";
    try {
      const loaded = check_env("test", true);

      expect(loaded.SENTRY_AUTH_TOKEN).toBe("sntrys_real_token");
      expect(process.env.SENTRY_AUTH_TOKEN).toBe("sntrys_real_token");
      expect(uploads_sourcemaps(process.env)).toBe(true);
    } finally {
      restore();
    }
  });

  // one-directional, and the direction is the point: a token with no project
  // uploads nothing and still builds green, which is the state the sdk only
  // warns about.
  test("throws when SENTRY_AUTH_TOKEN is set without SENTRY_PROJECT", () => {
    const restore = snapshot_env();
    local_layer.value = {
      SENTRY_AUTH_TOKEN: "sntrys_real_token",
      SENTRY_PROJECT: "   ",
    };
    try {
      expect(() => check_env("test", true)).toThrow(
        /SENTRY_AUTH_TOKEN is set without SENTRY_PROJECT/
      );
    } finally {
      restore();
    }
  });

  // the alchemy keys are in no `.env*` committed for tests, so a bare check_env
  // sees them genuinely unset: a deploy without them has to boot, and the webhook
  // route answers for the missing key itself.
  test.each([
    "ALCHEMY_SIGNING_KEY_ETH_MAINNET",
    "ALCHEMY_SIGNING_KEY_BNB_MAINNET",
  ])("validation passes with %s unset", (key) => {
    const restore = snapshot_env();
    delete env[key];
    try {
      expect(() => check_env("test", true)).not.toThrow();
      expect(check_env("test", true)).not.toHaveProperty(key);
    } finally {
      restore();
    }
  });

  // the other direction is staging's live shape — upload off, slug still set —
  // and has to keep deploying.
  test("accepts SENTRY_PROJECT with no token", () => {
    const restore = snapshot_env();
    local_layer.value = {
      SENTRY_AUTH_TOKEN: "   ",
      SENTRY_PROJECT: "better-giving",
    };
    try {
      expect(() => check_env("test", true)).not.toThrow();
    } finally {
      restore();
    }
  });

  // the stood-down path skips every assertion, not only the missing-key one.
  test("the non-validating path does not assert the sentry pair", () => {
    const restore = snapshot_env();
    local_layer.value = {
      SENTRY_AUTH_TOKEN: "sntrys_real_token",
      SENTRY_PROJECT: "",
    };
    try {
      expect(() => check_env("test", false)).not.toThrow();
    } finally {
      restore();
    }
  });
});

describe("is_optional", () => {
  test.each([...OPTIONAL_KEYS])("%s is optional", (k) => {
    expect(is_optional(k)).toBe(true);
  });

  // the guard widens its argument to `string`, so anything can be asked — a
  // required key, a client key, a name in no registry at all.
  test.each(["SENTRY_DSN", "STAGE", "VITE_SENTRY_DSN", "NOT_A_KEY"])(
    "%s is not",
    (k) => {
      expect(is_optional(k)).toBe(false);
    }
  );
});

describe("uploads_sourcemaps", () => {
  const terms = [
    "SENTRY_AUTH_TOKEN",
    "SENTRY_PROJECT",
    "VERCEL_GIT_COMMIT_SHA",
  ] as const;
  const all_set = () =>
    Object.fromEntries(terms.map((t) => [t, "x"])) as Record<
      (typeof terms)[number],
      string | undefined
    >;

  test("true when all three terms carry a value", () => {
    expect(uploads_sourcemaps(all_set())).toBe(true);
  });

  // every combination rather than three one-term cases: two config files that
  // cannot import one another gate on this, and a pair standing in for the
  // triple reads true where one of them then destructures a plugin config that
  // was never installed.
  test.each(
    [1, 2, 3, 4, 5, 6, 7].flatMap((mask) => {
      const missing = terms.filter((_, i) => mask & (1 << i));
      return (
        [
          ["absent", undefined],
          ["empty", ""],
        ] as const
      ).map(([spelling, value]) => ({
        label: missing.join(" + "),
        missing,
        spelling,
        value,
      }));
    })
  )("false without $label ($spelling)", ({ missing, value }) => {
    const vars = all_set();
    for (const t of missing) {
      if (value === undefined) delete vars[t];
      else vars[t] = value;
    }

    expect(uploads_sourcemaps(vars)).toBe(false);
  });

  // every term is trimmed, so the predicate answers for any env handed to it
  // rather than only one check_env already normalized — and the sha never
  // passes through that normalization at all, being vercel's and not declared.
  test.each([
    "SENTRY_AUTH_TOKEN",
    "SENTRY_PROJECT",
    "VERCEL_GIT_COMMIT_SHA",
  ] as const)("a whitespace-only %s reads as missing", (key) => {
    expect(uploads_sourcemaps({ ...all_set(), [key]: "   " })).toBe(false);
  });
});

describe("invalid_stages", () => {
  test.each(["local", "staging", "production"])("%s is a stage", (stage) => {
    expect(invalid_stages({ STAGE: stage, VITE_STAGE: stage })).toEqual([]);
  });

  // both keys are reported, so one fixed value does not hide the other.
  test.each([
    ["an unknown value", { STAGE: "prod", VITE_STAGE: "staging" }, ["STAGE"]],
    ["an absent key", { STAGE: "local" }, ["VITE_STAGE"]],
    ["a blank value", { STAGE: "", VITE_STAGE: "" }, ["STAGE", "VITE_STAGE"]],
  ] as const)("names the key carrying %s", (_case, vars, expected) => {
    expect(invalid_stages(vars)).toEqual(expected);
  });
});

// the deploy platform decides how an unset key reaches the build: vercel's
// dashboard rejects a blank value, so an optional key can only be expressed
// there by leaving it out. a build that refused to start over one cost a
// staging deploy.
describe("missing_keys", () => {
  const full = () =>
    Object.fromEntries([...SERVER_KEYS, ...CLIENT_KEYS].map((k) => [k, "x"]));

  // derived, not spelled out: ~60 keys copied by hand drift, and the one thing
  // a derivation cannot catch — a key reclassified optional, which drops out of
  // this list and the expectation together — is what the literal pin below
  // ("the optional registry holds exactly these keys") is there for. the two
  // only work as a pair.
  const required = [...SERVER_KEYS, ...CLIENT_KEYS].filter(
    (k) => !is_optional(k)
  );

  const states = [
    ["absent", undefined],
    ["empty", ""],
    ["whitespace-only", "   "],
    ["set", "sntrys_real_token"],
  ] as const;

  // spelled out rather than read off OPTIONAL_KEYS: an expectation derived from
  // the registry moves with it and asserts nothing, so a key that must never be
  // optional could be added with the suite still green. widening is an edit
  // here, deliberately.
  test("the optional registry holds exactly these keys", () => {
    expect([...OPTIONAL_KEYS]).toEqual([
      "SENTRY_AUTH_TOKEN",
      "SENTRY_PROJECT",
      "ALCHEMY_SIGNING_KEY_ETH_MAINNET",
      "ALCHEMY_SIGNING_KEY_BNB_MAINNET",
      "OWED_DEDUCTIONS",
      "STRIPE_CONNECT_CLIENT_ID",
      "STRIPE_CONNECT_WEBHOOK_SECRET",
      "STRIPE_CONNECT_ROUTING",
      "CONNECTOR_RETURN_URL",
      "CONNECTOR_ORIGINS",
      "SLACK_BOT_TOKEN",
      "SMTP_PASSWORD",
      "HUBSPOT_ACCESS_TOKEN",
    ]);
  });

  // optional off production only: a preview or local start without these
  // boots, and the senders skip; production still refuses to build without them
  test.each(["SLACK_BOT_TOKEN", "SMTP_PASSWORD", "HUBSPOT_ACCESS_TOKEN"])(
    "%s is required on production only",
    (key) => {
      const vars = full();
      delete vars[key];
      vars.STAGE = "staging";
      expect(missing_keys(vars)).toEqual([]);
      vars.STAGE = "production";
      expect(missing_keys(vars)).toEqual([key]);
    }
  );

  // one case per key rather than a shared loop: a loop's failure names no key
  // and aborts before the later ones run.
  test.each(
    OPTIONAL_KEYS.flatMap((key) =>
      states.map(([state, value]) => ({ key, state, value }))
    )
  )("optional $key is satisfied $state", ({ key, value }) => {
    const vars = full();
    if (value === undefined) delete vars[key];
    else vars[key] = value;

    expect(missing_keys(vars)).toEqual([]);
  });

  // every required key in the same state at once, against the derived list: a
  // key silently treated as optional drops out of the result and the diff names
  // it. whitespace is what an operator types at a field that refuses to be
  // blank.
  test.each(states.filter(([state]) => state !== "set"))(
    "every other key is reported %s",
    (_state, value) => {
      const vars = full();
      for (const k of required) {
        if (value === undefined) delete vars[k];
        else vars[k] = value;
      }

      expect(missing_keys(vars)).toEqual(required);
    }
  );
});
