import { afterAll, describe, expect, test, vi } from "vitest";
import {
  SAFE,
  SECRETS,
  vercel_request,
} from "#/__tests__/fixtures/sentry-request";

// both entries' `Sentry.init`, captured instead of run
const init = vi.hoisted(() => vi.fn());
// stands in for the integration so the test can read the options it was built with
const requestDataIntegration = vi.hoisted(() =>
  vi.fn((options: unknown) => ({ name: "RequestData", options }))
);
vi.mock("@sentry/react-router", () => ({ init, requestDataIntegration }));
vi.mock("$/env", () => ({
  sentry: { dsn: "https://key@o0.ingest.sentry.io/0" },
  stage: "production",
}));
// the client entry hydrates `document` at import; nothing here to hydrate
vi.mock("react-dom/client", () => ({ hydrateRoot: vi.fn() }));

const TOKEN = "Ab1_Cd2-Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2Yz3ab";
const PATH = `/photo-upload/${TOKEN}`;

/** an event carrying the token everywhere a page's path lands */
const event = () => ({
  message: `failed on ${PATH}`,
  request: { url: `https://bg.test${PATH}?x=1` },
  exception: { values: [{ value: `POST ${PATH} 500` }] },
  breadcrumbs: [{ category: "navigation", data: { to: PATH } }],
});

type Options = Record<string, unknown>;

async function options_of(entry: () => Promise<unknown>): Promise<Options> {
  init.mockClear();
  await entry();
  expect(init).toHaveBeenCalledOnce();
  return init.mock.calls[0]![0] as Options;
}

/** every hook the init sets on outgoing data must strip the token;
 * `beforeSend` is the one an error report always passes through */
function expect_redacting(options: Options) {
  expect(options.beforeSend).toBeTypeOf("function");
  const hooks = [
    "beforeSend",
    "beforeSendTransaction",
    "beforeBreadcrumb",
    "beforeSendLog",
  ] as const;
  for (const hook of hooks) {
    const fn = options[hook] as
      | ((x: unknown, hint?: unknown) => unknown)
      | undefined;
    if (!fn) continue;
    const input =
      hook === "beforeBreadcrumb" ? event().breadcrumbs[0] : event();
    const out = JSON.stringify(fn(input, {}));
    expect(out, hook).not.toContain(TOKEN);
    expect(out, hook).toContain("/photo-upload/[redacted]");
  }
}

/** both hooks a server event leaves through must filter the request's
 * secrets; a hook missing from the init fails here */
function expect_scrubbing_request(options: Options) {
  for (const hook of ["beforeSend", "beforeSendTransaction"] as const) {
    const fn = options[hook] as
      | ((x: unknown, hint?: unknown) => unknown)
      | undefined;
    expect(fn, hook).toBeTypeOf("function");
    const raw = vercel_request();
    const out = fn!({ ...event(), request: raw }, {}) as {
      request: ReturnType<typeof vercel_request>;
    };
    const json = JSON.stringify(out);
    for (const secret of SECRETS)
      expect(json, `${hook}: ${secret}`).not.toContain(secret);
    for (const name of SAFE) {
      expect(
        out.request.headers[name as keyof typeof raw.headers],
        `${hook}: ${name}`
      ).toBe(raw.headers[name as keyof typeof raw.headers]);
    }
    expect(out.request.cookies, hook).toEqual({
      "__Secure-better-auth.session_token": "[Filtered]",
      theme: "[Filtered]",
    });
  }
}

describe("every Sentry setup strips photo upload tokens before sending", () => {
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("the server's, which also filters request headers, cookies and credential query params", async () => {
    const options = await options_of(() => import("../entry.server"));
    expect_redacting(options);
    expect(options.sendDefaultPii).toBe(false);
    expect_scrubbing_request(options);
    // the SDK never collects cookies, so the hooks are the second line for them
    expect(options.integrations).toContainEqual({
      name: "RequestData",
      options: { include: expect.objectContaining({ cookies: false }) },
    });
  });

  test("the browser's", async () => {
    vi.stubEnv("VITE_STAGE", "production");
    vi.stubEnv("VITE_SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    vi.stubGlobal("document", {});
    const options = await options_of(() => import("../entry.client"));
    expect(options.sendDefaultPii).toBe(false);
    expect_redacting(options);
  });
});
