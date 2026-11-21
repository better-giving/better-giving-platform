import {
  is_pooled_url,
  MIGRATE_LOCK_KEY,
  with_advisory_lock,
} from "./migrate-lock.ts";

/** the slice of neon's `Client` a migrate run uses — or a test fake */
export interface MigrateClient {
  connect(): Promise<unknown>;
  query(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<unknown>;
}

export interface MigrateRun<C extends MigrateClient> {
  url: string | undefined;
  /**
   * builds the session's client; called only once `url` has passed, since
   * neon's `Client` parses it on construction and throws with it — password
   * included — when it can't
   */
  client: (url: string) => C;
  /** expand/contract guard problems; any refuses the run before it connects */
  guard: () => string[];
  /** applies pending migrations on `client`'s own session */
  apply: (client: C) => Promise<void>;
  /** how long to queue behind another run's lock */
  lock_wait?: string;
  /** per-statement lock wait for the migration's DDL */
  ddl_lock_timeout?: string;
  /** tries of the whole apply when its DDL hits `ddl_lock_timeout` or loses a
   * deadlock */
  attempts?: number;
  /** backoff unit: try n waits n × this before the next */
  retry_delay_ms?: number;
  log?: Pick<Console, "log" | "error">;
}

const set_lock_timeout = (client: MigrateClient, value: string) =>
  client.query("select set_config('lock_timeout', $1, false)", [value]);

const LOCK_NOT_AVAILABLE = "55P03";
/** postgres cancels one side of a deadlock; a DDL that lost one retries like a
 * lock timeout, since the live traffic it met has moved on by the next try */
const DEADLOCK_DETECTED = "40P01";
const RETRIED: readonly (string | undefined)[] = [
  LOCK_NOT_AVAILABLE,
  DEADLOCK_DETECTED,
];

/** the postgres code on `err`, or on the driver error drizzle wrapped in it */
function pg_code(err: unknown): string | undefined {
  for (let e = err; e instanceof Object; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
}

/** the session holding the migration lock, for the timeout message */
async function lock_holder(client: MigrateClient): Promise<string> {
  try {
    const { rows } = await client.query(
      `select l.pid, a.application_name, a.client_addr, a.backend_start, a.state
         from pg_locks l left join pg_stat_activity a using (pid)
        where l.locktype = 'advisory' and l.granted and l.objsubid = 1
          and (l.classid::bigint << 32 | l.objid::bigint) = $1::bigint`,
      [MIGRATE_LOCK_KEY]
    );
    if (rows.length === 0) return "holder already gone";
    return rows
      .map((r) =>
        Object.entries(r)
          .filter(([, v]) => v != null && v !== "")
          .map(([k, v]) => `${k} ${v instanceof Date ? v.toISOString() : v}`)
          .join(", ")
      )
      .join("; ");
  } catch (err) {
    return `holder lookup failed: ${err}`;
  }
}

/** why `url` can't carry the run, or undefined when it can */
function url_problem(url: string | undefined): string | undefined {
  if (!url) return "DATABASE_URL_UNPOOLED is unset";
  try {
    if (is_pooled_url(url)) return "DATABASE_URL_UNPOOLED is a -pooler host";
  } catch {
    // the url itself carries the password, so it is never echoed
    return "DATABASE_URL_UNPOOLED is not a valid URL (percent-encode reserved characters such as # / ? @ in the password)";
  }
}

/** exit code of one locked migrate run */
export async function run_migrate<C extends MigrateClient>({
  client: make_client,
  url,
  guard,
  apply,
  lock_wait = "10min",
  ddl_lock_timeout = "5s",
  attempts = 4,
  retry_delay_ms = 2_000,
  log = console,
}: MigrateRun<C>): Promise<number> {
  const bad_url = url_problem(url);
  if (!url || bad_url) {
    log.error(`migrate: ${bad_url}; not migrating`);
    return 1;
  }
  const problems = guard();
  if (problems.length > 0) {
    log.error(
      `migrate: migration guard found ${problems.length} problem(s); not migrating\n${problems.join("\n")}`
    );
    return 1;
  }
  const client = make_client(url);
  try {
    await client.connect();
  } catch (err) {
    // neon's socket failure is an ErrorEvent, not an Error
    const why = (err as { message?: unknown } | null)?.message ?? err;
    log.error(`migrate: can't connect; not migrating: ${why}`);
    return 1;
  }
  try {
    log.log("migrate: waiting for the migration lock");
    // bounds the wait behind a holder that died without postgres noticing yet
    await set_lock_timeout(client, lock_wait);
    return await with_advisory_lock(client, MIGRATE_LOCK_KEY, async () => {
      // the previous deployment is serving: DDL queued behind one long read
      // would queue every read behind it, so give up fast and try again
      await set_lock_timeout(client, ddl_lock_timeout);
      for (let n = 1; ; n++) {
        log.log(`migrate: lock held, applying pending migrations (try ${n})`);
        try {
          await apply(client);
          log.log("migrate: done");
          return 0;
        } catch (err) {
          const code = pg_code(err);
          if (!RETRIED.includes(code)) {
            log.error("migrate: migration failed, rolled back:", err);
            return 1;
          }
          const hit =
            code === DEADLOCK_DETECTED
              ? "a deadlock"
              : `lock timeout ${ddl_lock_timeout}`;
          if (n >= attempts) {
            log.error(
              `migrate: DDL hit ${hit} on all ${attempts} attempts; rolled back:`,
              err
            );
            return 1;
          }
          log.log(`migrate: DDL hit ${hit}; retrying`);
          await new Promise((r) => setTimeout(r, n * retry_delay_ms));
        }
      }
    });
  } catch (err) {
    if (pg_code(err) === LOCK_NOT_AVAILABLE) {
      log.error(
        `migrate: timed out after ${lock_wait} waiting for the migration lock (${await lock_holder(client)}); not migrating`
      );
    } else log.error("migrate: failed:", err);
    return 1;
  } finally {
    await client.end().catch(() => {});
  }
}
