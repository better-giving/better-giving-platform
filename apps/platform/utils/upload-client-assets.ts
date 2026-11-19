import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { BlobNotFoundError, head, put } from "@vercel/blob";
import { AwsClient } from "aws4fetch";

// asset_base_url is expected to end in "/" (vite base convention).

// mirror content-hashed client assets to the deploy-independent store behind
// ASSET_BASE_URL so html cached from a rotated-out deployment can still load
// its assets (see vite.config.ts `base` + entry.server.tsx `durable_assets`).
// the base url picks the store: a vercel blob host (*.blob.vercel-storage.com)
// uploads to blob, any other base uploads to cloudflare r2 (S3 api, behind
// cloudflare's cache) and needs all four ASSETS_S3_* vars. the base is what the
// html points at, so the upload can never target a store the html doesn't read
// — preview/staging may carry the ASSETS_S3_* vars while their base is still
// blob, and those vars are then ignored. the cutover is the ASSET_BASE_URL
// flip, undone by the same.
//
// only build/client/assets/** is uploaded: every file there is content-hashed
// and immutable, so the upload is append-only and safe to skip when the name is
// already present (identical name implies identical bytes). public files
// (favicon, /icons/*) are referenced via literal origin paths, never get the
// asset base, and stay on the deployment — so they're intentionally excluded.
//
// .map sourcemaps are skipped: the build, when it emits them at all, emits
// them `"hidden"` (vite.config.ts), so no `sourceMappingURL` is written and a
// browser never fetches them — only sentry consumes them, and sentryOnBuildEnd
// already uploads them out-of-band. they're as numerous as the js chunks and
// larger, and churn on every content-hash change, so mirroring them is pure
// waste — the bulk of the per-deploy re-upload volume.
//
// blob path: reads BLOB_READ_WRITE_TOKEN from env (via @vercel/blob); the
// asset base url must point at the same blob store that token writes to.
// r2 path: the base url must be the custom domain in front of ASSETS_S3_BUCKET.
const BLOB_HOST = ".blob.vercel-storage.com";
const CONCURRENCY = 12;
const IMMUTABLE_MAX_AGE = 31_536_000; // 1y — hashed assets never change
const PROBE_TRIES = 5;
const PROBE_DELAY_MS = 2000;
const CACHE_CONTROL = `public, max-age=${IMMUTABLE_MAX_AGE}, immutable`;

const S3_KEYS = [
  "ASSETS_S3_ENDPOINT",
  "ASSETS_S3_BUCKET",
  "ASSETS_S3_ACCESS_KEY_ID",
  "ASSETS_S3_SECRET_ACCESS_KEY",
] as const;

// r2 stores whatever Content-Type the PUT carries, and browsers refuse module
// scripts served as octet-stream, so an extension missing here throws rather
// than ship with a guess. covers every extension vite emits into
// build/client/assets today.
const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".txt": "text/plain",
};

export function content_type(rel: string): string {
  const ext = path.extname(rel).toLowerCase();
  const type = CONTENT_TYPES[ext];
  if (!type) {
    throw new Error(
      `[upload-client-assets] no Content-Type for "${rel}" — add "${ext}" to CONTENT_TYPES`
    );
  }
  return type;
}

type Env = Record<string, string | undefined>;

type R2 = { client: AwsClient; endpoint: string; bucket: string };

function r2_from_env(env: Env): R2 {
  const missing = S3_KEYS.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[upload-client-assets] ASSET_BASE_URL is not a vercel blob host, so assets upload to R2 — missing ${missing.join(", ")}`
    );
  }
  return {
    client: new AwsClient({
      accessKeyId: env.ASSETS_S3_ACCESS_KEY_ID as string,
      secretAccessKey: env.ASSETS_S3_SECRET_ACCESS_KEY as string,
      service: "s3",
      region: "auto",
      // aws4fetch's default is 10 retries with doubling backoff (~50s); a
      // build is better off failing sooner.
      retries: 3,
    }),
    endpoint: (env.ASSETS_S3_ENDPOINT as string).replace(/\/+$/, ""),
    bucket: env.ASSETS_S3_BUCKET as string,
  };
}

export async function upload_client_assets(
  asset_base_url: string,
  opts: { dir?: string; env?: Env; probe_delay_ms?: number } = {}
) {
  const dir = opts.dir ?? path.resolve("build/client/assets");
  const env = opts.env ?? process.env;
  const is_blob = new URL(asset_base_url).hostname.endsWith(BLOB_HOST);
  if (is_blob && S3_KEYS.some((k) => env[k])) {
    console.log(
      "[upload-client-assets] ASSET_BASE_URL is a vercel blob host; ASSETS_S3_* ignored"
    );
  }
  const r2 = is_blob ? null : r2_from_env(env);
  const entries = await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  });
  const rel_paths = entries
    .filter((e) => e.isFile() && !e.name.endsWith(".map"))
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)));
  // fail on an unmapped extension before anything is uploaded
  if (r2) for (const rel of rel_paths) content_type(rel);

  const fresh: string[] = [];
  let uploaded = 0;
  let skipped = 0;
  for (let i = 0; i < rel_paths.length; i += CONCURRENCY) {
    await Promise.all(
      rel_paths.slice(i, i + CONCURRENCY).map(async (rel) => {
        const pathname = `assets/${rel.split(path.sep).join("/")}`;
        const did_upload = r2
          ? await put_r2(r2, pathname, path.join(dir, rel), rel)
          : await put_blob(asset_base_url, pathname, path.join(dir, rel));
        if (did_upload) {
          uploaded++;
          fresh.push(rel);
        } else skipped++;
      })
    );
  }
  if (r2) {
    await probe_base(
      asset_base_url,
      r2.bucket,
      dir,
      probe_rel(fresh.length ? fresh : rel_paths),
      opts.probe_delay_ms ?? PROBE_DELAY_MS
    );
  }
  console.log(
    `[upload-client-assets] ${r2 ? "r2" : "blob"}: ${uploaded} uploaded, ${skipped} already present`
  );
}

const probe_rel = (rel_paths: string[]) =>
  rel_paths.find((r) => /^entry\.client-.*\.js$/.test(path.basename(r))) ??
  rel_paths[0];

// the upload goes to the S3 endpoint and the html reads ASSET_BASE_URL; nothing
// ties the two together, so a wrong bucket (preview keys with the prod base, a
// typo) uploads fine and ships html whose every asset 404s. fetch one file back
// through the public base — status, content type and bytes — and throw so the
// previous deployment stays live. plain unsigned fetch: this is the url a
// browser uses. the file is one this run just PUT when any was (entry.client
// first — its name moves rarely, so it is a weak probe only when nothing else
// is new): a preview build pointed at the prod base would otherwise pass on an
// old prod file the base already serves. names are content-hashed, so a name
// this build introduces was never requested before and no cache can hold a
// stale 404 for it. retries cover a fresh custom domain that lags.
async function probe_base(
  base: string,
  bucket: string,
  dir: string,
  rel: string | undefined,
  delay_ms: number
) {
  if (!rel) return;
  const url = `${base}assets/${rel.split(path.sep).join("/")}`;
  const want_type = content_type(rel);
  const want = await readFile(path.join(dir, rel));
  let why = "";
  for (let i = 1; i <= PROBE_TRIES; i++) {
    try {
      const res = await fetch(url);
      const got_type = (res.headers.get("content-type") ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (res.status !== 200) why = `status ${res.status}`;
      else if (got_type !== want_type) {
        why = `content-type "${got_type}", expected "${want_type}"`;
      } else if (Buffer.compare(Buffer.from(await res.arrayBuffer()), want)) {
        why = "bytes differ from the uploaded file";
      } else return;
    } catch (err) {
      why = `fetch failed: ${err instanceof Error ? err.message : err}`;
    }
    if (i < PROBE_TRIES) await new Promise((r) => setTimeout(r, delay_ms));
  }
  throw new Error(
    `[upload-client-assets] ASSET_BASE_URL ${base} does not serve what was uploaded to R2 bucket "${bucket}": ${url} gave ${why} after ${PROBE_TRIES} tries`
  );
}

async function put_blob(base: string, pathname: string, file: string) {
  if (await blob_exists(`${base}${pathname}`)) return false;
  await put(pathname, await readFile(file), {
    access: "public",
    addRandomSuffix: false,
    // concurrent deploys may upload the same new (hashed) file; bytes are
    // identical so overwrite is harmless and avoids a race failure.
    allowOverwrite: true,
    cacheControlMaxAge: IMMUTABLE_MAX_AGE,
  });
  return true;
}

async function put_r2(r2: R2, key: string, file: string, rel: string) {
  const url = `${r2.endpoint}/${r2.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const probe = await r2.client.fetch(url, { method: "HEAD" });
  if (probe.ok) return false;
  if (probe.status !== 404) {
    throw new Error(
      `[upload-client-assets] HEAD ${key} answered ${probe.status}`
    );
  }
  const res = await r2.client.fetch(url, {
    method: "PUT",
    body: await readFile(file),
    headers: {
      "Content-Type": content_type(rel),
      "Cache-Control": CACHE_CONTROL,
    },
  });
  if (!res.ok) {
    throw new Error(`[upload-client-assets] PUT ${key} answered ${res.status}`);
  }
  return true;
}

async function blob_exists(url: string): Promise<boolean> {
  try {
    await head(url);
    return true;
  } catch (err) {
    if (err instanceof BlobNotFoundError) return false;
    throw err;
  }
}
