import { describe, expect, test } from "vitest";
import {
  type MigrateClient,
  type MigrateRun,
  run_migrate,
} from "./migrate-run.ts";

const DIRECT = "postgresql://u:p@ep-cool-name-a1b2c3.aws.neon.tech/db";

/** `fail` answers a matching query with an error; consumed once per entry */
function fake_client(fail: { re: RegExp; err: unknown }[] = []) {
  const log: string[] = [];
  const make = (url: string) => {
    log.push(`new ${url}`);
    return client;
  };
  const client: MigrateClient = {
    async connect() {
      log.push("connect");
    },
    async query(sql, params = []) {
      log.push([sql, ...params].join(" "));
      const i = fail.findIndex((f) => f.re.test(sql));
      if (i >= 0) throw fail.splice(i, 1)[0].err;
      return { rows: /pg_locks/.test(sql) ? [{ pid: 4242 }] : [] };
    },
    async end() {
      log.push("end");
    },
  };
  return { client, make, log };
}

function capture() {
  const lines: string[] = [];
  const log = {
    log: (...a: unknown[]) => lines.push(a.join(" ")),
    error: (...a: unknown[]) => lines.push(a.join(" ")),
  };
  return { lines, log };
}

const lock_timeout = (err_code = "55P03") =>
  Object.assign(new Error("canceling statement due to lock timeout"), {
    code: err_code,
  });

const run = (
  make: (url: string) => MigrateClient,
  log: ReturnType<typeof capture>["log"],
  over: Partial<Omit<MigrateRun<MigrateClient>, "client">> = {}
) =>
  run_migrate({
    client: make,
    url: DIRECT,
    guard: () => [],
    apply: async (session) => {
      await session.query("apply");
    },
    retry_delay_ms: 0,
    log,
    ...over,
  });

const LOCK_WAIT = "select set_config('lock_timeout', $1, false) 10min";
const DDL_WAIT = "select set_config('lock_timeout', $1, false) 5s";
const LOCK = "select pg_advisory_lock($1::bigint) 7306195201";
const UNLOCK = "select pg_advisory_unlock($1::bigint) 7306195201";

describe("run_migrate", () => {
  test("bounds the lock wait, locks, bounds DDL waits, applies on the lock's session, unlocks, exits 0", async () => {
    const { make, log } = fake_client();
    expect(await run(make, capture().log)).toBe(0);
    expect(log).toEqual([
      `new ${DIRECT}`,
      "connect",
      LOCK_WAIT,
      LOCK,
      DDL_WAIT,
      "apply",
      UNLOCK,
      "end",
    ]);
  });

  test("refuses an unset url without connecting", async () => {
    const { make, log } = fake_client();
    const out = capture();
    expect(await run(make, out.log, { url: undefined })).toBe(1);
    expect(log).toEqual([]);
    expect(out.lines.join("\n")).toMatch(/DATABASE_URL_UNPOOLED is unset/);
  });

  test("refuses a -pooler url without connecting", async () => {
    const { make, log } = fake_client();
    const url = "postgresql://u:p@EP-X-POOLER.aws.neon.tech/db";
    expect(await run(make, capture().log, { url })).toBe(1);
    expect(log).toEqual([]);
  });

  test("refuses an unparseable url with a fix, never echoing the password", async () => {
    const { make, log } = fake_client();
    const out = capture();
    const url = "postgresql://u:s3cr#t@ep-x.aws.neon.tech/db";
    expect(await run(make, out.log, { url })).toBe(1);
    expect(log).toEqual([]);
    const said = out.lines.join("\n");
    expect(said).toMatch(/not a valid URL.*percent-encode/);
    expect(said).not.toMatch(/s3cr/);
  });

  test("refuses on a guard problem before connecting", async () => {
    const { make, log } = fake_client();
    const out = capture();
    const guard = () => ["0046_x.sql: DROP COLUMN without a contract marker"];
    expect(await run(make, out.log, { guard })).toBe(1);
    expect(log).toEqual([]);
    expect(out.lines.join("\n")).toMatch(/0046_x\.sql: DROP COLUMN/);
  });

  test("gives up on a lock held past the wait, naming the holder, never applying", async () => {
    const { make, log } = fake_client([
      { re: /pg_advisory_lock/, err: lock_timeout() },
    ]);
    const out = capture();
    expect(await run(make, out.log)).toBe(1);
    expect(log).not.toContain("apply");
    expect(log.at(-1)).toBe("end");
    expect(out.lines.join("\n")).toMatch(
      /timed out after 10min waiting for the migration lock.*pid 4242/
    );
  });

  test("retries the apply on a DDL lock timeout, under the one lock, and exits 0", async () => {
    // drizzle wraps the driver error; its code sits on `cause`
    const wrapped = new Error("Failed query", { cause: lock_timeout() });
    const { make, log } = fake_client([
      { re: /^apply$/, err: wrapped },
      { re: /^apply$/, err: lock_timeout() },
    ]);
    expect(await run(make, capture().log)).toBe(0);
    expect(log.filter((l) => l === "apply")).toHaveLength(3);
    expect(log.filter((l) => l === LOCK)).toHaveLength(1);
    expect(log.slice(-2)).toEqual([UNLOCK, "end"]);
  });

  test("retries the apply on a deadlock its DDL lost, under the one lock, and exits 0", async () => {
    const deadlock = new Error("Failed query", {
      cause: Object.assign(new Error("deadlock detected"), { code: "40P01" }),
    });
    const { make, log } = fake_client([{ re: /^apply$/, err: deadlock }]);
    expect(await run(make, capture().log)).toBe(0);
    expect(log.filter((l) => l === "apply")).toHaveLength(2);
    expect(log.filter((l) => l === LOCK)).toHaveLength(1);
    expect(log.slice(-2)).toEqual([UNLOCK, "end"]);
  });

  test("stops retrying after the last attempt, unlocks, and exits 1", async () => {
    const { make, log } = fake_client(
      Array.from({ length: 4 }, () => ({ re: /^apply$/, err: lock_timeout() }))
    );
    const out = capture();
    expect(await run(make, out.log, { attempts: 4 })).toBe(1);
    expect(log.filter((l) => l === "apply")).toHaveLength(4);
    expect(log.slice(-2)).toEqual([UNLOCK, "end"]);
    expect(out.lines.join("\n")).toMatch(/lock timeout.*4 attempts/);
  });

  test("doesn't retry any other migration error, and exits 1", async () => {
    const { make, log } = fake_client([
      { re: /^apply$/, err: lock_timeout("42P07") },
    ]);
    expect(await run(make, capture().log)).toBe(1);
    expect(log.filter((l) => l === "apply")).toHaveLength(1);
    expect(log.slice(-2)).toEqual([UNLOCK, "end"]);
  });

  test("exits 1 when it can't connect", async () => {
    const { client, make } = fake_client();
    client.connect = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const out = capture();
    expect(await run(make, out.log)).toBe(1);
    expect(out.lines.join("\n")).toMatch(/ENOTFOUND/);
  });
});
