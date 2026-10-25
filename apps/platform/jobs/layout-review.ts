import { parseArgs } from "node:util";
import { and, asc, eq } from "drizzle-orm";
import { to_text } from "#/components/rich-text/helpers";
import { org_href } from "#/helpers/org-href";
import { extract_youtube_id } from "#/components/youtube-player";
import { fund_item_is_open } from "@/campaign/is-open";
import {
  type IOrgShape,
  items_total,
  type TOrgLayout,
  threshold_layout,
} from "@/org-shape";
import { npos } from "$/pg/schema/npo";

/**
 * the layout review list: each published, active org's measures, the layout
 * the thresholds give, the one Jev gives, and its page link — as csv, failed
 * reads first, then Jev and the thresholds disagreeing. `--help` has the flags.
 *
 * read-only, and reads whichever database the loaded env points at, so name
 * the env file: `bun --env-file=.env.staging jobs/layout-review.ts`. the shell
 * beats the file, so a stale `export DATABASE_URL` wins — the db host and the
 * link origin go to stderr first for that reason.
 *
 * Jev is asked through `pick_layout`, the page's own call with the page's
 * timeout, so an empty `jev` is what the page would get too: no key, a
 * timeout or an error, and the thresholds deciding.
 *
 * the modules that reach the db or the gateway read the app env as they load,
 * so they are imported only after the arguments parse: `--help` and a usage
 * error need no env file.
 */

/** orgs measured and put to Jev at once; low, so the gateway's rate limit
 * isn't hammered */
const JEV_CONCURRENCY = 4;

interface IOrgRef {
  id: number;
  name: string;
  link: string;
}

export interface IReviewRow extends IOrgRef, IOrgShape {
  items_total: number;
  threshold: TOrgLayout;
  /** null when Jev gave no answer (no key, timeout, error) */
  jev: TOrgLayout | null;
  error: null;
}

/** an org whose reads failed: no measures, and why */
export interface IFailedRow extends IOrgRef {
  error: string;
}

export type TRow = IReviewRow | IFailedRow;

type TOrg = Pick<
  typeof npos.$inferSelect,
  "id" | "slug" | "name" | "overview_pt" | "tagline" | "image" | "logo"
>;

/** the modules that read the app env as they load */
async function load_server() {
  const [db, campaign, funds, program, media, page, layout] = await Promise.all(
    [
      import("$/pg/db"),
      import("$/pg/queries/campaign"),
      import("#/.server/funds"),
      import("$/pg/queries/program"),
      import("$/pg/queries/npo-media"),
      import("#/routes/org.$org._index/api"),
      import("$/org-layout"),
    ]
  );
  return {
    db: db.db,
    campaign_live_for_npo: campaign.campaign_live_for_npo,
    get_funds_npo_memberof: funds.get_funds_npo_memberof,
    npo_programs: program.npo_programs,
    npo_media_list: media.npo_media_list,
    MAX_VIDEOS: page.MAX_VIDEOS,
    pick_layout: layout.pick_layout,
  };
}

type TServer = Awaited<ReturnType<typeof load_server>>;

/** the measures `org.$org._index/api.ts` builds for the page, from the same
 * reads; a failed read throws here, where the page would count it as 0 */
async function org_shape(
  npo: TOrg,
  now: Date,
  {
    campaign_live_for_npo,
    get_funds_npo_memberof,
    npo_programs,
    npo_media_list,
    MAX_VIDEOS,
  }: TServer
): Promise<IOrgShape> {
  const [campaigns, funds, programs, media] = await Promise.all([
    campaign_live_for_npo(npo.id),
    get_funds_npo_memberof(npo.id, { published: true }),
    npo_programs(npo.id),
    npo_media_list(npo.id, {
      type: "video",
      featured: true,
      limit: MAX_VIDEOS,
    }),
  ]);
  return {
    story_chars: to_text(npo.overview_pt).trim().length,
    tagline_chars: npo.tagline?.trim().length ?? 0,
    name_chars: npo.name.trim().length,
    has_banner: !!npo.image,
    has_logo: !!npo.logo,
    campaigns: campaigns.length,
    fundraisers: funds.filter((f) => fund_item_is_open(f, now)).length,
    programs: programs.length,
    // the page plays YouTube links only, so it counts only those
    videos: media.items.filter((m) => extract_youtube_id(m.url)).length,
  };
}

interface IRunCtx {
  origin: string;
  now: Date;
  jev: boolean;
  server: TServer;
}

async function review_row(npo: TOrg, ctx: IRunCtx): Promise<TRow> {
  const ref = {
    id: npo.id,
    name: npo.name,
    link: `${ctx.origin}${org_href(npo)}`,
  };
  try {
    const shape = await org_shape(npo, ctx.now, ctx.server);
    const pick = ctx.jev ? await ctx.server.pick_layout(shape) : null;
    return {
      ...ref,
      ...shape,
      items_total: items_total(shape),
      threshold: threshold_layout(shape),
      jev: pick?.by === "jev" ? pick.layout : null,
      error: null,
    };
  } catch (err) {
    return { ...ref, error: describe(err) };
  }
}

/** fetch puts the network reason (ECONNREFUSED, a timeout) in `cause` */
const describe = (err: unknown): string => {
  const e = err as { message?: unknown; cause?: unknown } | null;
  const cause = e?.cause ? ` (${e.cause})` : "";
  return `${e?.message ?? err}${cause}`;
};

/** the key's value in `.env.example` */
const PLACEHOLDER_KEY = "placeholder";

export const jev_enabled = (key: string | undefined): boolean =>
  !!key && key !== PLACEHOLDER_KEY;

/** every published, active org with its measures and both layout picks — or,
 * for an org whose reads failed, the error. failures first, then the orgs
 * where Jev and the thresholds disagree, then the rest, each by name. */
export async function review_rows(opts: {
  origin: string;
  limit?: number;
  /** false: ask Jev nothing, every `jev` null */
  jev: boolean;
}): Promise<TRow[]> {
  const server = await load_server();
  const q = server.db
    .select({
      id: npos.id,
      slug: npos.slug,
      name: npos.name,
      overview_pt: npos.overview_pt,
      tagline: npos.tagline,
      image: npos.image,
      logo: npos.logo,
    })
    .from(npos)
    .where(and(eq(npos.published, true), eq(npos.active, true)))
    .orderBy(asc(npos.name), asc(npos.id));
  const orgs = await (opts.limit ? q.limit(opts.limit) : q);

  const ctx = { origin: opts.origin, now: new Date(), jev: opts.jev, server };
  // by index, so the rows keep the query's order whatever finishes first
  const rows = new Array<TRow>(orgs.length);
  let next = 0;
  const worker = async () => {
    while (next < orgs.length) {
      const i = next++;
      rows[i] = await review_row(orgs[i]!, ctx);
    }
  };
  await Promise.all(Array.from({ length: JEV_CONCURRENCY }, worker));
  // stable, so each group keeps the query's name order
  return rows.sort((a, b) => rank(a) - rank(b));
}

const rank = (r: TRow): number => (r.error !== null ? 0 : disagrees(r) ? 1 : 2);

const disagrees = (r: TRow): boolean =>
  r.error === null && r.jev !== null && r.jev !== r.threshold;

const COLUMNS = [
  "id",
  "name",
  "link",
  "story_chars",
  "tagline_chars",
  "name_chars",
  "has_banner",
  "has_logo",
  "campaigns",
  "fundraisers",
  "programs",
  "videos",
  "items_total",
  "threshold",
  "jev",
  "agree",
  "error",
] as const satisfies readonly (keyof IReviewRow | "agree")[];

/** rfc 4180, plus a leading `'` on a cell a spreadsheet would read as a
 * formula: names are whatever an org typed */
const cell = (v: string | number | boolean | null): string => {
  const s = String(v ?? "");
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export function to_csv(rows: TRow[]): string {
  const lines = rows.map((r) => {
    if (r.error !== null) {
      return COLUMNS.map((c) =>
        cell(c in r ? r[c as keyof IFailedRow] : null)
      ).join(",");
    }
    const agree = r.jev === null ? null : !disagrees(r);
    return COLUMNS.map((c) => cell(c === "agree" ? agree : r[c])).join(",");
  });
  return `${[COLUMNS.join(","), ...lines].join("\n")}\n`;
}

/** the stderr summary, and the exit code the run earns: 1 when an org failed
 * to read, or when Jev, with a key to ask with, answered none */
export function summarize(
  rows: TRow[],
  jev: boolean
): { lines: string[]; code: 0 | 1 } {
  const failed = rows.filter((r) => r.error !== null).length;
  const disagree = rows.filter(disagrees).length;
  const unanswered = rows.filter(
    (r) => r.error === null && r.jev === null
  ).length;
  const measured = rows.length - failed;
  const counts = [
    `${rows.length} orgs`,
    `${disagree} disagree`,
    `${measured - disagree - unanswered} agree`,
    `${unanswered} with no answer from Jev`,
    ...(failed ? [`${failed} failed`] : []),
  ];
  const lines = [`layout-review: ${counts.join(" · ")}`];
  if (failed) {
    lines.push(
      `layout-review: ${failed} ${failed === 1 ? "org" : "orgs"} failed to read; their error column says why`
    );
  }
  const jev_silent = jev && measured > 0 && unanswered === measured;
  if (jev_silent) {
    lines.push(
      `layout-review: Jev answered none of ${measured} orgs with a key set — check AI_GATEWAY_API_KEY`
    );
  }
  return { lines, code: failed || jev_silent ? 1 : 0 };
}

const USAGE = `usage: bun --env-file=<env file> jobs/layout-review.ts [--origin=<url>] [--limit=<n>]

  writes a csv to stdout: every published, active org with its measures, the
  threshold layout and Jev's — failed reads first, then disagreements, then by
  name. a summary goes to stderr. read-only; reads whichever database the
  loaded env points at. exits 1 when an org failed to read or Jev, with a key
  set, answered none; 2 on a usage error.

  --origin=<url>  origin for each row's page link (default: the env's BASE_URL)
  --limit=<n>     only the first n orgs by name, for a quick sample
  --help          this text
`;

export class UsageError extends Error {
  override name = "UsageError";
}

/** no `origin`: the env's BASE_URL, read once the env is loaded */
export type TCli = { help: true } | { origin?: string; limit?: number };

export function parse_cli(argv: string[]): TCli {
  let values: { origin?: string; limit?: string; help?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        origin: { type: "string" },
        limit: { type: "string" },
        help: { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    // parseArgs' first sentence; its advice follows on the same line or the next
    throw new UsageError(String((err as Error).message).split(/\.\s/)[0]!);
  }
  if (values.help) return { help: true };

  const cli: TCli = {};
  if (values.origin !== undefined) {
    const origin = URL.parse(values.origin);
    if (!origin || !/^https?:$/.test(origin.protocol)) {
      throw new UsageError("--origin must be an http(s) url");
    }
    cli.origin = origin.origin;
  }
  if (values.limit !== undefined) {
    // digits only: Number() also takes 1e2, 0x10, " 7" and 7.0
    const limit = /^\d+$/.test(values.limit) ? Number(values.limit) : 0;
    if (limit < 1)
      throw new UsageError("--limit must be a whole number above 0");
    cli.limit = limit;
  }
  return cli;
}

async function main(): Promise<number> {
  let cli: TCli;
  try {
    cli = parse_cli(process.argv.slice(2));
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`layout-review: ${err.message}`);
    console.error("Run 'bun jobs/layout-review.ts --help' for usage.");
    return 2;
  }
  if ("help" in cli) {
    process.stdout.write(USAGE);
    return 0;
  }

  const { ai_gateway, base_url, database } = await import("$/env");
  const origin = cli.origin ?? new URL(base_url).origin;
  const jev = jev_enabled(ai_gateway.api_key);
  const host = URL.parse(database.url ?? "")?.hostname || "(no DATABASE_URL)";
  console.error(`layout-review: reading ${host}, links on ${origin}`);
  if (!jev)
    console.error("layout-review: Jev disabled: no key — size rules only");

  const { db } = await import("$/pg/db");
  let rows: TRow[];
  try {
    rows = await review_rows({ origin, limit: cli.limit, jev });
  } finally {
    // the open pool would keep the process up once the csv is out
    await db.$client.end();
  }
  process.stdout.write(to_csv(rows));
  const { lines, code } = summarize(rows, jev);
  for (const line of lines) console.error(line);
  return code;
}

if (import.meta.main) {
  // a reader that stops early (`| head`) is not a failure
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  });
  // exitCode, never exit(): the process ends once stdout has drained, and
  // exit() cuts a piped csv at the pipe buffer
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`layout-review: ${describe(err)}`);
      process.exitCode = 1;
    });
}
