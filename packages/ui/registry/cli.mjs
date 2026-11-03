#!/usr/bin/env node
// bg-design: copies Better Giving design-system items (tokens, components)
// into your source tree. one file, zero dependencies, node 24.
//
//   node cli.mjs list
//   node cli.mjs add tokens button --dir src/ui
//   node cli.mjs diff button --dir src/ui
//
// the registry is a url (https://…/registry) or a local directory holding
// index.json and items/<name>.json. format: packages/ui/REGISTRY.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const DEFAULT_REGISTRY = "https://better.giving/registry";
const DEFAULT_DIR = "src/ui";
const SCHEMA_VERSION = 1;

const HELP = `bg-design — copy Better Giving design items into your source

usage:
  bg-design list
  bg-design add <item...> [--dir <target>] [--force]
  bg-design diff <item...> [--dir <target>]

options:
  --registry <url|dir>  registry base (default ${DEFAULT_REGISTRY}, or $BG_DESIGN_REGISTRY)
  --dir <target>        where files land (default ${DEFAULT_DIR}, or $BG_DESIGN_DIR)
  --force               overwrite files that already exist
  -h, --help            show this text
`;

class UserError extends Error {}

async function load(registry, path) {
  if (/^https?:\/\//.test(registry)) {
    const url = `${registry.replace(/\/+$/, "")}/${path}`;
    const res = await fetch(url);
    if (!res.ok) throw new UserError(`GET ${url} → ${res.status}`);
    return res.json();
  }
  const file = join(resolve(registry), path);
  if (!existsSync(file)) throw new UserError(`no such registry file: ${file}`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function check_schema(doc, where) {
  if (doc.schemaVersion !== SCHEMA_VERSION)
    throw new UserError(
      `${where} uses registry schema ${doc.schemaVersion}; this bg-design reads ${SCHEMA_VERSION}. fetch a newer cli from the registry (/registry/cli.mjs)`
    );
}

/** the item plus every registry dependency, dependencies first. */
async function resolve_items(registry, names) {
  const index = await load(registry, "index.json");
  check_schema(index, "index.json");
  const known = new Set(index.items.map((i) => i.name));
  const order = [];
  const seen = new Set();
  const visit = async (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    if (!known.has(name))
      throw new UserError(
        `unknown item "${name}". available: ${[...known].join(", ")}`
      );
    const item = await load(registry, `items/${name}.json`);
    check_schema(item, `items/${name}.json`);
    for (const dep of item.registryDependencies) await visit(dep);
    order.push(item);
  };
  for (const n of names) await visit(n);
  return order;
}

function bytes_of(file) {
  return Buffer.from(
    file.content,
    file.encoding === "base64" ? "base64" : "utf8"
  );
}

function target_path(dir, rel) {
  const root = resolve(dir);
  const full = resolve(root, rel);
  // a registry is remote input: never write outside the target dir
  if (full !== root && !full.startsWith(root + sep))
    throw new UserError(`refusing path outside target dir: ${rel}`);
  return full;
}

export async function list({ registry }) {
  const index = await load(registry, "index.json");
  check_schema(index, "index.json");
  return index.items.map((i) => ({ name: i.name, description: i.description }));
}

export async function add({ registry, dir, names, force = false }) {
  const items = await resolve_items(registry, names);
  const plan = [];
  for (const item of items)
    for (const file of item.files)
      plan.push({ full: target_path(dir, file.path), rel: file.path, file });
  const seen = new Set();
  const conflicts = [];
  for (const p of plan) {
    if (seen.has(p.full)) continue;
    seen.add(p.full);
    if (existsSync(p.full)) conflicts.push(p.rel);
  }
  if (conflicts.length && !force)
    throw new UserError(
      `would overwrite ${conflicts.join(", ")} — nothing written. rerun with --force, or run diff first`
    );
  const written = [];
  for (const p of plan) {
    if (written.includes(p.rel)) continue;
    mkdirSync(dirname(p.full), { recursive: true });
    writeFileSync(p.full, bytes_of(p.file));
    written.push(p.rel);
  }
  const dependencies = {};
  for (const item of items) Object.assign(dependencies, item.dependencies);
  return { items: items.map((i) => i.name), written, dependencies };
}

export async function diff({ registry, dir, names }) {
  const items = await resolve_items(registry, names);
  const out = [];
  const done = new Set();
  for (const item of items)
    for (const file of item.files) {
      if (done.has(file.path)) continue;
      done.add(file.path);
      const full = target_path(dir, file.path);
      if (!existsSync(full)) out.push({ path: file.path, status: "missing" });
      else
        out.push({
          path: file.path,
          status: readFileSync(full).equals(bytes_of(file))
            ? "same"
            : "changed",
        });
    }
  return out;
}

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      registry: { type: "string" },
      dir: { type: "string" },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [cmd, ...names] = positionals;
  if (values.help || !cmd) {
    process.stdout.write(HELP);
    return values.help ? 0 : 1;
  }
  const registry =
    values.registry ?? process.env.BG_DESIGN_REGISTRY ?? DEFAULT_REGISTRY;
  const dir = values.dir ?? process.env.BG_DESIGN_DIR ?? DEFAULT_DIR;
  if (cmd === "list") {
    for (const i of await list({ registry }))
      console.log(`${i.name.padEnd(10)} ${i.description}`);
    return 0;
  }
  if (cmd !== "add" && cmd !== "diff")
    throw new UserError(`unknown command "${cmd}"\n\n${HELP}`);
  if (!names.length) throw new UserError(`${cmd} needs at least one item name`);
  if (cmd === "add") {
    const r = await add({ registry, dir, names, force: values.force });
    for (const w of r.written) console.log(`wrote ${join(dir, w)}`);
    const deps = Object.entries(r.dependencies);
    if (deps.length) {
      console.log("\ninstall these packages (exact versions):");
      console.log(
        `  pnpm add ${deps.map(([n, v]) => `${n}@${v}`).join(" ")} --save-exact`
      );
    }
    return 0;
  }
  const rows = await diff({ registry, dir, names });
  for (const r of rows) console.log(`${r.status.padEnd(8)} ${r.path}`);
  return rows.some((r) => r.status !== "same") ? 1 : 0;
}

if (import.meta.filename === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof UserError ? `bg-design: ${e.message}` : e);
      process.exit(1);
    }
  );
}
