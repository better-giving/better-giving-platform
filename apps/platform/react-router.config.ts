import type { Config } from "@react-router/dev/config";
import { sentryOnBuildEnd } from "@sentry/react-router";
import { vercelPreset } from "@vercel/react-router/vite";
import { uploads_sourcemaps } from "./lib/env";
import { BUGSINK_URL } from "./utils/bugsink";
export default {
  ssr: true,
  appDirectory: "src",
  future: {
    v8_middleware: true,
    v8_passThroughRequests: true,
    v8_trailingSlashAwareDataRequests: true,
    // v8_viteEnvironmentApi stays off. vercelPreset splits the server into two
    // bundles, and with this flag react-router 7.18.5 (and 8.5.1) builds them
    // with Promise.all over shared plugins: the main bundle's manifest names an
    // index.css the client build never emits and that bundle never writes, and
    // the build fails moving it into build/client (ENOENT). building the two
    // one after the other passes.
    v8_splitRouteModules: true,
  },
  presets: [vercelPreset()],
  buildEnd: async (args) => {
    // the same predicate vite.config.ts gates map emission and the upload
    // plugin on: sentryOnBuildEnd reads its options off that plugin, so either
    // the two agree or this call destructures a config that was never set.
    if (uploads_sourcemaps(process.env)) {
      // sentryOnBuildEnd builds its own sentry-cli and forwards only authToken,
      // org and project — never the instance url — so without this every call
      // it makes resolves against sentry.io and 404s on an org that only
      // exists here.
      process.env.SENTRY_URL = BUGSINK_URL;
      await sentryOnBuildEnd(args);
    }
    // when assets are served from blob (vite base is a real origin, not "/";
    // see vite.config.ts), mirror the content-hashed client assets there so
    // cached html never 404s on a rotated-out deployment's assets. throws on
    // error so a deploy never ships html pointing at un-uploaded assets.
    const base = args.viteConfig.base;
    if (base !== "/") {
      const { upload_client_assets } = await import(
        "./utils/upload-client-assets"
      );
      await upload_client_assets(base);
    }
  },
} satisfies Config;
