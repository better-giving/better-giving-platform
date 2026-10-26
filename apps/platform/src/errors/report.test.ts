import { beforeEach, describe, expect, test, vi } from "vitest";

const capture_exception = vi.fn();
vi.mock("@sentry/react-router", () => ({
  captureException: (...args: unknown[]) => capture_exception(...args),
}));

const { report_error, report_unhandled } = await import("./report");
const { HttpError } = await import("@/helpers/https");
const { ChariotError } = await import("@better-giving/chariot");
const { DrizzleQueryError } = await import("drizzle-orm/errors");
let console_error: ReturnType<typeof vi.spyOn>;

// the `report` tag IS the contract: `report:bug` is meant to read as a list of
// our own bugs, so anything a third party throws that leaves the ui working has
// to land on `degraded` instead. level carries the same split for the event
// page, but only the tag is searchable, so both are asserted together.
const level = () => capture_exception.mock.calls.at(-1)?.[1]?.level;
const report = () => capture_exception.mock.calls.at(-1)?.[1]?.tags?.report;

// what safari actually throws — read as a plain object because the real one
// crosses the embedder's realm
const insecure_parent = {
  name: "InvalidAccessError",
  message:
    "Trying to start an Apple Pay session from a document with an insecure parent frame.",
};

// webkit's wording for the same refusal on an https embed of another origin —
// the supported cross-origin embed, where the probe also can't run
const cross_origin = {
  name: "InvalidAccessError",
  message:
    "Trying to start an Apple Pay session from a document with an different security origin than its top-level frame.",
};

describe("report_unhandled", () => {
  beforeEach(() => {
    capture_exception.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  test("degrades safari's insecure-parent apple pay rejection", () => {
    report_unhandled(insecure_parent);
    expect(level()).toBe("warning");
    expect(report()).toBe("degraded");
  });

  test("degrades webkit's cross-origin apple pay rejection", () => {
    report_unhandled(cross_origin);
    expect(level()).toBe("warning");
    expect(report()).toBe("degraded");
  });

  // both halves of the match are required — the name on its own is a generic
  // dom error, and keying on it would bury real defects
  test("still reports another InvalidAccessError as an error", () => {
    report_unhandled({ name: "InvalidAccessError", message: "detached node" });
    expect(level()).toBe("error");
    expect(report()).toBe("bug");
  });

  test("still reports the apple pay message under another name", () => {
    report_unhandled({ name: "TypeError", message: insecure_parent.message });
    expect(level()).toBe("error");
    expect(report()).toBe("bug");
  });

  test("reports an ordinary rejection as an error", () => {
    report_unhandled(new Error("boom"));
    expect(level()).toBe("error");
    expect(report()).toBe("bug");
  });

  // this sink is the only capture path, so a reason it cannot serialise has to
  // still reach sentry rather than throw on the way
  test("survives a reason that references itself", () => {
    const cyclic: Record<string, unknown> = { code: "ERR" };
    cyclic.self = cyclic;
    expect(() => report_unhandled(cyclic)).not.toThrow();
    expect(capture_exception).toHaveBeenCalledTimes(1);
    expect(level()).toBe("error");
    expect(report()).toBe("bug");
  });

  // the sink takes whatever a rejected promise carried, which need not be an
  // object at all
  test("survives a primitive reason", () => {
    report_unhandled("boom");
    expect(level()).toBe("error");
    expect(report()).toBe("bug");
    report_unhandled(undefined);
    expect(level()).toBe("error");
    expect(report()).toBe("bug");
  });
});

describe("report_error", () => {
  beforeEach(() => {
    capture_exception.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  // a refusal the donor reads and acts on is not a defect
  test("keeps a 4xx HttpError off sentry", () => {
    report_error(new HttpError(400, "The minimum donation is $2."));
    expect(capture_exception).not.toHaveBeenCalled();
  });

  // a background loader's thrown Response reaches the unhandled sink; sentry
  // records an untitled event for anything that isn't an Error
  const sent_message = () => {
    const sent = capture_exception.mock.calls.at(-1)?.[0];
    expect(sent).toBeInstanceOf(Error);
    return (sent as Error).message;
  };

  test("titles a 5xx Response with its status and path", () => {
    const res = new Response(null, { status: 500 });
    Object.defineProperty(res, "url", {
      value: "https://better.giving/register/r-1/2.data?_routes=x",
    });
    report_unhandled(res);
    expect(sent_message()).toBe("Response 500 /register/r-1/2.data");
  });

  // react-router throws a redirect with no url; its target is the Location
  test("titles a redirect Response with its status and target", () => {
    report_unhandled(
      new Response(null, {
        status: 302,
        headers: { Location: "/register/r-1/5?email=a%40b.co" },
      })
    );
    expect(sent_message()).toBe("Response 302 /register/r-1/5");
  });

  test("titles a redirect to an unparseable Location by its status", () => {
    report_unhandled(
      new Response(null, { status: 302, headers: { Location: "http://[" } })
    );
    expect(sent_message()).toBe("Response 302");
  });

  test("titles a Response with no url by its status", () => {
    report_error(new Response(null, { status: 503 }));
    expect(sent_message()).toBe("Response 503");
  });

  test("keeps a 4xx Response off sentry", () => {
    report_error(new Response(null, { status: 404 }));
    expect(capture_exception).not.toHaveBeenCalled();
  });

  // every 5xx titled blank grouped into one tracker issue
  test("reports a 5xx HttpError titled by its status", () => {
    report_error(new HttpError(502));
    expect(capture_exception).toHaveBeenCalledOnce();
    expect(sent_message()).toBe("HTTP 502");
  });

  // a 4xx without the refusal marker came from something in front of the route
  // (a waf block, a rate limit) or a route answer nobody worded for the donor
  test("reports an unmarked 4xx HttpError as a bug", () => {
    report_error(new HttpError(403));
    expect(capture_exception).toHaveBeenCalledOnce();
    expect(level()).toBe("error");
    expect(report()).toBe("bug");
  });

  // chariot's 4xx is our request refused (a bad key, a grant already
  // processing), never a refusal a donor acted on
  test("reports a chariot 409", () => {
    const err = new ChariotError(409, '{"message":"processing"}', "req_1");
    report_error(err);
    expect(capture_exception.mock.calls[0]?.[0]).toBe(err);
  });
});

// drizzle's DrizzleQueryError message ends in `params: …` — the bound values,
// here a donor's email — and postgres' own `detail` echoes them again
describe("report_error with a failed query", () => {
  const email = "donor@example.com";
  const query = 'update "donations" set "email" = $1 where "id" = $2';
  const failed_query = () => {
    const pg = Object.assign(
      new Error(`duplicate key value violates unique constraint "don_email"`),
      {
        code: "23505",
        constraint: "don_email",
        table: "donations",
        detail: `Key (email)=(${email}) already exists.`,
      }
    );
    return new DrizzleQueryError(query, [email, "don-1"], pg);
  };
  const logged = () =>
    JSON.stringify(
      [console_error.mock.calls, capture_exception.mock.calls],
      (_, v) =>
        v instanceof Error
          ? { ...v, message: v.message, stack: v.stack, cause: v.cause }
          : v
    );

  beforeEach(() => {
    capture_exception.mockClear();
    console_error = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("keeps bound values out of the log and sentry", () => {
    report_error(failed_query());
    expect(capture_exception).toHaveBeenCalledOnce();
    expect(logged()).not.toContain(email);
    const sent = capture_exception.mock.calls[0]![0] as Error & {
      code: unknown;
      constraint: unknown;
    };
    expect(sent.message).toContain(query);
    expect(sent.code).toBe("23505");
    expect(sent.constraint).toBe("don_email");
  });

  test("scrubs a failed query wrapped as another error's cause", () => {
    report_error(new Error("settle failed", { cause: failed_query() }));
    expect(capture_exception).toHaveBeenCalledOnce();
    expect(logged()).not.toContain(email);
    const sent = capture_exception.mock.calls[0]![0] as Error;
    expect(sent.message).toBe("settle failed");
    const cause = sent.cause as Error & { code: unknown };
    expect(cause.message).toContain(query);
    expect(cause.code).toBe("23505");
    expect(sent.stack).toMatch(/^Error: settle failed\n\s+at /);
  });

  test("reports any other error as thrown", () => {
    const err = new Error("boom", { cause: new Error("inner") });
    report_error(err);
    expect(console_error.mock.calls[0]![0]).toBe(err);
    expect(capture_exception.mock.calls[0]![0]).toBe(err);
  });
});

describe("a photo upload token", () => {
  const TOKEN = "Zq3vY8pR2mK7tW1xN5bH9cJ4dF6gL0sA-_eUoIiPyQr";

  beforeEach(() => {
    capture_exception.mockClear();
    console_error = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("never reaches the console or sentry, in the context or the error", () => {
    const url = `https://bg.test/photo-upload/${TOKEN}?x=1`;
    report_error(new Error(`loader failed at ${url}`), {
      method: "POST",
      url,
    });

    const logged = JSON.stringify(console_error.mock.calls[0], (_, v) =>
      v instanceof Error ? { message: v.message, stack: v.stack } : v
    );
    const [sent, opts] = capture_exception.mock.calls[0]!;
    for (const text of [
      logged,
      (sent as Error).message,
      String((sent as Error).stack),
      JSON.stringify(opts),
    ]) {
      expect(text).not.toContain(TOKEN);
    }
    expect((sent as Error).message).toBe(
      "loader failed at https://bg.test/photo-upload/[redacted]?x=1"
    );
    expect((sent as Error).stack).toMatch(
      /^Error: loader failed at https:\/\/bg\.test\/photo-upload\/\[redacted\]\?x=1\n\s+at /
    );
    expect(opts.extra).toEqual({
      method: "POST",
      url: "https://bg.test/photo-upload/[redacted]?x=1",
    });
  });
});
