import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { put } from "@vercel/blob";
import { and, asc, eq, gt, like, or } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { DOC_PREFIX } from "../.server/blob-upload";
import { doc_source } from "../.server/doc-access";
import { db } from "../.server/pg/db";
import { banking_apps } from "../.server/pg/schema/banking";
import { doc_url_aliases } from "../.server/pg/schema/doc-alias";
import { registrations } from "../.server/pg/schema/registration";

/**
 * moves uploaded documents (identity, registration proof, bank statements)
 * into the private store and rewrites the rows that hold them.
 *
 * for every row whose document column still holds a url in the original store:
 * copy the file into the private store under `docs/migrated/`, point the row at
 * the copy, record `old → new` in `doc_url_aliases` in the same transaction (so
 * an `/api/docs?ref=<old>` link already handed out keeps opening), and append
 * it to a local file. a row edited after it was read is left as it is. nothing
 * in the original store is deleted. rows whose file is already gone are only
 * reported, so they can be nulled by hand. rows already pointing at the
 * private store are left alone, so a rerun does the rest of what an
 * interrupted run did.
 *
 * ## Running
 *
 * env (a `--env-file` or the shell): `DATABASE_URL` — the database to read and
 * write; `BLOB_PRIVATE_READ_WRITE_TOKEN` — the private store's token. Not
 * `BLOB_READ_WRITE_TOKEN`: the original store is only read, by url. The job
 * loads the app's env module, which refuses to load without the app's own
 * required values (`BASE_URL`, the `APP_*` secrets, the NOWPayments values), so
 * use the target environment's env file. Check that `DATABASE_URL` in it is
 * the database you mean to change before passing `--commit`.
 *
 * 1. dry run — `bun --env-file=<env> jobs/migrate-private-docs.ts`. Writes
 *    nothing and copies nothing; checks each file is still there and prints
 *    counts and the ids of rows whose file is gone.
 * 2. commit — `bun --env-file=<env> jobs/migrate-private-docs.ts --commit
 *    --out <file>`. `--out` is a path outside this repo; it receives one json
 *    line per file (`old`, `new`, `table`, `column`, `id`) and is read back on
 *    a rerun so a file is copied once.
 * 3. verify — run the dry run again: it should report 0 rows to move. Open a
 *    document through `/api/docs` as a reviewer, and as the applicant.
 *
 * one transaction per batch of rows (`--batch <n>`, default 50); a batch whose
 * write fails is rolled back, logged and counted as failed, and the run goes on
 * to the next. the log holds row ids and counts only.
 */

interface ITarget {
  name: string;
  table: PgTable & { id: PgColumn };
  columns: Record<string, PgColumn>;
}

const targets: ITarget[] = [
  {
    name: "registrations",
    table: registrations,
    columns: {
      r_proof_of_identity: registrations.r_proof_of_identity,
      o_proof_of_reg: registrations.o_proof_of_reg,
      o_bank_statement: registrations.o_bank_statement,
    },
  },
  {
    name: "banking_apps",
    table: banking_apps,
    columns: { bank_statement_url: banking_apps.bank_statement_url },
  },
];

const PUBLIC_HOST = ".public.blob.vercel-storage.com";

/** a url in one of our own public stores: the only kind `/api/docs` reads, so
 * the only kind worth copying */
export const is_public_url = (v: string | null | undefined): v is string =>
  !!v && doc_source(v)?.source === "legacy";

export interface IDeps {
  fetch: typeof fetch;
  put: (
    pathname: string,
    body: Blob,
    opts: {
      access: "private";
      contentType?: string;
      addRandomSuffix: true;
      allowOverwrite: false;
      token: string | undefined;
    }
  ) => Promise<{ url: string }>;
  log: (line: string) => void;
  /** appends one old → new record to the local map file */
  record: (entry: Record<string, unknown>) => void;
}

export interface IOpts {
  commit: boolean;
  batch: number;
  /** old → new carried over from an earlier run */
  known: Map<string, string>;
  token: string | undefined;
}

export interface ISummary {
  to_move: number;
  moved: number;
  gone: number;
  failed: number;
  /** edited after it was read, so left as it is */
  changed: number;
}

export async function run(opts: IOpts, deps: IDeps): Promise<ISummary> {
  const sum: ISummary = {
    to_move: 0,
    moved: 0,
    gone: 0,
    failed: 0,
    changed: 0,
  };
  // a document copied to a banking application's row is the same file the
  // registration holds; one copy serves both
  const copied = new Map(opts.known);

  for (const t of targets) {
    let cursor = "";
    for (;;) {
      const rows = (await db
        .select({ id: t.table.id, ...t.columns } as any)
        .from(t.table)
        .where(
          and(
            gt(t.table.id, cursor),
            // any of the table's document columns still in the original store
            or(
              ...Object.values(t.columns).map((c) =>
                like(c, `https://%${PUBLIC_HOST}/%`)
              )
            )
          )
        )
        .orderBy(asc(t.table.id))
        .limit(opts.batch)) as Record<string, string | null>[];
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1]!.id!;

      const edits: { id: string; column: string; old: string; next: string }[] =
        [];
      for (const row of rows) {
        for (const column of Object.keys(t.columns)) {
          const old = row[column];
          if (!is_public_url(old)) continue;
          sum.to_move++;

          let next = copied.get(old);
          if (!next) {
            const res = await deps
              .fetch(old, { method: opts.commit ? "GET" : "HEAD" })
              .catch(() => null);
            if (!res) {
              sum.failed++;
              deps.log(`${t.name} ${row.id} ${column}: unreachable`);
              continue;
            }
            if (res.status === 404) {
              sum.gone++;
              deps.log(`${t.name} ${row.id} ${column}: gone`);
              continue;
            }
            if (!res.ok) {
              sum.failed++;
              deps.log(`${t.name} ${row.id} ${column}: status ${res.status}`);
              continue;
            }
            if (!opts.commit) continue;

            const name =
              decodeURIComponent(
                new URL(old).pathname.split("/").pop() ?? ""
              ) || "file";
            const stored = await deps
              .put(
                `${DOC_PREFIX}migrated/${t.name}/${row.id}/${name}`,
                await res.blob(),
                {
                  access: "private",
                  contentType:
                    res.headers.get("content-type")?.split(";")[0] || undefined,
                  addRandomSuffix: true,
                  allowOverwrite: false,
                  token: opts.token,
                }
              )
              .catch(() => null);
            if (!stored) {
              sum.failed++;
              deps.log(`${t.name} ${row.id} ${column}: copy failed`);
              continue;
            }
            next = stored.url;
            copied.set(old, next);
            deps.record({ old, new: next, table: t.name, column, id: row.id });
          }
          edits.push({ id: row.id!, column, old, next });
        }
      }

      if (opts.commit && edits.length) {
        const ids = [...new Set(edits.map((e) => e.id))].join(",");
        const stale: typeof edits = [];
        const moved = await db
          .transaction(async (tx) => {
            let n = 0;
            for (const e of edits) {
              const col = t.columns[e.column]!;
              // only while it still holds the url that was copied: a row
              // edited since is not overwritten
              const hit = await tx
                .update(t.table)
                .set({ [e.column]: e.next })
                .where(and(eq(t.table.id, e.id), eq(col, e.old)))
                .returning({ id: t.table.id });
              if (hit.length === 0) {
                stale.push(e);
                continue;
              }
              n++;
              await tx
                .insert(doc_url_aliases)
                .values({ old_url: e.old, new_url: e.next })
                .onConflictDoNothing();
            }
            return n;
          })
          .catch((err: unknown) => {
            // the code only: a query error's message carries its params, urls
            const code = (err as { cause?: { code?: string } }).cause?.code;
            deps.log(`${t.name}: batch ${ids} failed (${code ?? "error"})`);
            return null;
          });
        if (moved === null) {
          sum.failed += edits.length;
          continue;
        }
        for (const e of stale) {
          deps.log(`${t.name} ${e.id} ${e.column}: changed since read`);
        }
        sum.changed += stale.length;
        sum.moved += moved;
        deps.log(`${t.name}: rewrote ${moved} document refs`);
      }
    }
  }
  deps.log(
    `${opts.commit ? "commit" : "dry run"}: ${sum.to_move} to move, ${sum.moved} moved, ${sum.gone} gone, ${sum.failed} failed, ${sum.changed} changed since read`
  );
  return sum;
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};

if (import.meta.main) {
  const commit = process.argv.includes("--commit");
  const out = arg("--out");
  const repo = resolve(import.meta.dirname, "../../..");
  if (commit) {
    if (!out) throw new Error("--commit needs --out <file outside the repo>");
    const rel = relative(repo, resolve(out));
    if (!rel.startsWith(".."))
      throw new Error("--out must be outside the repo");
  }

  const known = new Map<string, string>();
  if (out && existsSync(out)) {
    for (const line of readFileSync(out, "utf8").split("\n")) {
      if (!line) continue;
      const e = JSON.parse(line) as { old: string; new: string };
      known.set(e.old, e.new);
    }
  }

  const token = process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
  if (commit && !token)
    throw new Error("BLOB_PRIVATE_READ_WRITE_TOKEN is not set");

  await run(
    { commit, batch: Number(arg("--batch") ?? 50), known, token },
    {
      fetch,
      put: (pathname, body, o) => put(pathname, body, o),
      log: (l) => console.info(l),
      record: (e) => appendFileSync(out!, `${JSON.stringify(e)}\n`),
    }
  );
  process.exit(0);
}
