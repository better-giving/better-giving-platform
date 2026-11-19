import { AskHost, Toaster } from "@better-giving/ui";
import { MotionConfig } from "motion/react";
import type { PropsWithChildren } from "react";
import { preconnect } from "react-dom";
import { Links, Meta, Scripts, ScrollRestoration } from "react-router";
import { NavProgress } from "#/components/nav-progress";
import { asset_origin } from "@/asset-origin";
import { useConsent } from "./use-consent";

export function Layout({ children }: PropsWithChildren<{ classes?: string }>) {
  // resource hints — emitted in <head> during SSR
  // the blob origin serves images (no-cors); the asset origin (vite base, baked
  // at build) serves the module scripts and fonts (cors). a connection opened
  // without `crossorigin` is not reused by a cors request, so each mode gets
  // its own. the asset origin also serves the stylesheet and images as plain
  // requests, so it gets both. a "/" base is same-origin and needs no hint.
  preconnect("https://cnfc6hjkztdschkg.public.blob.vercel-storage.com");
  const assets = asset_origin(import.meta.env.BASE_URL);
  if (assets) {
    preconnect(assets);
    preconnect(assets, { crossOrigin: "anonymous" });
  }

  useConsent();

  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        {/* blocking, pre-paint: mirrors the dismissed banner from localStorage
            onto <html> so the css variant in announcement-banner.tsx empties
            the bar before first paint. must stay synchronous and inline —
            deferring it (or moving it to a mount effect) shifts the layout of
            every marketing page for anyone who already dismissed.

            sits above <Meta />/<Links /> on purpose: a classic inline script
            can't run until every stylesheet declared before it has loaded, and
            parsing blocks behind it — which would serialize work on every
            document in the app, dashboard and admin routes included.

            the key is duplicated from announcement-banner.tsx's `KEY` because
            it has to be a static string here; the drift test in
            announcement-banner.test.tsx reads this file and fails if they
            diverge. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static literal, no interpolation
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("banner:ncnp-endorsement")==="1")document.documentElement.dataset.bannerDismissed="ncnp-endorsement"}catch(e){}`,
          }}
        />
        <link rel="icon" href="/favicon.ico" />
        <Meta />
        <Links />
        <style />
      </head>
      <body className="">
        {/* motion's default is reducedMotion: "never" — it reads the os
            preference only when told to, and the css ladder guard in
            packages/ui/src/styles/theme.css cannot reach a js-driven
            animation. "user" defers to the os setting, dropping transform and
            layout animations while opacity still fades. */}
        <MotionConfig reducedMotion="user">
          <NavProgress />
          <Toaster>{children}</Toaster>
          {/* renders nothing until something is asked, and what it mounts
              portals to body — so its position here decides nothing but needs
              to stay inside the router. */}
          <AskHost />
        </MotionConfig>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
