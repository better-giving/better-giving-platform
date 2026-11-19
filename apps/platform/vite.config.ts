/// <reference types="vitest/config" />
import { reactRouter } from "@react-router/dev/vite";
import { sentryReactRouter } from "@sentry/react-router";
import tailwind from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vite";
import { uploads_sourcemaps } from "./lib/env";
import { devtools_json } from "./plugins/devtools-json";
import { inline_binary } from "./plugins/inline-binary";
import { BUGSINK_URL } from "./utils/bugsink";
import { check_env } from "./utils/check-env";

export default defineConfig((config) => {
  // vitest sets VITEST in the process before this config is loaded.
  const is_test = !!process.env.VITEST;
  // `react-router typegen` loads this config too, and its ConfigEnv is
  // byte-identical to `react-router build`'s (command "build", mode
  // "production") — argv is the only thing that tells them apart. it can't be
  // spoofed by a deploy env the way an opt-out flag could.
  const is_typegen = process.argv.includes("typegen");
  // neither run needs real credentials, so the guard stands down for both.
  // typegen is the one that would otherwise break a clean checkout: it loads
  // this config at mode "production", and .env.production is gitignored, so ci
  // has no values for a run that only reads the route graph. vitest does find
  // values (.env.test is committed filler) — standing down just keeps the suite
  // from depending on the guard. dev and build still hard-fail on a missing
  // key, which is the guard's whole point.
  const env = check_env(config.mode, !is_test && !is_typegen);
  // vite base for content-hashed client assets: "/" locally, the durable
  // asset origin (r2 or blob) on deployed stages (skew protection). MUST end
  // in "/" — vite concatenates `base + filename` for ssr-manifest module urls.
  // the fallback covers the runs that stood the guard down — neither typegen
  // nor vitest resolves an asset url, so neither needs a real base.
  const asset_base = env.ASSET_BASE_URL ?? "/";
  const rr7 = !is_test && reactRouter();
  // the predicate is shared with react-router.config.ts's buildEnd gate, which
  // is what uploads and deletes what this emits (lib/env.ts states the pair).
  // the extra `!is_test` term is not a divergence from that gate: vitest never
  // builds, so buildEnd never runs there at all.
  const sentry_upload = !is_test && uploads_sourcemaps(env);
  const sentry =
    sentry_upload &&
    sentryReactRouter(
      {
        sentryUrl: BUGSINK_URL,
        // bugsink has no organizations; its docs prescribe this literal slug.
        org: "bugsinkhasnoorgs",
        project: env.SENTRY_PROJECT,
        authToken: env.SENTRY_AUTH_TOKEN,
        // bugsink has no release endpoints at all — it infers releases from the
        // identifier on incoming events. `deploy` in particular must stay set:
        // left unset, the plugin turns it on by itself whenever VERCEL and
        // VERCEL_TARGET_ENV are present, and that call is fatal to the build.
        // `inject` stays on (its default) to put the identifier in the bundle.
        release: {
          name: env.VERCEL_GIT_COMMIT_SHA,
          create: false,
          finalize: false,
          deploy: false,
        },
        // pinned rather than left to the sdk: 10.53.1 deletes
        // `<buildDirectory>/**/*.map` when this is unset, while its published
        // type says `@default []` and its source-map plugin's docstring says an
        // explicitly-set `sourcemap` opts out of deletion. a `todo(v11)` sits
        // over that path, and a map that survives the build is copied into
        // .vercel/output/static and served.
        sourcemaps: { filesToDeleteAfterUpload: ["build/**/*.map"] },
      },
      config
    );
  const plugins = [devtools_json(), inline_binary(), rr7, tailwind(), sentry];
  return {
    base: asset_base,
    // emission rides the same flag — an emitted map is deleted by the upload
    // (lib/env.ts states the pair) and by nothing else.
    build: {
      outDir: "build",
      target: "es2022",
      sourcemap: sentry_upload && "hidden",
    },
    // `emails` exports raw .tsx (no build step); bundle it into the ssr build so
    // node never tries to import untranspiled tsx at runtime (api/auth email paths).
    ssr: { noExternal: ["emails"] },
    server: { port: 4200, strictPort: true, allowedHosts: [".ngrok-free.app"] },
    resolve: { tsconfigPaths: true },
    plugins,
    test: {
      // two projects, split by extension, not by directory: `.test.tsx` goes
      // to `browser` (renders through vitest-browser-react), `.test.ts` goes to
      // `node` (pglite-in-wasm db tests, route actions, lib/.server logic —
      // nothing that touches the DOM). the `*.node.test.ts` suffix selects a
      // project only under `jobs/`, whose include names it; under `src/` the
      // `.ts` extension already picks `node`, so the suffix there is a leftover
      // of the earlier split.
      projects: [
        {
          // inherit this file's vite config (plugins, resolve, base).
          extends: true,
          // server modules read `process.env.X` at module scope because they
          // also run on node, and vitest defines each `test.env` key only as
          // `import.meta.env.X`. defining the other spelling makes the value a
          // literal, so nothing depends on when a `process` object appears
          // relative to an esm-hoisted import graph.
          // NODE_ENV is vite's own define. `env` carries the whole shell
          // environment, and esbuild rejects a define key it can't parse as an
          // identifier chain (`npm_config_@scope:registry` and the like).
          // scoped to this project — never inlined into the app build.
          define: {
            // catch-all under the per-key entries. which keys the set below
            // covers depends on the ambient environment, so it differs between
            // a laptop and ci; an unmatched `process.env.X` would survive to
            // runtime and throw `ReferenceError: process is not defined` in
            // chromium, naming `process` rather than the key. vite sets this
            // same define itself, but not here — vitest turns on
            // `keepProcessEnv`, which drops vite's whole `process.env` group.
            // the longest matching key wins regardless of insertion order, so
            // the per-key entries still take precedence over this one.
            "process.env": "{}",
            ...Object.fromEntries(
              Object.entries(env)
                .filter(
                  ([k]) => k !== "NODE_ENV" && /^[A-Za-z_$][\w$]*$/.test(k)
                )
                .map(([k, v]) => [`process.env.${k}`, JSON.stringify(v)])
            ),
          },
          test: {
            name: "browser",
            setupFiles: [
              "./src/setup-tests-browser.ts",
              "./src/__tests__/mocks/payment.tsx",
            ],
            browser: {
              enabled: true,
              provider: playwright(),
              headless: true,
              screenshotFailures: false,
              instances: [{ browser: "chromium" }],
              // v5 default is exact string matching; the suite was written against
              // v4 substring matching (~1.4k string locators) and keeps it.
              locators: { exact: false },
            },
            // vitest's browser api server defaults to a fixed port (63315) with
            // strictPort effectively on, so two browser-mode vitest processes
            // (this one + packages/ui, running concurrently under turbo) crash
            // one of them with "Port 63315 is already in use" instead of falling
            // back — reported upstream as a silent "no tests" run, not a visible
            // crash. explicit strictPort:false restores vite's normal
            // try-next-port behavior. every browser-mode package needs this.
            api: { strictPort: false },
            env,
            globals: true,
            include: ["**/*.test.tsx"],
            exclude: ["**/node_modules/**", ".claude/**", "jobs/**"],
            testTimeout: 15_000,
            fileParallelism: false,
          },
        },
        {
          extends: true,
          test: {
            name: "node",
            environment: "node",
            // `process.chdir()` throws ERR_WORKER_UNSUPPORTED_OPERATION off the
            // main thread, and check-env.node.test.ts needs it to prove
            // resolution ignores the launch directory. forks is vitest's
            // current default; pinning it keeps that test off a default.
            pool: "forks",
            // node has no DOM; this file polyfills the one browser global
            // (`PageTransitionEvent`) a non-DOM test still constructs directly.
            setupFiles: ["./src/setup-tests-node.ts"],
            // jobs/ is server-side and excluded from the browser project, so
            // this is the only project that can carry a test for it.
            include: [
              "src/**/*.test.ts",
              "lib/**/*.test.ts",
              ".server/**/*.test.ts",
              "jobs/**/*.node.test.ts",
            ],
            // same env as browser, so `import.meta.env.X` resolves here too —
            // this project has no vite `define` block of its own.
            env,
            globals: true,
            // pglite boot exceeds the 5s default.
            testTimeout: 15_000,
          },
        },
      ],
      // spies-only: leaves module-scope `vi.fn().mockResolvedValue(...)`
      // implementations intact across tests (mockReset would null them out).
      restoreMocks: true,
      coverage: {
        provider: "v8",
        reporter: ["text"],
        // .tsx only — testing-library tests target rendered UI, not pure logic
        include: ["src/**/*.tsx", "lib/**/*.tsx"],
        exclude: [
          // test infra
          "src/**/*.test.{ts,tsx}",
          "src/__tests__/**",
          "src/setup-tests-browser.ts",

          // landing pages
          "src/routes/_landing/**",
          "src/routes/_landing.*/**",

          // marketing / informational
          // about-us is excluded file-by-file: donate.tsx carries a live
          // donation mount and route.tsx a loader (base_url from the request
          // origin) — both are covered; the rest is static copy
          "src/routes/_app.about-us/manifesto.tsx",
          "src/routes/_app.about-us/values.tsx",
          "src/routes/_app.about-us/volunteer.tsx",
          "src/routes/_app.about-us/underdog-letter.tsx",
          "src/routes/_app.nonprofit/**",
          "src/routes/_app.donor/**",
          "src/routes/_app.blog/**",
          "src/routes/_app.blog_.$slug/**",
          "src/routes/_app.donation-calculator/**",
          "src/routes/_app.resources/**",
          "src/routes/_app.wp-plugin/**",
          "src/routes/_app.zapier-integration/**",
          "src/routes/referral-program/**",
          "src/routes/see-what-youre-losing/**",
          "src/routes/simplify-fundraising-maximize-impact/**",
          "src/routes/simplify-fundraising-maximize-impacts/**",
          "src/routes/the-smart-move-to-make-for-accepting-crypto-donations/**",
          "src/routes/unlock-us-donations/**",
          "src/routes/nonprofits.$slug/**",

          // legal / policy
          "src/routes/_app.privacy-policy/**",
          "src/routes/_app.security-policy/**",
          "src/routes/_app.terms-of-use/**",
          "src/routes/_app.terms-of-use-npo/**",
          "src/routes/_app.terms-of-use-npo-2024/**",
          "src/routes/_app.terms-of-use-referrals/**",
          "src/routes/_app.terms-of-use-sms/**",

          // static display components (no logic)
          // footer is excluded file-by-file: footer.tsx branches on variant and
          // is covered; the rest is markup
          "src/components/footer/index.ts",
          "src/components/footer/newsletter-form.tsx",
          "src/components/footer/socials.tsx",
          "src/components/header/**",
          "src/components/video/**",
          "src/components/referrals/**",

          // scripts — one-off migrations/utilities
          "src/scripts/**",

          // types & constants — no logic
          "src/types/**",
          "src/constants/**",
          "lib/types/**",
          "lib/constants/**",

          // content & assets
          "src/content/**",
          "src/assets/**",

          // root entry/config files
          "src/root.tsx",
          "src/root-layout.tsx",
          "src/root-loader.ts",
          "src/root-action.ts",
          "src/routes.ts",

          // layout wrappers
          "src/layout/**",
        ],
      },
    },
  };
});
