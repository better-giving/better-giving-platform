import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  type SeedSession,
  SUPPORTER_SQL,
  seed_preview_campaign,
  sql_statements,
} from "./seed-preview-campaign.ts";
import {
  create_test_db,
  seed_npo_sql,
  type TestDb,
} from "./test-utils/pglite.ts";

const DIRECT = "postgresql://u:p@127.0.0.1:9/db";
const USER = "b0000000-0000-4000-8000-0000000000bb";
const FUND = "f0000000-0000-4000-8000-000000000002";
const NEITHER =
  "seed-preview-campaign: neither VERIFY0001 nor VERIFY0003 exists; not seeding";

function capture() {
  const lines: string[] = [];
  const log = {
    log: (...a: unknown[]) => lines.push(a.join(" ")),
    error: (...a: unknown[]) => lines.push(a.join(" ")),
  };
  return { lines, log };
}

function fake(
  rows: Record<string, unknown>[] = [],
  fail?: (sql: string) => Error | undefined
) {
  const queries: { sql: string; params?: unknown[] }[] = [];
  let ended = false;
  const client = (): SeedSession => ({
    async connect() {},
    async query(sql, params) {
      queries.push({ sql: sql.trim(), params });
      const err = fail?.(sql);
      if (err) throw err;
      return { rows: sql.includes("registration_number") ? rows : [] };
    },
    async end() {
      ended = true;
    },
  });
  return { client, queries, ended: () => ended };
}

describe("seed_preview_campaign", () => {
  test("exits 0 without opening a session when VERCEL_ENV is production or unset", async () => {
    const opened: string[] = [];
    const run = (vercel_env: string | undefined) =>
      seed_preview_campaign({
        vercel_env,
        url: DIRECT,
        sql: "insert into funds (id) values ('x');",
        client: (url) => {
          opened.push(url);
          throw new Error("client constructed");
        },
      });

    expect(await run("production")).toBe(0);
    expect(await run(undefined)).toBe(0);
    expect(await run("")).toBe(0);
    expect(opened).toEqual([]);
  });

  test("refuses a missing, pooled, or unparseable url without connecting", async () => {
    const opened: string[] = [];
    const open = (url: string) => {
      opened.push(url);
      throw new Error("client constructed");
    };
    const missing = capture();
    expect(
      await seed_preview_campaign({
        vercel_env: "preview",
        url: undefined,
        sql: "insert into funds (id) values ('x');",
        client: open,
        log: missing.log,
      })
    ).toBe(1);
    expect(missing.lines.join("\n")).toMatch(/DATABASE_URL_UNPOOLED is unset/);

    const pooled = capture();
    expect(
      await seed_preview_campaign({
        vercel_env: "preview",
        url: "postgresql://u:p@ep-x-pooler.aws.neon.tech/db",
        sql: "insert into funds (id) values ('x');",
        client: open,
        log: pooled.log,
      })
    ).toBe(1);
    expect(pooled.lines.join("\n")).toMatch(/-pooler/);

    const bad = capture();
    expect(
      await seed_preview_campaign({
        vercel_env: "preview",
        url: "postgresql://u:s3cr#t@127.0.0.1/db",
        sql: "insert into funds (id) values ('x');",
        client: open,
        log: bad.log,
      })
    ).toBe(1);
    const said = bad.lines.join("\n");
    expect(said).toMatch(/not a valid URL/);
    expect(said).not.toMatch(/s3cr/);
    expect(opened).toEqual([]);
  });

  test("logs once and writes nothing when neither fixture nonprofit exists", async () => {
    const { client, queries, ended } = fake([]);
    const out = capture();
    const code = await seed_preview_campaign({
      vercel_env: "preview",
      url: DIRECT,
      sql: "insert into \"user\" (id) values ('b'); insert into npos (name) values ('nope');",
      client,
      log: out.log,
    });
    expect(code).toBe(0);
    expect(out.lines).toEqual([NEITHER]);
    expect(
      queries.map((q) => q.sql).some((sql) => /^insert\b/i.test(sql))
    ).toBe(false);
    expect(queries[0]?.params).toEqual(["VERIFY0001", "VERIFY0003"]);
    expect(ended()).toBe(true);
  });

  test("runs the script in one transaction when a fixture nonprofit exists", async () => {
    const { client, queries } = fake([{ ok: 1 }]);
    const code = await seed_preview_campaign({
      vercel_env: "preview",
      url: DIRECT,
      sql: "insert into \"user\" (id) values ('b'); insert into funds (id) values ('f');",
      client,
    });
    expect(code).toBe(0);
    expect(queries.map((q) => q.sql)).toEqual([
      "select 1 from npos where registration_number in ($1, $2) limit 1",
      "begin",
      "insert into \"user\" (id) values ('b')",
      "insert into funds (id) values ('f')",
      "commit",
    ]);
  });

  test("keeps a semicolon inside a quoted value in that insert", async () => {
    const { client, queries } = fake([{ ok: 1 }]);
    const code = await seed_preview_campaign({
      vercel_env: "preview",
      url: DIRECT,
      sql: "insert into funds (description_pt) values ('a;b');",
      client,
    });
    expect(code).toBe(0);
    expect(queries.map((q) => q.sql)).toContain(
      "insert into funds (description_pt) values ('a;b')"
    );
  });

  test("rolls back and returns 1 when a statement fails", async () => {
    const { client, queries } = fake([{ ok: 1 }], (sql) =>
      sql.includes("funds") ? new Error("duplicate slug") : undefined
    );
    const out = capture();
    const code = await seed_preview_campaign({
      vercel_env: "preview",
      url: DIRECT,
      sql: "insert into \"user\" (id) values ('b'); insert into funds (id) values ('f');",
      client,
      log: out.log,
    });
    expect(code).toBe(1);
    expect(queries.map((q) => q.sql)).toContain("rollback");
    expect(queries.map((q) => q.sql)).not.toContain("commit");
    const said = out.lines.join("\n");
    expect(said).toMatch(/duplicate slug/);
    expect(said).not.toMatch(/127\.0\.0\.1/);
  });

  test("the included script is inserts only, so psql prints no result row", () => {
    const statements = sql_statements(readFileSync(SUPPORTER_SQL, "utf8"));
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement).toMatch(/^insert\b/i);
      expect(statement).not.toMatch(/\breturning\b/i);
      expect(statement.toLowerCase()).toContain("not exists");
    }
  });

  test("seed.sql includes that script before the npo id select and still inserts Harbor Listing", () => {
    const seed = readFileSync(join(SUPPORTER_SQL, "..", "seed.sql"), "utf8");
    const include = seed.indexOf("\\ir seed-supporter-fundraiser.sql");
    const select = seed.lastIndexOf(
      "select id from npos where registration_number = 'VERIFY0001'"
    );
    expect(include).toBeGreaterThan(-1);
    expect(select).toBeGreaterThan(include);
    expect(seed).toContain("'Harbor Listing'");
    expect(seed).toContain("'f0000000-0000-4000-8000-000000000001'");
  });
});

describe("seed-preview-campaign.ts entry", () => {
  const script = join(import.meta.dirname, "seed-preview-campaign.ts");

  function run_script(extra: Record<string, string>) {
    // the child must not inherit a database url. ProcessEnv types those keys
    // as required, which is tighter than what spawn actually accepts.
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.DATABASE_URL;
    delete env.DATABASE_URL_UNPOOLED;
    delete env.VERCEL_ENV;
    return spawnSync(process.execPath, [script], {
      encoding: "utf8",
      timeout: 8_000,
      env: { ...env, ...extra } as NodeJS.ProcessEnv,
    });
  }

  test("exits 0 without connecting when VERCEL_ENV is production or unset", () => {
    const bogus = "postgresql://u:p@127.0.0.1:1/db";
    const production = run_script({
      VERCEL_ENV: "production",
      DATABASE_URL_UNPOOLED: bogus,
    });
    expect(production.status).toBe(0);
    const unset = run_script({ DATABASE_URL_UNPOOLED: bogus });
    expect(unset.status).toBe(0);
    const empty = run_script({ VERCEL_ENV: "", DATABASE_URL_UNPOOLED: bogus });
    expect(empty.status).toBe(0);
  });
});

describe("supporter fundraiser sql", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await create_test_db();
  }, 60_000);

  afterAll(async () => {
    await db?.client.close();
  });

  async function wipe() {
    await db.client.exec(
      `delete from fund_members where fund_id = '${FUND}';
       delete from funds where id = '${FUND}';
       delete from "user" where id = '${USER}';
       delete from npos where registration_number in ('VERIFY0001', 'VERIFY0003');`
    );
  }

  async function count(sql: string): Promise<number> {
    const result = await db.client.query<{ n: number }>(sql);
    return Number(result.rows[0]?.n);
  }

  function pg_session(): SeedSession {
    return {
      async connect() {},
      query: (text, params) => db.client.query(text, params),
      async end() {},
    };
  }

  test("inserts nothing and does not create nonprofits when neither fixture exists", async () => {
    await wipe();
    const sql = readFileSync(SUPPORTER_SQL, "utf8");
    const out = capture();
    const code = await seed_preview_campaign({
      vercel_env: "preview",
      url: DIRECT,
      sql,
      client: pg_session,
      log: out.log,
    });
    expect(code).toBe(0);
    expect(out.lines).toEqual([NEITHER]);
    expect(
      await count(`select count(*)::int as n from "user" where id = '${USER}'`)
    ).toBe(0);
    expect(
      await count(`select count(*)::int as n from funds where id = '${FUND}'`)
    ).toBe(0);
    expect(
      await count(
        `select count(*)::int as n from npos where registration_number in ('VERIFY0001', 'VERIFY0003')`
      )
    ).toBe(0);
  });

  test("seeds Neighborhood Drive for both fixture nonprofits, and a second run is a no-op", async () => {
    await wipe();
    const verify1 = await seed_npo_sql(db.client, "VERIFY0001");
    const verify3 = await seed_npo_sql(db.client, "VERIFY0003");
    const npos = await count("select count(*)::int as n from npos");
    const sql = readFileSync(SUPPORTER_SQL, "utf8");

    await db.client.exec(sql);
    await db.client.exec(sql);

    const fund = await db.client.query<{
      name: string;
      slug: string;
      featured: boolean;
      active: boolean;
      npo_owner: number | null;
      creator_id: string;
      banner: string;
      logo: string;
      description_pt: string;
    }>(
      `select name, slug, featured, active, npo_owner, creator_id, banner, logo, description_pt
         from funds where id = $1`,
      [FUND]
    );
    expect(fund.rows).toHaveLength(1);
    expect(fund.rows[0]).toMatchObject({
      name: "Neighborhood Drive",
      slug: "neighborhood-drive",
      featured: true,
      active: true,
      npo_owner: null,
      creator_id: USER,
      banner: "/logo.png",
      logo: "/logo.png",
    });
    expect(JSON.parse(fund.rows[0]?.description_pt ?? "null")).toEqual([
      {
        _key: "n1",
        _type: "block",
        style: "normal",
        markDefs: [],
        children: [
          {
            _key: "n2",
            _type: "span",
            text: "A neighborhood drive started by a supporter.",
            marks: [],
          },
        ],
      },
    ]);

    const user = await db.client.query(
      `select name, email, email_verified, first_name, last_name from "user" where id = $1`,
      [USER]
    );
    expect(user.rows).toEqual([
      {
        name: "Supporter Neighbor",
        email: "verify-supporter@example.com",
        email_verified: true,
        first_name: "Supporter",
        last_name: "Neighbor",
      },
    ]);

    const members = await db.client.query<{ npo_id: number }>(
      `select npo_id from fund_members where fund_id = $1 order by npo_id`,
      [FUND]
    );
    expect(members.rows.map((row) => row.npo_id)).toEqual(
      [verify1, verify3].sort((a, b) => a - b)
    );
    expect(
      await count(
        `select count(*)::int as n from user_npo_memberships where user_id = '${USER}'`
      )
    ).toBe(0);
    expect(
      await count(
        `select count(*)::int as n from account where user_id = '${USER}'`
      )
    ).toBe(0);
    expect(await count("select count(*)::int as n from npos")).toBe(npos);
    expect(
      await count(`select count(*)::int as n from "user" where id = '${USER}'`)
    ).toBe(1);
    expect(
      await count(`select count(*)::int as n from funds where id = '${FUND}'`)
    ).toBe(1);

    const out = capture();
    const code = await seed_preview_campaign({
      vercel_env: "preview",
      url: DIRECT,
      sql,
      client: pg_session,
      log: out.log,
    });
    expect(code).toBe(0);
    expect(out.lines).toEqual([]);
    expect(
      await count(`select count(*)::int as n from "user" where id = '${USER}'`)
    ).toBe(1);
    expect(
      await count(`select count(*)::int as n from funds where id = '${FUND}'`)
    ).toBe(1);
    expect(
      await count(
        `select count(*)::int as n from fund_members where fund_id = '${FUND}'`
      )
    ).toBe(2);
    expect(await count("select count(*)::int as n from npos")).toBe(npos);
  });
});
