import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { seed_fund } from "#/__tests__/fixtures/funds";
import { user } from "$/pg/schema/auth";
import { campaigns } from "$/pg/schema/campaign";
import { npo_media, npos } from "$/pg/schema/npo";
import { programs } from "$/pg/schema/program";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

vi.mock("$/pg/db", () => ({
  db: new Proxy(
    {},
    {
      get(_, prop) {
        const real = test_db.current?.db;
        if (!real) throw new Error("test_db not initialized");
        return (real as any)[prop];
      },
    }
  ),
}));

// .env.test carries a gateway key, so an unmocked pick would call the real gateway
const jev_choice = vi.hoisted(() =>
  vi.fn(async (_state: Record<string, unknown>) => null as string | null)
);
vi.mock("$/jev", () => ({ jev_choice }));

// one org's fund read fails when its id is named here
const fail_funds_for = vi.hoisted(() => ({ id: null as number | null }));
vi.mock("#/.server/funds", async (real: () => Promise<object>) => {
  const mod = (await real()) as typeof import("#/.server/funds");
  return {
    ...mod,
    get_funds_npo_memberof: async (
      ...args: Parameters<typeof mod.get_funds_npo_memberof>
    ) => {
      if (args[0] === fail_funds_for.id) {
        throw new Error("fetch failed", { cause: new Error("ECONNRESET") });
      }
      return mod.get_funds_npo_memberof(...args);
    },
  };
});

const { jev_enabled, parse_cli, review_rows, summarize, to_csv } = await import(
  "./layout-review"
);
const { create_test_db } = await import("$/pg/test-utils/pglite");

const ORIGIN = "https://staging.example";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

// each test reads every published org, so each starts from none
beforeEach(async () => {
  await test_db.current!.client.exec("truncate npos cascade");
  jev_choice.mockReset().mockResolvedValue(null);
  fail_funds_for.id = null;
});

const db = () => test_db.current!.db;
let counter = 0;

async function seed_npo(overrides: Partial<typeof npos.$inferInsert> = {}) {
  counter++;
  const [row] = await db()
    .insert(npos)
    .values({
      registration_number: `EIN-REVIEW-${counter}`,
      name: `Review Org ${counter}`,
      slug: `review-org-${counter}`,
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      published: true,
      ...overrides,
    })
    .returning();
  return row!;
}

async function seed_creator() {
  counter++;
  const [row] = await db()
    .insert(user)
    .values({
      id: `review-creator-${counter}`,
      name: "Cam Creator",
      email: `review-creator-${counter}@example.com`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      first_name: "Cam",
      last_name: "Creator",
    })
    .returning();
  return row!;
}

/** portable text with one block per paragraph */
const pt = (...paras: string[]) =>
  JSON.stringify(
    paras.map((text, i) => ({
      _type: "block",
      _key: `b${i}`,
      style: "normal",
      markDefs: [],
      children: [{ _type: "span", _key: `s${i}`, text, marks: [] }],
    }))
  );

async function seed_campaign(owner_npo_id: number, id: string) {
  const creator = await seed_creator();
  await db()
    .insert(campaigns)
    .values({
      id,
      owner_npo_id,
      creator_id: creator.id,
      name: `Campaign ${id}`,
      slug: id,
      status: "live",
      description_pt: "[]",
    });
}

describe("layout review rows", () => {
  it("measures each published, active org as its page does, with no Jev column when Jev gives no answer", async () => {
    const npo = await seed_npo({
      name: " Shape Org ",
      tagline: "  Water first ",
      // "We dig wells.\n\nAnd schools." as plain text, once trimmed
      overview_pt: pt("  We dig wells.", "And schools.  "),
      image: "https://img/banner.png",
      logo: null,
    });
    await seed_npo({ name: "Hidden Org", published: false });
    await seed_npo({ name: "Closed Org", active: false });
    await seed_campaign(npo.id, "review-cmp-1");
    await seed_campaign(npo.id, "review-cmp-2");
    const creator = await seed_creator();
    const fund = { npo_owner: npo.id, creator_id: creator.id, published: true };
    await seed_fund(db(), { ...fund, id: "review-fund-open" });
    await seed_fund(db(), { ...fund, id: "review-fund-off", active: false });
    await seed_fund(db(), {
      ...fund,
      id: "review-fund-ended",
      expiration: "2020-01-01T00:00:00.000Z",
    });
    await db().insert(programs).values({
      id: "review-prog",
      npo_id: npo.id,
      title: "Wells",
      description_pt: "[]",
    });
    await db()
      .insert(npo_media)
      .values(
        [
          // the page lists featured videos only, and plays YouTube links only
          { id: "review-v1", url: "https://youtu.be/review-v1xx", featured: true },
          { id: "review-v2", url: "https://youtu.be/review-v2xx", featured: true },
          { id: "review-v3", url: "https://youtu.be/review-v3xx", featured: false },
          { id: "review-v4", url: "https://vimeo.com/123456789", featured: true },
        ].map((v) => ({ ...v, npo_id: npo.id, type: "video" as const }))
      );

    const rows = await review_rows({ origin: ORIGIN, jev: true });

    expect(rows).toEqual([
      {
        id: npo.id,
        name: " Shape Org ",
        link: `${ORIGIN}/org/${npo.slug}`,
        story_chars: 27,
        tagline_chars: 11,
        name_chars: 9,
        has_banner: true,
        has_logo: false,
        campaigns: 2,
        supporters: 1,
        programs: 1,
        videos: 2,
        items_total: 6,
        threshold: "hub",
        jev: null,
        error: null,
      },
    ]);
  });

  it("puts the orgs where Jev and the thresholds disagree first, then the rest by name", async () => {
    // no story and no items: the thresholds say card for all three
    await seed_npo({ name: "Bravo Org" });
    await seed_npo({ name: "Charlie Group" });
    await seed_npo({ name: "Alpha" });
    // Jev sees measures only, so the name's length tells the orgs apart
    const by_name_chars: Record<number, string | null> = {
      5: null,
      9: "card",
      13: "letter",
    };
    jev_choice.mockImplementation(
      async (state) => by_name_chars[state.name_chars as number]!
    );

    const rows = await review_rows({ origin: ORIGIN, jev: true });

    expect(rows).toMatchObject([
      { name: "Charlie Group", threshold: "card", jev: "letter" },
      { name: "Alpha", threshold: "card", jev: null },
      { name: "Bravo Org", threshold: "card", jev: "card" },
    ]);
  });

  it("asks Jev about at most four orgs at once", async () => {
    // distinct shapes: Jev's answers are kept per shape
    for (let i = 0; i < 7; i++) await seed_npo({ name: "Q".repeat(30 + i) });
    let in_flight = 0;
    let peak = 0;
    jev_choice.mockImplementation(async () => {
      peak = Math.max(peak, ++in_flight);
      await new Promise((r) => setTimeout(r, 20));
      in_flight--;
      return "poster";
    });

    const rows = await review_rows({ origin: ORIGIN, jev: true });

    expect(rows).toHaveLength(7);
    expect(peak).toBe(4);
  });

  it("reads only the first orgs by name with a limit", async () => {
    await seed_npo({ name: "Bravo Org" });
    await seed_npo({ name: "Alpha" });
    await seed_npo({ name: "Charlie Group" });

    const rows = await review_rows({ origin: ORIGIN, limit: 2, jev: true });

    expect(rows.map((r) => r.name)).toEqual(["Alpha", "Bravo Org"]);
  });

  it("gives an org whose read failed a row with the error and no measures, first, and still measures the rest", async () => {
    await seed_npo({ name: "Alpha" });
    const broken = await seed_npo({ name: "Bravo Org" });
    fail_funds_for.id = broken.id;

    const rows = await review_rows({ origin: ORIGIN, jev: true });

    expect(rows).toEqual([
      {
        id: broken.id,
        name: "Bravo Org",
        link: `${ORIGIN}/org/${broken.slug}`,
        error: "fetch failed (Error: ECONNRESET)",
      },
      expect.objectContaining({
        name: "Alpha",
        threshold: "card",
        error: null,
      }),
    ]);
  });

  it("asks Jev nothing when it is disabled", async () => {
    await seed_npo();
    jev_choice.mockResolvedValue("poster");

    const rows = await review_rows({ origin: ORIGIN, jev: false });

    expect(rows.map((r) => "jev" in r && r.jev)).toEqual([null]);
    expect(jev_choice).not.toHaveBeenCalled();
  });
});

describe("layout review jev key", () => {
  it.each([
    [undefined, false],
    ["", false],
    // what .env.example ships
    ["placeholder", false],
    ["vck_real", true],
  ])("treats %j as Jev enabled: %s", (key, enabled) => {
    expect(jev_enabled(key)).toBe(enabled);
  });
});

describe("layout review csv", () => {
  const row = {
    id: 7,
    name: 'Wells, "Water" & Co',
    link: `${ORIGIN}/org/wells`,
    story_chars: 400,
    tagline_chars: 0,
    name_chars: 19,
    has_banner: false,
    has_logo: true,
    campaigns: 1,
    supporters: 0,
    programs: 2,
    videos: 0,
    items_total: 3,
    threshold: "letter",
    jev: "poster",
    error: null,
  } as const;

  it("writes one header line and one quoted line per org, agree left blank without a Jev answer", () => {
    const csv = to_csv([
      row,
      { ...row, id: 8, name: "=HYPERLINK(1)", jev: null },
      { ...row, id: 9, name: "Same", jev: "letter" },
    ]);

    expect(csv).toBe(
      [
        "id,name,link,story_chars,tagline_chars,name_chars,has_banner,has_logo,campaigns,supporters,programs,videos,items_total,threshold,jev,agree,error",
        `7,"Wells, ""Water"" & Co",${ORIGIN}/org/wells,400,0,19,false,true,1,0,2,0,3,letter,poster,false,`,
        // a spreadsheet would run a name that opens like a formula
        `8,'=HYPERLINK(1),${ORIGIN}/org/wells,400,0,19,false,true,1,0,2,0,3,letter,,,`,
        `9,Same,${ORIGIN}/org/wells,400,0,19,false,true,1,0,2,0,3,letter,letter,true,`,
        "",
      ].join("\n")
    );
  });

  it("leaves a failed org's measures blank and puts its error last", () => {
    const csv = to_csv([
      {
        id: 7,
        name: "Wells",
        link: `${ORIGIN}/org/wells`,
        error: "boom, again",
      },
    ]);

    expect(csv.split("\n")[1]).toBe(
      `7,Wells,${ORIGIN}/org/wells,,,,,,,,,,,,,,"boom, again"`
    );
  });
});

describe("layout review summary", () => {
  const ok = (jev: "card" | null) =>
    ({
      id: 1,
      name: "A",
      link: `${ORIGIN}/org/a`,
      story_chars: 0,
      tagline_chars: 0,
      name_chars: 1,
      has_banner: false,
      has_logo: false,
      campaigns: 0,
      supporters: 0,
      programs: 0,
      videos: 0,
      items_total: 0,
      threshold: "card",
      jev,
      error: null,
    }) as const;
  const failed = { id: 2, name: "B", link: `${ORIGIN}/org/b`, error: "x" };

  it("counts the picks and exits 0 when Jev answered", () => {
    expect(summarize([ok("card"), ok(null)], true)).toEqual({
      lines: [
        "layout-review: 2 orgs · 0 disagree · 1 agree · 1 with no answer from Jev",
      ],
      code: 0,
    });
  });

  it("exits 1 with the count when any org failed, the rest still counted", () => {
    expect(summarize([ok("card"), failed, failed], true)).toEqual({
      lines: [
        "layout-review: 3 orgs · 0 disagree · 1 agree · 0 with no answer from Jev · 2 failed",
        "layout-review: 2 orgs failed to read; their error column says why",
      ],
      code: 1,
    });
  });

  it("exits 1 when Jev answered none of the orgs with a key set", () => {
    expect(summarize([ok(null), ok(null)], true)).toEqual({
      lines: [
        "layout-review: 2 orgs · 0 disagree · 0 agree · 2 with no answer from Jev",
        "layout-review: Jev answered none of 2 orgs with a key set — check AI_GATEWAY_API_KEY",
      ],
      code: 1,
    });
  });

  it("exits 0 with no Jev answers when Jev was disabled", () => {
    expect(summarize([ok(null)], false).code).toBe(0);
  });
});

describe("layout review arguments", () => {
  it("leaves the origin to the env unless --origin names one, reduced to its origin", () => {
    expect(parse_cli([])).toEqual({});
    expect(
      parse_cli(["--origin=https://staging.example/x/", "--limit=25"])
    ).toEqual({ origin: "https://staging.example", limit: 25 });
  });

  it.each([
    [["--limit=0"], "--limit must be a whole number above 0"],
    [["--limit=ten"], "--limit must be a whole number above 0"],
    [["--limit=1e2"], "--limit must be a whole number above 0"],
    [["--limit=0x10"], "--limit must be a whole number above 0"],
    [["--limit= 7"], "--limit must be a whole number above 0"],
    [["--limit=7.0"], "--limit must be a whole number above 0"],
    [["--origin=staging.example"], "--origin must be an http(s) url"],
    [["--bogus"], "Unknown option '--bogus'"],
    [["extra"], "Unexpected argument 'extra'"],
  ])("refuses %j as a usage error", (argv, message) => {
    expect(() => parse_cli(argv)).toThrow(
      expect.objectContaining({
        name: "UsageError",
        message: expect.stringContaining(message),
      })
    );
  });

  it("keeps a usage error to its first sentence", () => {
    expect(() => parse_cli(["--limit", "-5"])).toThrow(
      expect.objectContaining({
        message: "Option '--limit' argument is ambiguous",
      })
    );
  });

  it("asks for help", () => {
    expect(parse_cli(["--help"])).toEqual({ help: true });
  });
});

const has_bun = spawnSync("bun", ["--version"]).status === 0;
const PLATFORM = join(import.meta.dirname, "..");

interface IRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** the job as an operator runs it, its stdout piped into a separate reader
 * that starts `read_after_s` late — so the pipe fills, as under a slow
 * consumer. a node stream can't stand in: node drains a child's unread pipes
 * itself once the child exits. */
function run_job(
  args: string[],
  env: Record<string, string>,
  read_after_s = 0
): Promise<IRun> {
  const text = (stream: NodeJS.ReadableStream) =>
    new Promise<string>((done) => {
      let out = "";
      stream.on("data", (d) => (out += d));
      stream.on("end", () => done(out));
    });
  return new Promise((resolve, reject) => {
    const reader = spawn("sh", ["-c", `sleep ${read_after_s}; exec cat`], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    const job = spawn("bun", args, {
      cwd: PLATFORM,
      // no inherited env: what the job needs comes from args and `env`. the
      // cast: ProcessEnv is declared with the app's required keys
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        ...env,
      } as unknown as NodeJS.ProcessEnv,
      stdio: ["ignore", reader.stdin, "pipe"],
    });
    // the job holds its own end now; ours would keep the reader from seeing eof
    reader.stdin.destroy();
    const exited = new Promise<number | null>((done) => job.on("exit", done));
    job.on("error", reject);
    reader.on("error", reject);
    Promise.all([exited, text(reader.stdout), text(job.stderr!)])
      .then(([code, stdout, stderr]) => resolve({ code, stdout, stderr }))
      .catch(reject);
  });
}

/** stands in for the modules that reach Neon and the gateway, so the job runs
 * end to end with no network: `FAKE_ORGS` orgs, `FAKE_FAIL_ID`'s read throws,
 * `FAKE_JEV=answer` makes Jev answer */
const FAKES = `
import { plugin } from "bun";
const stub = (b, re, contents) =>
  b.onLoad({ filter: re }, () => ({ contents, loader: "js" }));
plugin({
  name: "layout-review-fakes",
  setup(b) {
    stub(b, /\\/\\.server\\/pg\\/db\\.ts$/, \`
      const orgs = Array.from({ length: Number(process.env.FAKE_ORGS) }, (_, i) => ({
        id: i + 1, slug: "org-" + (i + 1), name: "Org " + String(i + 1).padStart(4, "0") + " " + "x".repeat(150),
        overview_pt: "[]", tagline: null, image: null, logo: null,
      }));
      const q = {
        from: () => q, where: () => q, orderBy: () => q,
        limit: (n) => Promise.resolve(orgs.slice(0, n)),
        then: (ok, ko) => Promise.resolve(orgs).then(ok, ko),
      };
      export const db = { select: () => q, $client: { end: async () => console.error("fake: pool ended") } };
    \`);
    stub(b, /\\/\\.server\\/pg\\/queries\\/campaign\\.ts$/, \`
      export const campaign_live_for_npo = async (id) => {
        if (String(id) === process.env.FAKE_FAIL_ID) throw new Error("socket reset");
        return [];
      };
    \`);
    stub(b, /\\/\\.server\\/pg\\/queries\\/npo-media\\.ts$/, "export const npo_media_list = async () => ({ items: [] });");
    stub(b, /\\/\\.server\\/pg\\/queries\\/program\\.ts$/, "export const npo_programs = async () => [];");
    stub(b, /\\/src\\/\\.server\\/funds\\.ts$/, "export const get_funds_npo_memberof = async () => [];");
    stub(b, /\\/org\\.\\$org\\._index\\/api\\.ts$/, "export const MAX_VIDEOS = 3;");
    stub(b, /\\/\\.server\\/org-layout\\.ts$/, \`
      export const pick_layout = async () =>
        process.env.FAKE_JEV === "answer" ? { layout: "card", by: "jev" } : { layout: "card", by: "threshold" };
    \`);
  },
});
`;

describe.skipIf(!has_bun)("layout review as a bun process", () => {
  const dir = mkdtempSync(join(tmpdir(), "layout-review-"));
  const preload = join(dir, "fakes.ts");
  writeFileSync(preload, FAKES);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const faked = [
    "--env-file=.env.test",
    `--preload=${preload}`,
    "jobs/layout-review.ts",
  ];

  it("prints usage on stdout and exits 0 for --help, with no app env loaded", async () => {
    const r = await run_job(["jobs/layout-review.ts", "--help"], {});

    expect(r).toMatchObject({ code: 0, stderr: "" });
    expect(r.stdout).toMatch(/^usage: /);
  });

  it("exits 2 on an unknown flag with one line and a pointer on stderr, with no app env loaded", async () => {
    const r = await run_job(["jobs/layout-review.ts", "--bogus"], {});

    expect(r).toEqual({
      code: 2,
      stdout: "",
      stderr:
        "layout-review: Unknown option '--bogus'\nRun 'bun jobs/layout-review.ts --help' for usage.\n",
    });
  });

  it("delivers a csv past the pipe buffer whole to a slow reader, then closes the pool and exits", async () => {
    const r = await run_job(
      faked,
      { FAKE_ORGS: "3000", FAKE_JEV: "answer" },
      1
    );

    expect(r.code).toBe(0);
    const lines = r.stdout.split("\n");
    expect(r.stdout.length).toBeGreaterThan(64 * 1024);
    expect(lines).toHaveLength(3002);
    expect(lines[3000]).toMatch(/^3000,Org 3000 x+,/);
    expect(r.stderr).toContain("fake: pool ended");
  }, 30_000);

  it("still writes every row when one org's read fails, then exits 1 with the count", async () => {
    const r = await run_job(faked, {
      FAKE_ORGS: "3",
      FAKE_FAIL_ID: "2",
      FAKE_JEV: "answer",
    });

    expect(r.code).toBe(1);
    expect(r.stdout.split("\n")).toHaveLength(5);
    expect(r.stdout).toMatch(
      /\n2,Org 0002 x+,http:\/\/localhost:4200\/org\/org-2,{14}socket reset\n/
    );
    expect(r.stderr).toContain("layout-review: 1 org failed to read");
  }, 30_000);

  it("says once, before running, that Jev is disabled when the key is the placeholder", async () => {
    const r = await run_job(faked, {
      FAKE_ORGS: "2",
      AI_GATEWAY_API_KEY: "placeholder",
    });

    expect(r.code).toBe(0);
    expect(
      r.stderr.match(/Jev disabled: no key — size rules only/g)
    ).toHaveLength(1);
    expect(r.stderr.indexOf("Jev disabled")).toBeLessThan(
      r.stderr.indexOf(" orgs · ")
    );
  }, 30_000);

  it("exits 1 when a key is set and Jev answered no org", async () => {
    const r = await run_job(faked, {
      FAKE_ORGS: "2",
      AI_GATEWAY_API_KEY: "a-key-that-is-set",
    });

    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Jev answered none of 2 orgs with a key set");
    expect(r.stderr).not.toContain("Jev disabled");
  }, 30_000);

  it("exits 1 on an unreachable database, and does exit", async () => {
    const r = await run_job(["--env-file=.env.test", "jobs/layout-review.ts"], {
      DATABASE_URL: "postgresql://u:p@127.0.0.1:9/app",
    });

    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^layout-review: reading 127\.0\.0\.1/);
  }, 30_000);
});
