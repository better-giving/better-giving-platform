import type { TAlchemyChainId } from "./alchemy-webhook/types";

export const stage = process.env.STAGE;

// the value is passed in rather than looked up by name: the browser test
// bundle gets these as per-key `process.env.X` defines (vite.config.ts), and a
// define only replaces that exact spelling. `process.env[name]` would match
// only the `process.env: {}` catch-all beside them, so every key would read
// undefined and every `required` call would throw.
const required = (name: string, value: string | undefined): string => {
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

// trailing slashes stripped: every consumer appends "/path"
export const base_url = required("BASE_URL", process.env.BASE_URL).replace(
  /\/+$/,
  ""
);

// the app's own crypto keys, checked where they are produced so a miss names
// itself. an absent signing secret is otherwise silent: `secrets: [undefined]`
// is a non-empty array, so react-router reads the cookie as signed and no
// warning fires — the miss lands later and elsewhere as `DataError: HMAC key
// data must not be empty` out of `crypto.subtle.importKey`.
// this runs on every server boot; `check_env` only guards build and dev.
export const app = {
  slug: process.env.APP_SLUG,
  npo_id: process.env.APP_NPO_ID,
  api_encryption_key: required(
    "APP_API_ENCRYPTION_KEY",
    process.env.APP_API_ENCRYPTION_KEY
  ),
  session_secret: required(
    "APP_SESSION_SECRET",
    process.env.APP_SESSION_SECRET
  ),
  cookie_secret: required("APP_COOKIE_SECRET", process.env.APP_COOKIE_SECRET),
  // optional shared credential for agent donate calls. when a request presents
  // it, the hourly cap is per token; otherwise it is per trusted client address.
  agent_donation_token: process.env.AGENT_DONATION_TOKEN,
  // optional. absent (or blank) leaves the agent IRS fallback off. never call
  // the Nonprofits API without it — a missing key is not an anonymous client.
  nonprofits_api_key: process.env.NONPROFITS_API_KEY,
} as const;

export const ai_gateway = {
  api_key: process.env.AI_GATEWAY_API_KEY,
} as const;

export const anvil = {
  api_key: process.env.ANVIL_API_KEY,
  fsa_template_id: process.env.ANVIL_FSA_TEMPLATE_ID,
  org_slug: process.env.ANVIL_ORG_SLUG,
  webhook_token: process.env.ANVIL_WEBHOOK_TOKEN,
} as const;

export const better_auth = {
  api_key: process.env.BETTER_AUTH_API_KEY,
} as const;

export const blob = {
  read_write_token: process.env.BLOB_READ_WRITE_TOKEN,
} as const;

// the private store holds uploaded documents; a store is private or public
// for its whole life, so it is a second store with its own token
export const blob_private = {
  read_write_token: process.env.BLOB_PRIVATE_READ_WRITE_TOKEN,
} as const;

// optional: a chain without its key fails only its own webhook, which 500s
export const alchemy_signing_key = {
  "eth-mainnet": process.env.ALCHEMY_SIGNING_KEY_ETH_MAINNET,
  "bnb-mainnet": process.env.ALCHEMY_SIGNING_KEY_BNB_MAINNET,
} as const satisfies Record<TAlchemyChainId, string | undefined>;

export const chariot = {
  api_key: process.env.CHARIOT_API_KEY,
  api_url: process.env.CHARIOT_API_URL,
  signing_key: process.env.CHARIOT_SIGNING_KEY,
} as const;

export const coingecko = {
  api_key: process.env.COINGECKO_API_KEY,
} as const;

export const crypto_deposit_addr = {
  eth: process.env.CRYPTO_DEPOSIT_ADDR_ETH,
  evm: process.env.CRYPTO_DEPOSIT_ADDR_EVM,
  hbar: process.env.CRYPTO_DEPOSIT_ADDR_HBAR,
  reef: process.env.CRYPTO_DEPOSIT_ADDR_REEF,
} as const;

export const database = {
  url: process.env.DATABASE_URL,
  url_unpooled: process.env.DATABASE_URL_UNPOOLED,
} as const;

export const slack = {
  bot_token: process.env.SLACK_BOT_TOKEN,
} as const;

export const finnhub = {
  api_key: process.env.FINNHUB_API_KEY,
} as const;

export const google = {
  client_id: process.env.GOOGLE_CLIENT_ID,
  client_secret: process.env.GOOGLE_CLIENT_SECRET,
} as const;

export const hubspot = {
  access_token: process.env.HUBSPOT_ACCESS_TOKEN,
  forms_api: process.env.HUBSPOT_FORMS_API,
  portal_id: process.env.HUBSPOT_PORTAL_ID,
  subs_form_id: process.env.HUBSPOT_SUBS_FORM_ID,
  owner_id: process.env.HUBSPOT_OWNER_ID,
  deal_stage_id: process.env.HUBSPOT_DEAL_STAGE_ID,
} as const;

const np_api_url = required(
  "NOWPAYMENTS_API_URL",
  process.env.NOWPAYMENTS_API_URL
);
// sandbox is a separate account on its own host; the host, not STAGE, decides
// whether payments are simulated
const np_is_sandbox = new URL(np_api_url).hostname.startsWith("api-sandbox");
if (stage === "production" && np_is_sandbox) {
  throw new Error("NOWPAYMENTS_API_URL is the sandbox host in production");
}

export const nowpayments = {
  api_key: process.env.NOWPAYMENTS_API_KEY,
  api_url: np_api_url,
  is_sandbox: np_is_sandbox,
  // trimmed: a pasted trailing newline fails every signature, silently
  ipn_secret: required(
    "NOWPAYMENTS_IPN_SECRET",
    process.env.NOWPAYMENTS_IPN_SECRET?.trim()
  ),
} as const;

// whether grants net what an npo owes. exactly "on": an optional key's usual `!!`
// would read "off" as on
export const owed_deductions = process.env.OWED_DEDUCTIONS === "on";

export const openexchange = {
  app_id: process.env.OPENEXCHANGE_APP_ID,
} as const;

export const paypal = {
  api_url: process.env.PAYPAL_API_URL,
  client_id: process.env.PAYPAL_CLIENT_ID,
  client_secret: process.env.PAYPAL_CLIENT_SECRET,
  product_id: process.env.PAYPAL_PRODUCT_ID,
  webhook_id: process.env.PAYPAL_WEBHOOK_ID,
  plans: {
    weekly: process.env.PAYPAL_PLANS_WEEKLY,
    monthly: process.env.PAYPAL_PLANS_MONTHLY,
    annual: process.env.PAYPAL_PLANS_ANNUAL,
  },
} as const;

export const qstash = {
  token: process.env.QSTASH_TOKEN,
  current_signing_key: process.env.QSTASH_CURRENT_SIGNING_KEY,
  next_signing_key: process.env.QSTASH_NEXT_SIGNING_KEY,
} as const;

export const sentry = {
  dsn: process.env.SENTRY_DSN,
} as const;

export const smtp = {
  password: process.env.SMTP_PASSWORD,
} as const;

export const stripe = {
  secret_key: process.env.STRIPE_SECRET_KEY,
  webhook_secret: process.env.STRIPE_WEBHOOK_SECRET,
  subs_product_id: process.env.STRIPE_SUBS_PRODUCT_ID,
  // optional: an environment without connect still boots
  connect_client_id: process.env.STRIPE_CONNECT_CLIENT_ID,
  connect_webhook_secret: process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
  // whether card donations route to a ready connected account. exactly "on",
  // as with owed_deductions
  connect_routing: process.env.STRIPE_CONNECT_ROUTING === "on",
} as const;

export const wise = {
  api_token: process.env.WISE_API_TOKEN,
  api_url: process.env.WISE_API_URL,
  profile_id: process.env.WISE_PROFILE_ID,
  balance_id_usd: process.env.WISE_BALANCE_ID_USD,
} as const;
