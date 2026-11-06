# Better Giving Monorepo

@../AGENTS.md

## Design system

- Components and tokens come from the Better Giving design registry (better-giving/design-system, served at https://design.better.giving/registry) through the `bg-design` CLI. Once this app adopts it, `bg-design.json` at the repo root lists every copied item and its folder; those copied files are this repo's design system. Take values from them and never invent a token, color or variant.
- The doop canvas `_gTDOwL8my` (https://doop-justin.fly.dev/c/_gTDOwL8my) and its guidelines doc `better-giving-design-system` are a picture of the registry. When they disagree, the registry wins.
- A part the registry lacks is a registry gap for the design-system PM, not something to draw or build ad hoc.

<!-- kru v0.159.0 · derived 2026-10-20 · /kru:setup to re-derive -->
## Team

Load **`kru:lead`** before building, reviewing, or dispatching a seat — it carries how the team works.

- **routes** → `kru:react-router-builder` — react-router 7.18.3 + `@react-router/fs-routes`: `apps/platform/src/routes/`, `apps/docs/src/routes/`, and the React Email templates in `packages/emails/` (a template is the sending seat's, not the UI builder's)
- **ui** → `kru:react-ui-builder` — `@ark-ui/react` 5.37.2 + tailwind 4.3.1: `packages/ui/`, `apps/platform/src/components/`
- **data** → `kru:postgres-architect` — drizzle-orm 0.45.2 + `@neondatabase/serverless` 1.1.0, drizzle-kit migrations, `@electric-sql/pglite` in tests: `apps/platform/.server/pg/`
- **auth** → `kru:better-auth-specialist` — better-auth 1.6.22: `apps/platform/src/.server/auth/`
- **card payments** → `kru:stripe-specialist` — stripe 22.6.0 + `@stripe/react-stripe-js` 6.3.0: `apps/platform/lib/stripe.ts`, `apps/platform/src/routes/api.stripe-webhook/`, `apps/platform/src/routes/api.donation-intents/stripe/`, `apps/platform/src/components/donation/checkouts/stripe/`
- **paypal/venmo** → `kru:paypal-specialist` — `@paypal/paypal-js` 10.0.3 over the built server SDK: `packages/paypal/`, `apps/platform/src/routes/api.paypal-webhook/`, `apps/platform/src/routes/api.donation-intents/paypal/`, `apps/platform/src/components/donation/methods/paypal.tsx`
- **DAF grants** → `kru:chariot-specialist` — the `<chariot-connect>` element pulled from `cdn.givechariot.com`, the built server SDK, and the webhook listener: `apps/platform/src/components/donation/checkouts/daf/`, `packages/chariot/`, `apps/platform/src/routes/api.donation-intents/chariot/`, `apps/platform/src/routes/api.chariot-webhook.ts`. Event-subscription CRUD stays the `chariot-webhooks` project seat's
- **crypto payments** → `kru:nowpayments-specialist` — NOWPayments REST via the hand-written client (no SDK installed) — invoice + invoice-payment creation, the IPN listener, min-amount/estimate: `apps/platform/lib/nowpayments/`, `apps/platform/src/routes/api.nowpayments-webhook/`. The crypto package's token list is app-curated data, not this seat's
- **zapier** → `kru:zapier-specialist` — the app-side endpoints only (no Platform CLI project in the repo) — auth test, REST-hook subscribe/unsubscribe + sample list, key minting: `apps/platform/src/routes/api.zapier.me.ts`, `apps/platform/src/routes/api.zapier.triggers.new-donation.ts`, `apps/platform/src/routes/api.zapier.generate.$id.ts`, and the hook fan-out in `api.q-handler.$event/handle-don-dist.ts`
- **cms** → `kru:sanity-builder` — sanity 6.1.0 + `@sanity/client` 7.22.1 in platform: `apps/blog/`, `packages/types/blog/`
- **platform** → `kru:vercel-platform-engineer` — `@vercel/react-router` 1.3.1 + `vercelPreset`, and CI: `apps/emails-preview/vercel.json`, `.github/workflows/`
- **toolchain** → `kru:toolchain-engineer` — turbo 2.11.2, biome 2.5.14, pnpm 12.4.2
- **skills** → `kru:drizzle`, `neon`, `tailwind`, `react-hook-form`, `valibot`, `vitest`, `msw`, `react-email`, `api-design` — drizzle-orm 0.45.2 on `@neondatabase/serverless` 1.1.0 (the driver seam answers separately from the ORM), tailwind 4.3.1 (v4, not `v3-lts`), react-hook-form 7.75.0 (+ remix-hook-form 7.1.1), valibot 1.5.0 (platform + ui peer), vitest 5.0.0 everywhere; browser locators are pinned to substring matching (`browser.locators.exact: false`) against the v5 default. msw 2.14.5 in platform's tests — the skill is written against 3. react-email 6.9.5 in emails + emails-preview; platform is on 6.1.1, outside the ≥6.9.0 pin emails-preview's own `CLAUDE.md` holds that pair to. `api-design` for the Zapier surface — minted `x-api-key`s and outbound donation webhooks.
- **not a seat** — `next` 16.3.3 in `apps/emails-preview` is `email build`'s toolchain, which generates a throwaway Next app into `.react-email/`. No App Router source exists in the repo; routing off that manifest to `nextjs-builder` is a mis-route. Nothing owns `packages/stocks`' ticker data, or the `ai` 6.0.176 / `@ai-sdk/valibot` evaluation calls in `_app.fundraisers.new/evaluate.ts` and `_app.signup._index/evaluate.ts`.
- **project seats** — `.claude/skills/`: `platform-tests`, `db-admin`, `chariot-webhooks`, `upstash-manager`, `wise`, `verify-platform` (headless-browser proof of platform's user flows, when the task names it). Prefer these over a plugin seat wherever they overlap; `platform-tests` outranks `test-writer` on platform's tests

A slice reaching a stack no seat above covers is a question for the user, naming the seat it would need — never a nearby seat pressed into the gap.
