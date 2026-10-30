import { afterEach, describe, expect, test, vi } from "vitest";

const qstash_env = vi.hoisted(() => ({
  token: "t",
  current_signing_key: "sig_current" as string | undefined,
  next_signing_key: "sig_next" as string | undefined,
}));

vi.mock("../env", () => ({
  app: { slug: "bg" },
  base_url: "https://app.test",
  stage: "test",
  qstash: qstash_env,
}));

const { receiver, verify_qstash, enqueue } = await import("./queue");
const { KINDS, lane_of, msg } = await import("@/queue/registry");

const TARGET_URL = "https://app.test/api/cron/grants";

const signed = (signature: string, body = "{}") =>
  new Request(TARGET_URL, {
    method: "POST",
    headers: { "upstash-signature": signature },
    body,
  });

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const b64url_json = (v: unknown) =>
  b64url(new TextEncoder().encode(JSON.stringify(v)));

/** the HS256 jwt qstash sends: issuer, url as subject, sha256 of the body */
async function qstash_signature(key: string, body: string) {
  const enc = new TextEncoder();
  const body_hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", enc.encode(body))
  );
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url_json({ alg: "HS256", typ: "JWT" })}.${b64url_json({
    iss: "Upstash",
    sub: TARGET_URL,
    iat: now,
    nbf: now,
    exp: now + 300,
    body: b64url(body_hash),
  })}`;
  const hmac = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", hmac, enc.encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}

afterEach(() => {
  qstash_env.current_signing_key = "sig_current";
  qstash_env.next_signing_key = "sig_next";
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("verify_qstash", () => {
  test("answers a junk signature 401, not a thrown error", async () => {
    const res = await verify_qstash(signed("x")).catch((e: unknown) => e);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });

  test("answers a verify that resolves false 401", async () => {
    // 2.10.1 only throws, but its type is Promise<boolean>
    vi.spyOn(receiver, "verify").mockResolvedValueOnce(false);

    const res = await verify_qstash(signed("x")).catch((e: unknown) => e);

    expect((res as Response).status).toBe(401);
  });

  test("answers a missing signature 401", async () => {
    const res = await verify_qstash(
      new Request("https://app.test/api/cron/grants", { method: "POST" })
    ).catch((e: unknown) => e);

    expect((res as Response).status).toBe(401);
  });

  test("returns the body of a message signed with the current key", async () => {
    const body = '{"id":"don-1"}';
    const signature = await qstash_signature("sig_current", body);

    expect(await verify_qstash(signed(signature, body))).toBe(body);
  });

  test("lets a missing-signing-keys error through as a 500, not a 401", async () => {
    qstash_env.current_signing_key = undefined;
    qstash_env.next_signing_key = undefined;
    // the receiver also falls back to these before giving up
    vi.stubEnv("QSTASH_CURRENT_SIGNING_KEY", "");
    vi.stubEnv("QSTASH_NEXT_SIGNING_KEY", "");
    vi.resetModules();
    const { verify_qstash: unkeyed } = await import("./queue");

    const res = await unkeyed(signed("x")).catch((e: unknown) => e);

    expect(res).toBeInstanceOf(Error);
    expect(String(res)).toMatch(/No signing keys/);
  });
});

describe("enqueue", () => {
  /** the queue each enqueued kind went to, in send order */
  function capture() {
    const sent: { queue: string; kind: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      const [, queue, kind] =
        url.match(/\/v2\/enqueue\/([^/]+)\/.*\/api\/q-handler\/([^/?]+)/) ?? [];
      sent.push({ queue: queue!, kind: kind! });
      return Response.json({ messageId: "m" });
    });
    vi.spyOn(console, "info").mockImplementation(() => {});
    return sent;
  }

  // fixture wide enough for every dedupe recipe
  const payload = {
    id: "x1",
    npo_id: 7,
    to_id: 7,
    dist_id: "dist-1",
    fund_id: "f1",
    creator_id: "u1",
    invitee: "x@y.z",
    sent_at: "2026-10-02T12:30:45.678Z",
    date_created: "2026-01-02T03:04:05Z",
    order_id: "O-1",
    status: "02",
    updated_at: "2026-09-01T10:20:30.456Z",
    cancelled_at: "2026-10-02T12:30:45.678Z",
  };

  test("sends each kind to its lane's queue", async () => {
    const sent = capture();

    await enqueue(...KINDS.map((k) => msg(k, payload as never)));

    expect(sent.map((s) => s.kind)).toEqual(KINDS);
    for (const s of sent) {
      expect(s.queue).toBe(
        lane_of(s.kind as never) === "money" ? "bg-test-money-q" : "bg-test-q"
      );
    }
  });

  // a qstash queue delivers one message at a time and waits out every retry
  // of its head, so what can delay a message is what shares its queue
  test("a failing notification enqueued first shares no queue with a split or a transfer", async () => {
    const sent = capture();

    await enqueue(
      msg("fiat-notice", { id: "evt_1", alert: { from: "t", title: "x" } }),
      msg("don-sttl-receipt", payload as never),
      msg("don-sttl-dist", payload as never),
      msg("connect-transfer", {
        dist_id: "dist-1",
        donation_id: "d1",
        intent_id: "pi_1",
      })
    );

    const money = sent.filter((s) => s.queue === "bg-test-money-q");
    expect(money.map((s) => s.kind)).toEqual([
      "don-sttl-dist",
      "connect-transfer",
    ]);
    expect(
      sent.filter((s) => s.queue === "bg-test-q").map((s) => s.kind)
    ).toEqual(["fiat-notice", "don-sttl-receipt"]);
  });
});
