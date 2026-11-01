export const SERVER_KEYS = [
  "STAGE",
  "BASE_URL",
  "APP_SLUG",
  "APP_NPO_ID",
  "APP_API_ENCRYPTION_KEY",
  "APP_SESSION_SECRET",
  "APP_COOKIE_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_SUBS_PRODUCT_ID",
  "STRIPE_CONNECT_CLIENT_ID",
  "STRIPE_CONNECT_WEBHOOK_SECRET",
  "STRIPE_CONNECT_ROUTING",
  "PAYPAL_API_URL",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_PRODUCT_ID",
  "PAYPAL_WEBHOOK_ID",
  "PAYPAL_PLANS_WEEKLY",
  "PAYPAL_PLANS_MONTHLY",
  "PAYPAL_PLANS_ANNUAL",
  "WISE_API_TOKEN",
  "WISE_API_URL",
  "WISE_PROFILE_ID",
  "WISE_BALANCE_ID_USD",
  "ANVIL_API_KEY",
  "ANVIL_FSA_TEMPLATE_ID",
  "ANVIL_ORG_SLUG",
  "ANVIL_WEBHOOK_TOKEN",
  "CHARIOT_API_KEY",
  "CHARIOT_API_URL",
  "CHARIOT_SIGNING_KEY",
  "NOWPAYMENTS_API_KEY",
  "NOWPAYMENTS_API_URL",
  "NOWPAYMENTS_IPN_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "HUBSPOT_ACCESS_TOKEN",
  "HUBSPOT_FORMS_API",
  "HUBSPOT_PORTAL_ID",
  "HUBSPOT_SUBS_FORM_ID",
  "HUBSPOT_OWNER_ID",
  "HUBSPOT_DEAL_STAGE_ID",
  "SENTRY_DSN",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_PROJECT",
  "AI_GATEWAY_API_KEY",
  "BETTER_AUTH_API_KEY",
  "COINGECKO_API_KEY",
  "SLACK_BOT_TOKEN",
  "FINNHUB_API_KEY",
  "OPENEXCHANGE_APP_ID",
  "SMTP_PASSWORD",
  "QSTASH_TOKEN",
  "QSTASH_CURRENT_SIGNING_KEY",
  "QSTASH_NEXT_SIGNING_KEY",
  "BLOB_READ_WRITE_TOKEN",
  // vite base for content-hashed client assets: "/" locally, blob origin on
  // deployed stages (skew protection — see vite.config.ts).
  "ASSET_BASE_URL",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "CRYPTO_DEPOSIT_ADDR_ETH",
  "CRYPTO_DEPOSIT_ADDR_EVM",
  "CRYPTO_DEPOSIT_ADDR_HBAR",
  "CRYPTO_DEPOSIT_ADDR_REEF",
  "ALCHEMY_SIGNING_KEY_ETH_MAINNET",
  "ALCHEMY_SIGNING_KEY_BNB_MAINNET",
  "OWED_DEDUCTIONS",
  "CONNECTOR_RETURN_URL",
  "CONNECTOR_ORIGINS",
] as const;

export const CLIENT_KEYS = [
  "VITE_APP_NAME",
  "VITE_BASE_URL",
  "VITE_STAGE",
  "VITE_SENTRY_DSN",
  "VITE_STRIPE_PK",
  "VITE_PAYPAL_CLIENT_ID",
  "VITE_CHARIOT_CONNECT_ID",
] as const;

export type ServerKey = (typeof SERVER_KEYS)[number];
export type ClientKey = (typeof CLIENT_KEYS)[number];

// keys the app runs without. check_env (utils/check-env.ts) collapses absent,
// "" and whitespace into absence for these, so `!!env.X` is the whole test at
// every consumer. vercel's dashboard rejects a blank value, so absence is the
// only opt-out a deploy environment can spell.
// bounded to ServerKey on purpose: the widening in lib/types/env.d.ts is
// expressed over ServerKey, so a client key here would widen nothing while
// ImportMetaEnv went on declaring it `string`.
export const OPTIONAL_KEYS = [
  // gates sourcemap upload in vite.config.ts
  "SENTRY_AUTH_TOKEN",
  // optional alone — staging sets it with no token — but check_env refuses the
  // token without it, since that pair uploads nothing and still builds green
  "SENTRY_PROJECT",
  // per-chain alchemy webhook keys: a missing one fails only that chain's
  // webhook, at request time (.server/alchemy-webhook/handler.ts)
  "ALCHEMY_SIGNING_KEY_ETH_MAINNET",
  "ALCHEMY_SIGNING_KEY_BNB_MAINNET",
  // the owed-deductions switch, off unless "on"
  "OWED_DEDUCTIONS",
  // stripe connect: without the client id the connect start route answers
  // 503; without the connect secret only platform-signed events verify
  "STRIPE_CONNECT_CLIENT_ID",
  "STRIPE_CONNECT_WEBHOOK_SECRET",
  // the routing switch, off unless "on"
  "STRIPE_CONNECT_ROUTING",
  // connector allow screen: production ignores the return URL, and the origin
  // list may be empty
  "CONNECTOR_RETURN_URL",
  "CONNECTOR_ORIGINS",
  // ops alerts, mail and crm: off production each sender skips without its
  // credential; production requires them (PRODUCTION_KEYS)
  "SLACK_BOT_TOKEN",
  "SMTP_PASSWORD",
  "HUBSPOT_ACCESS_TOKEN",
] as const satisfies readonly ServerKey[];

// optional keys check_env still requires when STAGE is production
export const PRODUCTION_KEYS = [
  "SLACK_BOT_TOKEN",
  "SMTP_PASSWORD",
  "HUBSPOT_ACCESS_TOKEN",
] as const satisfies readonly OptionalKey[];

export type OptionalKey = (typeof OPTIONAL_KEYS)[number];

// OPTIONAL_KEYS is a literal tuple, so `.includes` rejects any argument wider
// than its own members. the widening cast lives here once instead of at each
// caller, which is also the only place it can carry the guard's return type.
export const is_optional = (k: string): k is OptionalKey =>
  (OPTIONAL_KEYS as readonly string[]).includes(k);

// sourcemaps are all-or-nothing across two config files that cannot import one
// another: vite.config.ts emits the maps and installs the upload plugin,
// react-router.config.ts's buildEnd uploads and deletes them. sentryOnBuildEnd
// reads its whole configuration off that plugin, so a buildEnd running without
// one destructures an absent config and fails the build, and a map nothing
// deletes is copied into .vercel/output/static and served. both gates call
// this, which is the only thing keeping them from drifting apart.
//
// the token is how a deploy environment opts out (staging does); the project
// names what the upload targets; the sha is the release identifier bugsink
// matches incoming events against. VERCEL_GIT_COMMIT_SHA is vercel's own, not
// a declared key — absent on any build vercel does not drive from git
// metadata, `vercel build --prebuilt` included.
//
// takes the env rather than reading process.env, because the two callers hold
// different objects: check_env's returned view on one side, the ambient
// environment on the other.
//
// trims rather than testing truthiness, so the answer holds for any env handed
// to it. check_env's normalization covers only the callers downstream of it,
// and the sha never passes through it at all — left untrimmed, a whitespace
// release name reaches bugsink as the identifier every event is matched
// against.
export const uploads_sourcemaps = (env: {
  SENTRY_AUTH_TOKEN?: string;
  SENTRY_PROJECT?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
}) =>
  !!env.SENTRY_AUTH_TOKEN?.trim() &&
  !!env.SENTRY_PROJECT?.trim() &&
  !!env.VERCEL_GIT_COMMIT_SHA?.trim();
