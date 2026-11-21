import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../schema";

// vite inlines .sql files at build time — no node:fs needed
const migrations = import.meta.glob("../migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** each file in a transaction, as drizzle's migrator runs it: `LOCK TABLE`
 * and `SET LOCAL` only work inside one */
async function apply(client: PGlite, files: string[]) {
  for (const file of files) {
    const sql = migrations[file];
    await client.exec("BEGIN");
    // drizzle-kit uses `--> statement-breakpoint` as separator
    for (const stmt of sql!.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (!trimmed) continue;
      await client.exec("SAVEPOINT stmt");
      try {
        await client.exec(trimmed);
        await client.exec("RELEASE SAVEPOINT stmt");
      } catch (e: any) {
        // skip statements that need extensions pglite doesn't have (e.g. pg_trgm)
        if (e.message?.includes("does not exist")) {
          await client.exec("ROLLBACK TO SAVEPOINT stmt");
          continue;
        }
        await client.exec("ROLLBACK");
        throw e;
      }
    }
    await client.exec("COMMIT");
  }
}

/**
 * `stop_before` (a migration file prefix, e.g. "0042") holds back that
 * migration and every later one until `migrate_rest()`, to apply a migration
 * on top of rows written under the schema before it.
 */
export async function create_test_db(opts?: { stop_before?: string }) {
  const client = new PGlite({ extensions: { pg_trgm } });
  await client.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm");

  const files = Object.keys(migrations).sort();
  const cut = opts?.stop_before
    ? files.findIndex((f) => f.split("/").pop()!.startsWith(opts.stop_before!))
    : -1;
  if (opts?.stop_before && cut < 0) {
    throw new Error(`no migration starts with ${opts.stop_before}`);
  }
  const head = cut < 0 ? files : files.slice(0, cut);
  const rest = cut < 0 ? [] : files.slice(cut);

  await apply(client, head);

  const db = drizzle(client, { schema });
  return { db, client, migrate_rest: () => apply(client, rest) };
}

export type TestDb = Awaited<ReturnType<typeof create_test_db>>;

/** an npo inserted by its oldest required columns only, for a db held back by
 * `stop_before`: drizzle names every column today's schema has, which a table
 * from before a later migration added one doesn't */
export async function seed_npo_sql(
  client: PGlite,
  registration_number: string
): Promise<number> {
  const r = await client.query<{ id: number }>(
    `insert into npos (registration_number, name, endow_designation, overview_pt, hq_country, published, active)
       values ($1, 'Fund Test NPO', 'Charity', '[]', 'United States', false, true)
     returning id`,
    [registration_number]
  );
  return r.rows[0]!.id;
}
