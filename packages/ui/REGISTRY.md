# Design registry

Other Better Giving apps copy design-system source into their own repo instead of depending on a package. The registry is generated from `packages/ui` and `packages/brand`; the files under `registry/` are build output, never edited by hand.

Platform serves it as static text:

| URL | What |
| --- | --- |
| `/registry/index.json` | every item, without file bodies |
| `/registry/items/<name>.json` | one item with its file bodies |
| `/registry/cli.mjs` | the `bg-design` CLI as a single file |

## Format (schema version 1)

`index.json`

```json
{
  "schemaVersion": 1,
  "items": [
    {
      "name": "button",
      "description": "…",
      "files": ["components/button.tsx", "components/load-text.tsx"],
      "dependencies": { "react": "19.2.9", "react-router": "7.18.5" },
      "registryDependencies": ["tokens"]
    }
  ]
}
```

`items/<name>.json` has the same fields plus `schemaVersion`, and each entry of `files` is `{ "path", "encoding": "utf8" | "base64", "content" }`. Binary files (fonts) are base64.

- `files[].path` is relative to `packages/ui/src` and is written under the consumer's target dir unchanged, so the relative imports between files keep working.
- `dependencies` are npm packages with exact versions, read from this package's `package.json`.
- `registryDependencies` are other items, installed first.
- A change that old CLIs cannot read bumps `schemaVersion`; the CLI refuses a version it does not know.

## Items

`fonts`, `tokens` (needs `fonts`), `button`, `input`, `dialog`, `tooltip`. The last four need `tokens`.

`tokens` carries the whole style layer: the Radix step color roles, the theme mapping, spacing, base styles, the component classes (`.card`, `.btn-*`, `.table`) and utilities. They share one cascade, so they ship as one item. The only edit the generator makes to source is pointing `styles/index.css` at the sibling `colors.css` instead of the brand package.

Dashboard chrome (header, nav) is app code in Platform, not in `packages/ui`, so it is not an item.

## Regenerating

```sh
pnpm --filter @better-giving/ui registry:build
```

Add or change an item in `scripts/registry.ts` (`SPECS`). The generator reads each file from source and refuses an item that imports a file or package it does not declare. `packages/design-cli`'s tests fail when the committed `registry/` differs from a fresh build, so run the command and commit the result with any change to a file an item lists.

## Adopting in an app

Needs Node 24 and Tailwind 4.

```sh
# no install: fetch the CLI from the registry
curl -O https://better.giving/registry/cli.mjs
node cli.mjs list
node cli.mjs add tokens button --dir src/ui
```

`add` writes the item and its registry dependencies under `--dir` (default `src/ui`, or `$BG_DESIGN_DIR`), then prints the `pnpm add … --save-exact` line for the npm packages. It refuses to overwrite any existing file, and writes nothing in that case, unless you pass `--force`.

Then, in your CSS entry, after `@import "tailwindcss"`:

```css
@import "./ui/styles/index.css";
```

**Update:** `node cli.mjs diff button` lists each file as `same`, `changed` or `missing` against the registry (exit 1 if any differ). To take upstream, `add button --force` overwrites your local edits, so commit first and review the git diff.

Point at another registry (a preview deploy, or a local `packages/ui/registry` directory) with `--registry <url|dir>` or `$BG_DESIGN_REGISTRY`.

Inside this repo the CLI is `packages/design-cli` (bin `bg-design`).
