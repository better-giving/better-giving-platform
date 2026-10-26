/**
 * preview and staging only. postbuild runs this after migrate when CI is
 * set and VERCEL_ENV is not production. the sql is the file seed.sql
 * includes for the local verify fixture.
 *
 * production, or VERCEL_ENV unset, exits 0 without connecting. a database
 * with neither VERIFY0001 nor VERIFY0003 logs one line and inserts nothing:
 * this script does not create nonprofits.
 *
 * plain node, like migrate.ts: erasable TS, neon Client on the unpooled url.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { is_pooled_url } from "./migrate-lock.ts";

// four levels up: pg, .server, platform, apps — then the repo root
export const SUPPORTER_SQL = join(
  import.meta.dirname,
  "../../../../.claude/skills/verify-platform/scripts/seed-supporter-fundraiser.sql"
);

const FIXTURE_NPOS = ["VERIFY0001", "VERIFY0003"] as const;

const NEITHER_FIXTURE =
  "seed-preview-campaign: neither VERIFY0001 nor VERIFY0003 exists; not seeding";

export interface SeedSession {
  connect(): Promise<unknown>;
  query(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<unknown>;
}

export interface SeedPreview {
  vercel_env: string | undefined;
  url: string | undefined;
  /** the supporter-fundraiser script, the same text psql includes */
  sql: string;
  client: (url: string) => SeedSession;
  log?: Pick<Console, "log" | "error">;
}

/**
 * one command per `Client.query`. the extended protocol rejects a second
 * command in the same string, and a semicolon inside a quoted value has to
 * stay in that insert.
 */
export function sql_statements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let in_quote = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i] ?? "";
    if (!in_quote && c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    if (c === "'") {
      if (in_quote && sql[i + 1] === "'") {
        current += "''";
        i++;
        continue;
      }
      in_quote = !in_quote;
      current += c;
      continue;
    }
    if (!in_quote && c === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }
    current += c;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

/** why `url` can't carry the run, or undefined when it can */
function url_problem(url: string | undefined): string | undefined {
  if (!url) return "DATABASE_URL_UNPOOLED is unset";
  try {
    if (is_pooled_url(url)) return "DATABASE_URL_UNPOOLED is a -pooler host";
  } catch {
    // Client's constructor throws the url, password included, when it can't parse
    return "DATABASE_URL_UNPOOLED is not a valid URL (percent-encode reserved characters such as # / ? @ in the password)";
  }
}

/** exit code of one preview seed. 0 is "wrote nothing" as well as "wrote" */
export async function seed_preview_campaign({
  vercel_env,
  url,
  sql,
  client: open,
  log = console,
}: SeedPreview): Promise<number> {
  if (!vercel_env || vercel_env === "production") return 0;
  const bad_url = url_problem(url);
  if (!url || bad_url) {
    log.error(`seed-preview-campaign: ${bad_url}; not seeding`);
    return 1;
  }
  const session = open(url);
  try {
    await session.connect();
    const found = await session.query(
      `select 1 from npos where registration_number in ($1, $2) limit 1`,
      [...FIXTURE_NPOS]
    );
    if (found.rows.length === 0) {
      log.log(NEITHER_FIXTURE);
      return 0;
    }
    await session.query("begin");
    try {
      for (const statement of sql_statements(sql)) {
        await session.query(statement);
      }
      await session.query("commit");
    } catch (err) {
      await session.query("rollback").catch((rollback_err) => {
        log.error("seed-preview-campaign: rollback failed:", rollback_err);
      });
      throw err;
    }
    return 0;
  } catch (err) {
    const why = (err as { message?: unknown } | null)?.message ?? err;
    log.error(`seed-preview-campaign: failed: ${why}`);
    return 1;
  } finally {
    await session.end().catch(() => {});
  }
}

function session(url: string): SeedSession {
  // same constructor migrate.ts sets: don't take whichever global WebSocket
  // the node version ships
  neonConfig.webSocketConstructor = ws;
  const client = new Client(url);
  // a socket error also rejects the pending query; unheard, it crashes the
  // process before the exit code is set
  client.on("error", (err) => {
    console.error("seed-preview-campaign: session lost:", err);
  });
  return {
    connect: () => client.connect(),
    query: (sql, params) => client.query(sql, params),
    end: () => client.end(),
  };
}

const is_entry =
  !!process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (is_entry) {
  process.exit(
    await seed_preview_campaign({
      vercel_env: process.env.VERCEL_ENV,
      url: process.env.DATABASE_URL_UNPOOLED,
      sql: readFileSync(SUPPORTER_SQL, "utf8"),
      client: session,
    })
  );
}
