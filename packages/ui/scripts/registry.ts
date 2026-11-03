/**
 * builds the copy-in registry from this package's own source. nothing in
 * `registry/` is authored: every file body is read from `src/` (or brand's
 * colors.css) at build time, so the registry cannot hold a second copy that
 * drifts. the committed output is checked for staleness by
 * packages/design-cli's tests. format is documented in ../REGISTRY.md.
 */
import { readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_VERSION = 1;

const here = dirname(fileURLToPath(import.meta.url));
export const ui_root = resolve(here, "..");
const src_root = join(ui_root, "src");
const brand_colors = resolve(ui_root, "../brand/src/colors.css");
const cli_source = resolve(ui_root, "../design-cli/src/cli.mjs");

type Spec = {
  name: string;
  description: string;
  /** paths relative to `src/` — they are also the paths written into the
   *  consumer's target dir, which is what keeps relative imports intact. */
  files: string[];
  /** npm package names; versions are read from package.json, never typed here. */
  dependencies: string[];
  registryDependencies: string[];
};

const FONTS = [
  "styles/fonts/gochi-hand-latin-400-normal.woff2",
  "styles/fonts/quicksand-latin-ext-wght-normal.woff2",
  "styles/fonts/quicksand-latin-wght-normal.woff2",
  "styles/fonts/quicksand-vietnamese-wght-normal.woff2",
];

const SPECS: Spec[] = [
  {
    name: "fonts",
    description: "Quicksand and Gochi Hand subsets with their @font-face rules",
    files: ["styles/fonts.css", ...FONTS],
    dependencies: [],
    registryDependencies: [],
  },
  {
    name: "tokens",
    description:
      "Color palette (Radix step roles), theme mapping, spacing, base styles, component classes and utilities. Import styles/index.css after tailwindcss",
    files: [
      "styles/colors.css",
      "styles/index.css",
      "styles/base.css",
      "styles/components.css",
      "styles/utilities.css",
      "styles/theme.css",
    ],
    dependencies: ["tailwindcss"],
    registryDependencies: ["fonts"],
  },
  {
    name: "button",
    description:
      "Button and link-button with variants, sizes and loading state",
    files: ["components/button.tsx", "components/load-text.tsx"],
    dependencies: ["react", "react-router", "lucide-react"],
    registryDependencies: ["tokens"],
  },
  {
    name: "input",
    description: "Text input, label and form field with error and hint slots",
    files: [
      "components/form/input.tsx",
      "components/form/field.tsx",
      "components/form/label.tsx",
      "components/form/types.ts",
      "helpers/unpack.ts",
    ],
    dependencies: ["react", "lucide-react"],
    registryDependencies: ["tokens"],
  },
  {
    name: "dialog",
    description: "Modal dialog on Ark UI with size scale and focus handling",
    files: [
      "components/modal.tsx",
      "components/stripe-challenge.ts",
      "helpers/dialog-name.ts",
      "helpers/ejected-focus.ts",
      "helpers/modal-box.ts",
    ],
    dependencies: ["react", "@ark-ui/react"],
    registryDependencies: ["tokens"],
  },
  {
    name: "tooltip",
    description: "Tooltip on Ark UI sharing the popup motion shell",
    files: ["components/tooltip.tsx", "components/popup.ts"],
    dependencies: ["react", "@ark-ui/react"],
    registryDependencies: ["tokens"],
  },
];

export type FileEntry = {
  path: string;
  encoding: "utf8" | "base64";
  content: string;
};
export type Item = Omit<Spec, "dependencies" | "files"> & {
  dependencies: Record<string, string>;
  files: FileEntry[];
};
export type IndexItem = Omit<Item, "files"> & { files: string[] };
export type Index = {
  schemaVersion: number;
  items: IndexItem[];
};
export type Built = {
  index: Index;
  items: Record<string, Item>;
  /** every generated file, path relative to `registry/` → bytes */
  out: Record<string, string>;
};

const pkg = JSON.parse(readFileSync(join(ui_root, "package.json"), "utf8"));
function version_of(name: string): string {
  const v =
    pkg.devDependencies?.[name] ?? pkg.dependencies?.[name] ?? undefined;
  if (!v || v.startsWith("workspace:") || /^[\^~]/.test(v))
    throw new Error(`registry: no exact version for ${name} in package.json`);
  return v;
}

function read_file(path: string): FileEntry {
  if (path.endsWith(".woff2"))
    return {
      path,
      encoding: "base64",
      content: readFileSync(join(src_root, path)).toString("base64"),
    };
  if (path === "styles/colors.css")
    return {
      path,
      encoding: "utf8",
      content: readFileSync(brand_colors, "utf8"),
    };
  let content = readFileSync(join(src_root, path), "utf8");
  // the only edit the generator makes: brand's palette ships beside the rest
  // of the style layer in a consumer, so the package import becomes a sibling.
  if (path === "styles/index.css")
    content = content.replace(
      '@import "@better-giving/brand/colors.css";',
      '@import "./colors.css";'
    );
  return { path, encoding: "utf8", content };
}

const BUILTIN = /^(node:|react\/|react-dom\/)/;
function pkg_name(spec: string): string {
  const [a, b] = spec.split("/");
  return spec.startsWith("@") ? `${a}/${b}` : a;
}

/** a registered item must be installable alone: every relative import lands in
 *  its own files or in a registryDependency's, and every bare import is a
 *  declared dependency (of it or a registry dependency). */
function check_closed(
  specs: Map<string, Spec>,
  spec: Spec,
  entries: FileEntry[]
) {
  const reach = new Set<string>();
  const deps = new Set<string>();
  const walk = (s: Spec) => {
    for (const f of s.files) reach.add(f);
    for (const d of s.dependencies) deps.add(d);
    for (const r of s.registryDependencies) {
      const dep = specs.get(r);
      if (!dep) throw new Error(`registry: ${s.name} needs unknown item ${r}`);
      walk(dep);
    }
  };
  walk(spec);
  for (const e of entries) {
    if (!/\.(tsx?|css)$/.test(e.path)) continue;
    const re = /(?:from\s+|import\s+|@import\s+)["']([^"']+)["']/g;
    for (const m of e.content.matchAll(re)) {
      const target = m[1];
      if (target.startsWith(".")) {
        const full = posix.normalize(posix.join(posix.dirname(e.path), target));
        const hit = [full, `${full}.ts`, `${full}.tsx`, `${full}.css`].some(
          (c) => reach.has(c)
        );
        if (!hit)
          throw new Error(
            `registry: ${spec.name}: ${e.path} imports ${target}, which no item file provides`
          );
      } else if (!BUILTIN.test(target) && !e.path.endsWith(".css")) {
        if (!deps.has(pkg_name(target)))
          throw new Error(
            `registry: ${spec.name}: ${e.path} imports ${target}, not a declared dependency`
          );
      }
    }
  }
}

export function build_registry(): Built {
  const specs = new Map(SPECS.map((s) => [s.name, s]));
  const items: Record<string, Item> = {};
  for (const spec of SPECS) {
    const files = spec.files.map(read_file);
    check_closed(specs, spec, files);
    items[spec.name] = {
      ...spec,
      dependencies: Object.fromEntries(
        [...spec.dependencies].sort().map((d) => [d, version_of(d)])
      ),
      files,
    };
  }
  const index: Index = {
    schemaVersion: SCHEMA_VERSION,
    items: SPECS.map((s) => {
      const { files, ...rest } = items[s.name];
      return { ...rest, files: files.map((f) => f.path) };
    }),
  };
  const out: Record<string, string> = {
    "index.json": json({ ...index }),
    "cli.mjs": readFileSync(cli_source, "utf8"),
  };
  for (const [name, item] of Object.entries(items))
    out[`items/${name}.json`] = json({
      schemaVersion: SCHEMA_VERSION,
      ...item,
    });
  return { index, items, out };
}

function json(v: unknown): string {
  return `${JSON.stringify(v, null, 2)}\n`;
}
