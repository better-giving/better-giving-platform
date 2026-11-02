import type { JsonSchema } from "@valibot/to-json-schema";
import type { ObjectEntries, ObjectSchema } from "valibot";
import { API_ERROR_STATUS } from "@/helpers/api-error";
import { ein_ref, npo_ref, npos_search } from "@/npo/schema";
import { CONNECTOR_ACTIONS } from "../connector/actions";
import {
  BODY_KEYS,
  type BodyKey,
  EXPECTED_VERSION,
  exchange_body,
  QUERY_PARAMS,
  type QueryParam,
} from "../connector/inputs";
import { PROBLEM_CODES } from "../connector/problem";
import { wire_schema } from "./wire-schema";

type Method = "get" | "post" | "patch";
type Json = Record<string, unknown>;

/** one documented operation, and the route module (file under src/routes,
 * no extension) that serves it */
export interface IOperation {
  route: string;
  path: string;
  method: Method;
  op: Json & { operationId: string };
}

/** route modules under `api.*` and `connector.v1.*` left out of the document */
export const EXCLUDED: Record<string, string> = {
  "api.$": "catch-all",
  "api.alchemy-webhook.$chain_id": "webhook",
  "api.alchemy-webhook.$chain_id_.$signing_key": "webhook",
  "api.anvil-doc.$eid": "internal",
  "api.anvil-webhook": "webhook",
  "api.auth.$": "auth",
  "api.chariot-webhook": "webhook",
  "api.cron.commissions": "cron",
  "api.cron.connector-sweep": "cron",
  "api.cron.currencies": "cron",
  "api.cron.grants": "cron",
  "api.cron.grants-execute": "cron",
  "api.cron.nav-update": "cron",
  "api.cron.owed-notices": "cron",
  "api.cron.savings-snapshot": "cron",
  "api.crypto-intents.$id": "checkout",
  "api.donation-intents": "checkout",
  "api.donation-notifications": "internal",
  "api.file-upload": "internal",
  "api.me": "session",
  "api.nav-txs": "admin",
  "api.nowpayments-webhook": "webhook",
  "api.npo.$id.donors": "dashboard",
  "api.npo.$id.payouts": "dashboard",
  "api.npo.$id.programs": "dashboard",
  "api.npo.$id.sf-metrics": "dashboard",
  "api.npos.dividend-log-simul": "admin",
  "api.npos.interest-log-simul": "admin",
  "api.paypal-webhook": "webhook",
  "api.q-don-dist.$npo_id": "queue",
  "api.q-handler.$event": "queue",
  "api.session": "session",
  "api.stripe-connect.callback": "auth",
  "api.stripe-connect.start": "auth",
  "api.stripe-webhook": "webhook",
  "api.wise.$": "internal",
  "api.zapier.generate.$id": "zapier",
  "api.zapier.me": "zapier",
  "api.zapier.triggers.new-donation": "zapier",
  "connector.v1.$": "catch-all",
  "connector.v1._index": "catch-all",
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const STATUS_TEXT: Record<number, string> = {
  400: "The request is malformed.",
  401: "The API key is missing or no longer valid.",
  404: "Nothing matches this request.",
  409: "The request conflicts with the resource's current state.",
  422: "The request failed validation; `errors` names each field.",
  429: "Too many requests. Wait, then retry.",
  500: "Better Giving hit an error.",
};

const api_errors = (...statuses: number[]) =>
  Object.fromEntries(
    statuses.map((s) => [s, { $ref: `#/components/responses/Api${s}` }])
  );

const problems = (...statuses: number[]) =>
  Object.fromEntries(
    statuses.map((s) => [s, { $ref: `#/components/responses/Problem${s}` }])
  );

/** a keyed action's error responses: the key check (401, 429), input
 * validation (422) and connector_route's 500, plus the action's own
 * `refuses` */
const keyed_problems = (refuses: number[]) =>
  problems(
    ...[...new Set([401, 422, 429, 500, ...refuses])].sort((a, b) => a - b)
  );

const ok = (description: string, schema: Json = { type: "object" }) => ({
  description,
  content: { "application/json": { schema } },
});

const path_param = (name: string, schema: JsonSchema, description: string) => ({
  name,
  in: "path",
  required: true,
  description,
  schema,
});

const NPOS_SEARCH_DOCS: Record<keyof typeof npos_search.entries, string> = {
  query: "Free-text search over nonprofit names and descriptions.",
  page: "1-based page number.",
  endow_designation: "Comma-separated organization designations.",
  sdgs: "Comma-separated UN Sustainable Development Goal numbers (1-17).",
  kyc_only: "Comma-separated `true`/`false`: donor KYC required.",
  fund_opt_in: "Comma-separated `true`/`false`: opted into fundraisers.",
  published: "Comma-separated `true`/`false`: listed on the marketplace.",
  countries: "Comma-separated headquarters countries.",
  fields: "Comma-separated fields each item carries.",
};

/** one query parameter per entry of a valibot object, typed from its input side */
function query_params<E extends ObjectEntries>(
  schema: ObjectSchema<E, undefined>,
  docs: Record<keyof E, string>
) {
  const { properties = {}, required = [] } = wire_schema(schema) as {
    properties?: Record<string, JsonSchema>;
    required?: string[];
  };
  return Object.entries(properties).map(([name, s]) => ({
    name,
    in: "query",
    required: required.includes(name),
    description: docs[name as keyof E],
    schema: s,
  }));
}

const search_q = {
  name: "q",
  in: "query",
  required: false,
  description: "Fuzzy search. Without it, the first 10 are returned.",
  schema: { type: "string" },
};

const ESTIMATE = {
  type: "object",
  required: ["min", "usdpu"],
  properties: {
    min: { type: "number", description: "Minimum gift, in shares or tokens." },
    usdpu: { type: "number", description: "USD per unit." },
  },
};

const public_ops = (): IOperation[] => [
  {
    route: "api.npos._index",
    path: "/api/npos",
    method: "get",
    op: {
      operationId: "search_nonprofits",
      summary: "Search nonprofits",
      parameters: query_params(npos_search, NPOS_SEARCH_DOCS),
      responses: {
        200: ok("A page of nonprofits."),
        ...api_errors(400, 500),
      },
    },
  },
  {
    route: "api.npos.$id",
    path: "/api/npos/{id}",
    method: "get",
    op: {
      operationId: "get_nonprofit",
      summary: "Get a nonprofit by id or slug",
      parameters: [
        path_param(
          "id",
          wire_schema(npo_ref),
          "The nonprofit's numeric id, or its slug."
        ),
      ],
      responses: {
        200: ok("The nonprofit's public profile."),
        ...api_errors(400, 404, 500),
      },
    },
  },
  {
    route: "api.npos.ein.$id",
    path: "/api/npos/ein/{id}",
    method: "get",
    op: {
      operationId: "get_nonprofit_by_ein",
      summary: "Get a nonprofit by registration number (EIN)",
      parameters: [
        path_param(
          "id",
          wire_schema(ein_ref),
          "Registration number, letters and digits only, or a US EIN as NN-NNNNNNN."
        ),
      ],
      responses: {
        200: ok("The nonprofit with this registration number."),
        ...api_errors(400, 404, 500),
      },
    },
  },
  {
    route: "api.currencies",
    path: "/api/currencies",
    method: "get",
    op: {
      operationId: "list_currencies",
      summary: "List donation currencies with USD rates",
      responses: {
        200: ok("Supported currencies, with the caller's preferred one."),
        ...api_errors(500),
      },
    },
  },
  {
    route: "api.tickers._index",
    path: "/api/tickers",
    method: "get",
    op: {
      operationId: "search_tickers",
      summary: "Search stock tickers accepted as gifts",
      parameters: [search_q],
      responses: {
        200: ok("Up to 10 tickers.", {
          type: "array",
          items: { type: "object" },
        }),
        ...api_errors(500),
      },
    },
  },
  {
    route: "api.tickers.$symbol.estimate",
    path: "/api/tickers/{symbol}/estimate",
    method: "get",
    op: {
      operationId: "estimate_ticker",
      summary: "Get the price and minimum gift for a stock ticker",
      parameters: [path_param("symbol", { type: "string" }, "Ticker symbol.")],
      responses: {
        200: ok("The minimum gift in shares and the USD price.", ESTIMATE),
        ...api_errors(404, 500),
      },
    },
  },
  {
    route: "api.tokens._index",
    path: "/api/tokens",
    method: "get",
    op: {
      operationId: "search_tokens",
      summary: "Search crypto tokens accepted as gifts",
      parameters: [search_q],
      responses: {
        200: ok("Up to 10 tokens.", {
          type: "array",
          items: { type: "object" },
        }),
        ...api_errors(500),
      },
    },
  },
  {
    route: "api.tokens.$code.estimate",
    path: "/api/tokens/{code}/estimate",
    method: "get",
    op: {
      operationId: "estimate_token",
      summary: "Get the price and minimum gift for a crypto token",
      parameters: [path_param("code", { type: "string" }, "Token code.")],
      responses: {
        200: ok("The minimum gift in tokens and the USD price.", ESTIMATE),
        ...api_errors(404, 500),
      },
    },
  },
  {
    route: "api.top-countries",
    path: "/api/top-countries",
    method: "get",
    op: {
      operationId: "list_top_countries",
      summary: "List the countries giving the most this week",
      responses: {
        200: ok("Up to 10 country names.", {
          type: "array",
          items: { type: "string" },
        }),
        ...api_errors(500),
      },
    },
  },
];

const PARAM_SCHEMA: Record<QueryParam, Json> = {
  status: {
    type: "string",
    enum: ["draft", "published", "ended"],
    description: "Only campaigns in this state.",
  },
  cursor: {
    type: "string",
    description: "The `next_cursor` of the previous page.",
  },
  limit: {
    type: "integer",
    minimum: 1,
    maximum: 100,
    default: 25,
    description: "Page size.",
  },
  campaign_id: { type: "string", description: "Only this campaign's gifts." },
  from: { type: "string", format: "date", description: "First day, UTC." },
  to: { type: "string", format: "date", description: "Last day, UTC." },
  q: { type: "string", maxLength: 200, description: "Name or email search." },
};

const FIELD_SCHEMA: Record<BodyKey, Json> = {
  title: { type: "string", minLength: 1, maxLength: 200 },
  goal: {
    description: '`{amount, currency: "USD"}`, or null for no goal.',
    type: ["object", "null"],
  },
  end_date: {
    description: "Last day, YYYY-MM-DD, or null for no end.",
    type: ["string", "null"],
  },
  time_zone: {
    description: "Send it back as read; this action can't change it.",
  },
  sharing: {
    description: "Send it back as read; this action can't change it.",
  },
  expected_version: {
    type: "string",
    pattern: EXPECTED_VERSION.source,
    description:
      "The `version` you read. If the campaign changed since, the write is a 409 `stale_read`.",
  },
  blocks: { type: "array", items: { type: "object" } },
  gifts_go_to: {
    description:
      "Campaigns: a program id, or null for the general fund. Forms: as `get_form` shows it.",
  },
  name: { type: "string" },
  status: { type: "string", enum: ["active", "inactive"] },
  suggested_amounts: { type: "array" },
  frequencies: { type: "array", items: { type: "string" } },
  donate_methods: { type: "array", items: { type: "string" } },
  id: { description: "Send it back as read; this action can't change it." },
  campaign_id: {
    description: "Send it back as read; this action can't change it.",
  },
  updated_at: {
    type: "string",
    description:
      "The `updated_at` you read. If the form changed since, the write is a 409 `stale_read`.",
  },
  minimum: {
    description: "Send it back as read; this action can't change it.",
  },
  maximum: {
    description: "Send it back as read; this action can't change it.",
  },
  allowed_origins: {
    description: "Send it back as read; this action can't change it.",
  },
  confirm: {
    const: true,
    description: "Confirms a change donors will see.",
  },
  target: { type: "string", description: "The campaign id." },
  slot: { const: "hero" },
};

const KEYED = [{ connectorKey: [] }];

const id_param = (what: string) =>
  path_param("id", { type: "string" }, `The ${what} id.`);

function query_of(action: keyof typeof QUERY_PARAMS) {
  return QUERY_PARAMS[action].map((name: QueryParam) => ({
    name,
    in: "query",
    required: false,
    schema: PARAM_SCHEMA[name],
  }));
}

function body_of(
  action: keyof typeof BODY_KEYS,
  required: string[] = [],
  optional = false
) {
  const keys: readonly BodyKey[] = BODY_KEYS[action];
  return {
    required: !optional,
    content: {
      "application/json": {
        schema: {
          type: "object",
          additionalProperties: false,
          required,
          properties: Object.fromEntries(keys.map((k) => [k, FIELD_SCHEMA[k]])),
        },
      },
    },
  };
}

const idempotency_key = (required: boolean) => ({
  name: "Idempotency-Key",
  in: "header",
  required,
  description: required
    ? "One logical write per key for 24 hours; a retry with the same key and body replays the first answer."
    : "Optional. When sent, a retry with the same key and body replays the first answer, as on `create_campaign`.",
  schema: { type: "string", minLength: 1, maxLength: 255 },
});

const keyed_read = (
  route: string,
  path: string,
  action: keyof typeof QUERY_PARAMS,
  summary: string,
  extra: { id_of?: string; refuses?: number[] } = {}
): IOperation => ({
  route,
  path,
  method: "get",
  op: {
    operationId: action,
    summary,
    security: KEYED,
    parameters: [
      ...(extra.id_of ? [id_param(extra.id_of)] : []),
      ...query_of(action),
    ],
    responses: {
      200: ok(summary),
      ...keyed_problems(extra.refuses ?? []),
    },
  },
});

const keyed_write = (
  route: string,
  path: string,
  method: Method,
  action: keyof typeof BODY_KEYS,
  summary: string,
  extra: {
    id_of?: string;
    /** the Idempotency-Key header: required, optional, or not read */
    idem?: boolean;
    required?: string[];
    created?: Json;
    /** no body at all reads as `{}` */
    body_optional?: boolean;
    /** 4xx beyond the key check and validation */
    refuses?: number[];
  }
): IOperation => ({
  route,
  path,
  method,
  op: {
    operationId: action,
    summary,
    security: KEYED,
    parameters: [
      ...(extra.id_of ? [id_param(extra.id_of)] : []),
      ...(extra.idem === undefined ? [] : [idempotency_key(extra.idem)]),
    ],
    requestBody: body_of(action, extra.required, extra.body_optional),
    responses: {
      ...(extra.created
        ? {
            ...(extra.idem === undefined
              ? {}
              : {
                  200: ok(
                    "A retry with the same Idempotency-Key, replaying the first answer."
                  ),
                }),
            201: ok("Created.", extra.created),
          }
        : { 200: ok("The resource after the change.") }),
      ...keyed_problems([
        ...(extra.idem === undefined ? [] : [400]),
        ...(extra.refuses ?? []),
      ]),
    },
  },
});

const connector_ops = (): IOperation[] => [
  {
    route: "connector.v1.hello",
    path: "/connector/v1/hello",
    method: "get",
    op: {
      operationId: "hello",
      summary: "Get the connector contract and the actions served",
      security: [],
      responses: {
        200: ok("The contract.", {
          type: "object",
          required: ["service", "contract", "release", "name", "actions"],
          properties: {
            service: { const: "better-giving" },
            contract: { const: 1 },
            release: { type: "string" },
            name: { type: "string" },
            actions: {
              type: "array",
              items: { type: "string", enum: [...CONNECTOR_ACTIONS] },
            },
          },
        }),
        ...problems(429, 500),
      },
    },
  },
  {
    route: "connector.v1.exchange",
    path: "/connector/v1/exchange",
    method: "post",
    op: {
      operationId: "exchange",
      summary: "Exchange an authorization code for an API key",
      security: [],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: wire_schema(exchange_body) },
        },
      },
      responses: {
        200: ok("The API key and the nonprofit's name.", {
          type: "object",
          required: ["key", "name"],
          properties: { key: { type: "string" }, name: { type: "string" } },
        }),
        ...problems(400, 429, 500),
      },
    },
  },
  {
    route: "connector.v1.disconnect",
    path: "/connector/v1/disconnect",
    method: "post",
    op: {
      operationId: "disconnect",
      summary: "Revoke the calling API key",
      security: KEYED,
      responses: {
        204: { description: "Revoked." },
        ...problems(401, 429, 500),
      },
    },
  },
  keyed_read(
    "connector.v1.campaigns",
    "/connector/v1/campaigns",
    "list_campaigns",
    "List campaigns"
  ),
  keyed_write(
    "connector.v1.campaigns",
    "/connector/v1/campaigns",
    "post",
    "create_campaign",
    "Create a draft campaign",
    {
      idem: true,
      required: ["title"],
      created: { type: "object" },
      refuses: [409],
    }
  ),
  keyed_read(
    "connector.v1.campaigns.$id",
    "/connector/v1/campaigns/{id}",
    "get_campaign",
    "Get a campaign",
    { id_of: "campaign", refuses: [404] }
  ),
  keyed_write(
    "connector.v1.campaigns.$id.settings",
    "/connector/v1/campaigns/{id}/settings",
    "patch",
    "update_campaign_settings",
    "Change a campaign's goal or end date",
    { id_of: "campaign", refuses: [404, 409] }
  ),
  keyed_write(
    "connector.v1.campaigns.$id.blocks",
    "/connector/v1/campaigns/{id}/blocks",
    "patch",
    "update_campaign_blocks",
    "Change a campaign page's blocks",
    { id_of: "campaign", required: ["blocks"], refuses: [404, 409] }
  ),
  keyed_write(
    "connector.v1.campaigns.$id.publish",
    "/connector/v1/campaigns/{id}/publish",
    "post",
    "publish_campaign",
    "Publish a campaign",
    { id_of: "campaign", body_optional: true, refuses: [404, 409] }
  ),
  keyed_write(
    "connector.v1.campaigns.$id.end",
    "/connector/v1/campaigns/{id}/end",
    "post",
    "end_campaign",
    "End a campaign",
    { id_of: "campaign", body_optional: true, refuses: [404] }
  ),
  keyed_read(
    "connector.v1.donation-page",
    "/connector/v1/donation-page",
    "get_donation_page",
    "Get the nonprofit's donation page",
    { refuses: [404] }
  ),
  keyed_read(
    "connector.v1.blocks.catalog",
    "/connector/v1/blocks/catalog",
    "get_block_catalog",
    "List the blocks a campaign page can hold"
  ),
  keyed_read(
    "connector.v1.forms",
    "/connector/v1/forms",
    "list_forms",
    "List donation forms"
  ),
  keyed_write(
    "connector.v1.forms",
    "/connector/v1/forms",
    "post",
    "create_form",
    "Create a donation form",
    { idem: false, created: { type: "object" }, refuses: [404, 409] }
  ),
  keyed_read(
    "connector.v1.forms.$id",
    "/connector/v1/forms/{id}",
    "get_form",
    "Get a donation form",
    { id_of: "form", refuses: [404] }
  ),
  keyed_write(
    "connector.v1.forms.$id",
    "/connector/v1/forms/{id}",
    "patch",
    "update_form",
    "Change a donation form",
    { id_of: "form", refuses: [404, 409] }
  ),
  keyed_read(
    "connector.v1.results",
    "/connector/v1/results",
    "get_results",
    "Get fundraising totals",
    { refuses: [404] }
  ),
  keyed_read(
    "connector.v1.donations",
    "/connector/v1/donations",
    "list_donations",
    "List donations",
    { refuses: [404] }
  ),
  keyed_read(
    "connector.v1.donors",
    "/connector/v1/donors",
    "list_donors",
    "List donors"
  ),
  keyed_read(
    "connector.v1.donors.$id",
    "/connector/v1/donors/{id}",
    "get_donor",
    "Get a donor and their gifts",
    { id_of: "donor", refuses: [404] }
  ),
  keyed_read(
    "connector.v1.recurring",
    "/connector/v1/recurring",
    "list_recurring_gifts",
    "List recurring gifts"
  ),
  keyed_write(
    "connector.v1.photos.upload-link",
    "/connector/v1/photos/upload-link",
    "post",
    "create_photo_upload_link",
    "Create a one-time link for uploading a campaign photo",
    {
      required: ["target"],
      refuses: [404, 409],
      created: {
        type: "object",
        required: ["url", "expires_at"],
        properties: {
          url: { type: "string", format: "uri" },
          expires_at: { type: "string", format: "date-time" },
        },
      },
    }
  ),
];

let built: readonly IOperation[] | undefined;

/** built on first use, not at import: [openapi.json] is imported at server
 * boot, and a schema `wire_schema` can't convert throws */
export function operations(): readonly IOperation[] {
  built ??= [
    ...public_ops().map((o) => ({
      ...o,
      op: { ...o.op, tags: ["public"], security: [] },
    })),
    ...connector_ops().map((o) => ({
      ...o,
      op: { ...o.op, tags: ["connector"] },
    })),
  ];
  return built;
}

const API_ERROR = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string", enum: Object.keys(API_ERROR_STATUS) },
        message: { type: "string" },
      },
    },
  },
};

const CONNECTOR_PROBLEM = {
  type: "object",
  description:
    "RFC 9457 problem details, plus `error` in the public API's shape.",
  required: ["code", "status", "error"],
  properties: {
    code: { type: "string", enum: [...PROBLEM_CODES] },
    status: { type: "integer" },
    detail: { type: "string" },
    errors: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "message"],
        properties: { path: { type: "string" }, message: { type: "string" } },
      },
    },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string", enum: [...PROBLEM_CODES] },
        message: { type: "string" },
      },
    },
  },
};

/** every error status documented by an operation on a `prefix` route; each
 * gets one components response */
const error_statuses = (prefix: string) =>
  [
    ...new Set(
      operations()
        .filter((o) => o.route.startsWith(prefix))
        .flatMap((o) => Object.keys(o.op.responses as Json).map(Number))
        .filter((s) => s >= 400)
    ),
  ].sort((a, b) => a - b);

/** the OpenAPI 3.1 document for the public read API and connector v1, with
 * `origin` as its server */
export function openapi_doc(origin: string) {
  const paths: Record<string, Record<string, Json>> = {};
  for (const { path, method, op } of operations()) {
    paths[path] = { ...paths[path], [method]: op };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Better Giving API",
      version: "1.0.0",
      description:
        'Public reads need no key. Connector v1 acts for one nonprofit with a key sent as `Authorization: Bearer <key>`. Public errors are `{"error": {"code", "message"}}`; connector errors are `application/problem+json` carrying the same `error` object.',
      contact: { name: "Better Giving", url: `${origin}/agents` },
    },
    servers: [{ url: origin }],
    tags: [
      { name: "public", description: "Unauthenticated public reads." },
      {
        name: "connector",
        description: "Connector v1: a nonprofit's campaigns, forms and gifts.",
      },
    ],
    paths,
    components: {
      securitySchemes: {
        connectorKey: {
          type: "http",
          scheme: "bearer",
          description: "A connector API key, from `/connector/v1/exchange`.",
        },
      },
      schemas: { ApiError: API_ERROR, ConnectorProblem: CONNECTOR_PROBLEM },
      responses: {
        ...Object.fromEntries(
          error_statuses("api.").map((s) => [
            `Api${s}`,
            {
              description: STATUS_TEXT[s],
              content: { "application/json": { schema: ref("ApiError") } },
            },
          ])
        ),
        ...Object.fromEntries(
          error_statuses("connector.v1.").map((s) => [
            `Problem${s}`,
            {
              description: STATUS_TEXT[s],
              content: {
                "application/problem+json": {
                  schema: ref("ConnectorProblem"),
                },
              },
            },
          ])
        ),
      },
    },
  };
}
