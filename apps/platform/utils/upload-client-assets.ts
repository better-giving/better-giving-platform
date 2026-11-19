import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { BlobNotFoundError, head, put } from "@vercel/blob";
import { AwsClient } from "aws4fetch";

// asset_base_url is expected to end in "/" (vite base convention).

// mirror content-hashed client assets to the deploy-independent store behind
// ASSET_BASE_URL so html cached from a rotated-out deployment can still load
// its assets (see vite.config.ts `base` + entry.server.tsx skew-protection note).
// the base url picks the store: a vercel blob host (*.blob.vercel-storage.com)
// uploads to blob, any other base uploads to cloudflare r2 (S3 api, behind
// cloudflare's cache) and needs all four ASSETS_S3_* vars. the base is what the
// html points at, so the upload can never target a store the html doesn't read
// — preview/staging may carry the ASSETS_S3_* vars while their base is still
// blob, and those vars are then ignored.
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
// than ship with a guess.
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
    const delay = opts.probe_delay_ms ?? PROBE_DELAY_MS;
    await probe_sentinel(r2, asset_base_url, delay);
    await probe_asset(
      r2,
      asset_base_url,
      dir,
      probe_rel(fresh.length ? fresh : rel_paths),
      app_origin(env),
      delay
    );
  }
  console.log(
    `[upload-client-assets] ${r2 ? "r2" : "blob"}: ${uploaded} uploaded, ${skipped} already present`
  );
}

const probe_rel = (rel_paths: string[]) =>
  rel_paths.find((r) => /^entry\.client-.*\.js$/.test(path.basename(r))) ??
  rel_paths[0];

// the origin a browser sends for the app's own pages; BASE_URL is the app url.
const app_origin = (env: Env) => {
  try {
    return new URL(env.BASE_URL ?? "").origin;
  } catch {
    return "https://better.giving";
  }
};

const object_url = (r2: R2, key: string) =>
  `${r2.endpoint}/${r2.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

// run `check` up to PROBE_TRIES times; it returns null on success or why not.
async function with_retries(
  check: () => Promise<string | null>,
  delay_ms: number
): Promise<string | null> {
  let why: string | null = "";
  for (let i = 1; i <= PROBE_TRIES; i++) {
    try {
      why = await check();
    } catch (err) {
      why = `fetch failed: ${err instanceof Error ? err.message : err}`;
    }
    if (why === null) return null;
    if (i < PROBE_TRIES) await new Promise((r) => setTimeout(r, delay_ms));
  }
  return why;
}

const probe_error = (r2: R2, base: string, url: string, why: string) =>
  new Error(
    `[upload-client-assets] ASSET_BASE_URL ${base} does not serve what was uploaded to R2 bucket "${r2.bucket}": ${url} gave ${why} after ${PROBE_TRIES} tries`
  );

// the upload goes to the S3 endpoint and the html reads ASSET_BASE_URL;
// nothing ties the two together, so a wrong bucket (preview keys with the prod
// base, a typo) uploads fine and ships html whose every asset 404s. a real
// asset can't prove they are the same store: on a retry or a rebuild every
// HEAD succeeds in the wrong bucket, and the only file left to probe is one
// the base already serves from the right one. so each run PUTs a unique
// sentinel through the signed client, reads it back through the public base,
// then deletes it. it lives under assets/_probe/, which no html references and
// no hashed name can collide with (vite never emits `_probe`, and the name
// carries a timestamp and random suffix). a fresh name is never cached, so
// retries only wait out a custom domain that lags. the read is a plain
// unsigned fetch: it is the url a browser uses.
async function probe_sentinel(r2: R2, base: string, delay_ms: number) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const key = `assets/_probe/${id}.txt`;
  const put_res = await r2.client.fetch(object_url(r2, key), {
    method: "PUT",
    body: id,
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
  if (!put_res.ok) {
    throw new Error(
      `[upload-client-assets] PUT ${key} answered ${put_res.status}`
    );
  }
  const url = `${base}${key}`;
  const why = await with_retries(async () => {
    const res = await fetch(url);
    if (res.status !== 200) return `status ${res.status}`;
    return (await res.text()) === id ? null : "a different body";
  }, delay_ms);
  try {
    const del = await r2.client.fetch(object_url(r2, key), {
      method: "DELETE",
    });
    if (!del.ok) {
      console.log(
        `[upload-client-assets] DELETE ${key} answered ${del.status}`
      );
    }
  } catch (err) {
    console.log(`[upload-client-assets] DELETE ${key} failed: ${err}`);
  }
  if (why !== null) throw probe_error(r2, base, url, why);
}

// then one real asset, through the public base, for what the sentinel can't
// show: content type, bytes and CORS. the file comes from those this run just
// PUT (from all of them when none were), entry.client first. names are
// content-hashed, so a name this build introduces was never requested before
// and no cache holds a stale 404 for it.
//
// module scripts and fonts are cors requests, and r2 sends no
// access-control-allow-origin until the bucket has a CORS policy, so a missing
// header is a dead site. the policy must answer exactly "*", not echo an
// origin: the fonts are also fetched from inside Stripe's iframe, and previews
// get a new host per deployment.
async function probe_asset(
  r2: R2,
  base: string,
  dir: string,
  rel: string | undefined,
  origin: string,
  delay_ms: number
) {
  if (!rel) return;
  const url = `${base}assets/${rel.split(path.sep).join("/")}`;
  const want_type = content_type(rel);
  const want = await readFile(path.join(dir, rel));
  const why = await with_retries(async () => {
    const res = await fetch(url, { headers: { Origin: origin } });
    const got_type = (res.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const acao = res.headers.get("access-control-allow-origin");
    if (res.status !== 200) return `status ${res.status}`;
    if (got_type !== want_type) {
      return `content-type "${got_type}", expected "${want_type}"`;
    }
    if (acao !== "*") {
      return `access-control-allow-origin ${acao ? `"${acao}"` : "missing"} for Origin ${origin}; the bucket CORS policy must allow "*"`;
    }
    if (Buffer.compare(Buffer.from(await res.arrayBuffer()), want)) {
      return "bytes differ from the uploaded file";
    }
    return null;
  }, delay_ms);
  if (why !== null) throw probe_error(r2, base, url, why);
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
  const url = object_url(r2, key);
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
